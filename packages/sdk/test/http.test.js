import test from "node:test";
import assert from "node:assert/strict";

import { Boomin, AuthenticationError, APIError, RateLimitError } from "../src/index.js";
import { buildQueryString } from "../src/core.js";
import { createClient, createMockFetch, lastCall } from "./helpers.js";

test("constructor requires a secret key", () => {
  assert.throws(() => new Boomin(), AuthenticationError);
  assert.throws(() => new Boomin(""), AuthenticationError);
  assert.throws(() => new Boomin("   "), AuthenticationError);
});

test("requests carry bearer auth, accept, and client headers", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: { id: "prog_1" } }]);
  await boomin.programs.retrieve("prog_1");
  const call = lastCall(calls);
  assert.equal(call.headers.Authorization, "Bearer sk_test_abc123");
  assert.equal(call.headers.Accept, "application/json");
  // Pin the shape, not the release — the version half is SDK_VERSION and bumps every publish.
  assert.match(call.headers["X-Boomin-Client"], /^@boomin\/sdk\/\d+\.\d+\.\d+(-[\w.]+)?$/);
  assert.equal(call.url, "https://api.boomin.ai/v1/platform/programs/prog_1");
});

test("baseUrl override + trailing slash normalization", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }], {
    baseUrl: "http://localhost:8787/",
  });
  await boomin.partners.list();
  assert.equal(lastCall(calls).url, "http://localhost:8787/v1/platform/partners");
});

test("Boomin-Brand threads from constructor and per-call override wins", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }], { brand: "brand_ctor" });
  await boomin.partners.list();
  assert.equal(lastCall(calls).headers["Boomin-Brand"], "brand_ctor");

  await boomin.partnerships.pause("ptn_1", {}, { brand: "brand_override" });
  assert.equal(lastCall(calls).headers["Boomin-Brand"], "brand_override");
});

test("no Boomin-Brand header when brand is unset", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.partners.list();
  assert.equal("Boomin-Brand" in lastCall(calls).headers, false);
});

test("mutations auto-inject a UUID Idempotency-Key; GETs never do", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.enrollments.create({ program: "prog_1" });
  const mutation = lastCall(calls);
  assert.match(
    mutation.headers["Idempotency-Key"],
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  await boomin.enrollments.list();
  assert.equal("Idempotency-Key" in lastCall(calls).headers, false);
});

test("per-call idempotencyKey override is sent verbatim", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.distributions.launch("dist_1", {}, { idempotencyKey: "my-key-1" });
  assert.equal(lastCall(calls).headers["Idempotency-Key"], "my-key-1");
});

test("each distinct mutation call gets a distinct auto key", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.connections.revoke("conn_1");
  await boomin.connections.revoke("conn_1");
  assert.notEqual(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
});

test("retries 5xx for GET with backoff, then succeeds", async () => {
  const { boomin, calls } = createClient(
    [
      { status: 500, body: { error: { message: "boom" } } },
      { status: 503, body: { error: { message: "boom" } } },
      { status: 200, body: { id: "op_1", status: "succeeded" } },
    ],
    { maxRetries: 2 },
  );
  const op = await boomin.operations.retrieve("op_1");
  assert.equal(op.id, "op_1");
  assert.equal(calls.length, 3);
});

test("retries 429 and surfaces RateLimitError when exhausted", async () => {
  const { boomin, calls } = createClient(
    [{ status: 429, body: { error: { code: "rate_limited", message: "slow down" } }, headers: { "retry-after": "0" } }],
    { maxRetries: 1 },
  );
  await assert.rejects(boomin.partners.list(), RateLimitError);
  assert.equal(calls.length, 2);
});

test("retries a keyed mutation on 5xx and reuses the SAME idempotency key", async () => {
  const { boomin, calls } = createClient(
    [
      { status: 500, body: { error: { message: "flake" } } },
      { status: 202, body: { distribution: { id: "dist_1" }, status: "launching", operation: { id: "op_1" } } },
    ],
    { maxRetries: 2 },
  );
  const result = await boomin.distributions.launch("dist_1");
  assert.equal(result.status, "launching");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
});

test("does NOT retry 4xx", async () => {
  const { boomin, calls } = createClient(
    [{ status: 400, body: { error: { code: "invalid_request", message: "bad" } } }],
    { maxRetries: 3 },
  );
  await assert.rejects(boomin.programs.create({ name: "x" }));
  assert.equal(calls.length, 1);
});

test("maxRetries: 0 disables retries entirely", async () => {
  const { boomin, calls } = createClient([{ status: 500, body: {} }], { maxRetries: 0 });
  await assert.rejects(boomin.partners.list(), APIError);
  assert.equal(calls.length, 1);
});

test("per-call maxRetries overrides the client default", async () => {
  const { boomin, calls } = createClient([{ status: 500, body: {} }], { maxRetries: 3 });
  await assert.rejects(boomin.partners.list(undefined, { maxRetries: 0 }), APIError);
  assert.equal(calls.length, 1);
});

test("network failure on idempotent request retries, then surfaces connection_error", async () => {
  const { boomin, calls } = createClient(
    [{ error: new TypeError("fetch failed") }],
    { maxRetries: 1 },
  );
  const err = await boomin.deployments.list().catch((e) => e);
  assert.ok(err instanceof APIError);
  assert.equal(err.code, "connection_error");
  assert.equal(calls.length, 2);
});

test("timeout aborts and surfaces request_timeout", async () => {
  const neverFetch = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  const boomin = new Boomin("sk_test_abc123", { fetch: neverFetch, timeout: 20, maxRetries: 0 });
  const err = await boomin.partners.list().catch((e) => e);
  assert.ok(err instanceof APIError);
  assert.equal(err.code, "request_timeout");
});

test("204/empty responses resolve to null", async () => {
  const { boomin } = createClient([{ status: 204 }]);
  const result = await boomin.webhooks.endpoints.del("we_1");
  assert.equal(result, null);
});

test("requestId is read from the Request-Id header", async () => {
  const { boomin } = createClient([
    { status: 400, body: { error: { message: "nope" } }, headers: { "request-id": "req_42" } },
  ]);
  const err = await boomin.programs.retrieve("prog_x").catch((e) => e);
  assert.equal(err.requestId, "req_42");
});

test("query serialization: camelCase -> snake_case, arrays repeat, null dropped", () => {
  assert.equal(
    buildQueryString({ startingAfter: "evt_1", type: "distribution.live", limit: 10, skip: null }),
    "?starting_after=evt_1&type=distribution.live&limit=10",
  );
  assert.equal(buildQueryString({ subjectKind: ["event", "offer"] }), "?subject_kind=event&subject_kind=offer");
  assert.equal(buildQueryString(undefined), "");
  assert.equal(buildQueryString({}), "");
});

test("path params are encoded and validated", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.programs.retrieve("prog/../weird id");
  assert.equal(lastCall(calls).url, "https://api.boomin.ai/v1/platform/programs/prog%2F..%2Fweird%20id");
  await assert.rejects(async () => boomin.programs.retrieve(""), /non-empty string/);
  await assert.rejects(async () => boomin.programs.retrieve(undefined), /non-empty string/);
});

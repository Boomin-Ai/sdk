/**
 * Request-body key casing + the operation-ref forgiveness.
 *
 * Regression cover for the cold-start rehearsal's highest-value defect: the
 * SDK converted camelCase -> snake_case for QUERY PARAMS ONLY, so a camelCase
 * BODY field was dropped by the API's schema and the call answered 200 OK
 * having done nothing (`enabledEvents` on webhook create landed as
 * `enabled_events: []`, which means subscribe to EVERY event type).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Boomin, InvalidRequestError, BoominError } from "../src/index.js";
import { snakeCaseBody, toSnakeKey, buildQueryString } from "../src/core.js";
import { createClient, lastCall } from "./helpers.js";

// ── The conversion rule itself ────────────────────────────────────────────────

test("toSnakeKey converts camelCase identifiers and leaves everything else alone", () => {
  assert.equal(toSnakeKey("enabledEvents"), "enabled_events");
  assert.equal(toSnakeKey("externalEventId"), "external_event_id");
  assert.equal(toSnakeKey("period_start"), "period_start");
  assert.equal(toSnakeKey("url"), "url");
  // Not well-formed camelCase → never mangled.
  assert.equal(toSnakeKey("PascalCase"), "PascalCase");
  assert.equal(toSnakeKey("_internal"), "_internal");
  assert.equal(toSnakeKey("X-Custom"), "X-Custom");
  assert.equal(toSnakeKey("a.b"), "a.b");
});

test("snakeCaseBody converts the TOP LEVEL only — nested payloads are verbatim", () => {
  const spec = { enrollmentPolicy: "all_approved", nested: { deepKey: 1 } };
  const out = snakeCaseBody({
    referralCode: "abc",
    spec,
    metadata: { customerId: "cus_1" },
    subjects: [{ subjectKind: "event", id: "x" }],
  });
  assert.deepEqual(Object.keys(out).sort(), ["metadata", "referral_code", "spec", "subjects"]);
  // Caller-defined payloads keep every key exactly as written.
  assert.deepEqual(out.spec, { enrollmentPolicy: "all_approved", nested: { deepKey: 1 } });
  assert.deepEqual(out.metadata, { customerId: "cus_1" });
  assert.deepEqual(out.subjects, [{ subjectKind: "event", id: "x" }]);
});

test("snakeCaseBody never clobbers an explicitly written snake_case key", () => {
  const out = snakeCaseBody({ enabled_events: ["a"], enabledEvents: ["b"] });
  assert.deepEqual(out, { enabled_events: ["a"] });
});

test("snakeCaseBody passes non-plain-object bodies through untouched", () => {
  const arr = [{ aB: 1 }];
  assert.equal(snakeCaseBody(arr), arr);
  assert.equal(snakeCaseBody(null), null);
  assert.equal(snakeCaseBody("raw"), "raw");
});

test("query params still convert (the behaviour bodies were missing)", () => {
  assert.equal(buildQueryString({ startingAfter: "evt_1", limit: 2 }), "?starting_after=evt_1&limit=2");
});

// ── On the wire ───────────────────────────────────────────────────────────────

test("webhook create sends enabled_events, not enabledEvents", async () => {
  const { boomin, calls } = createClient([
    { status: 201, body: { webhook_endpoint: { id: "we_1", enabled_events: ["distribution.live"] } } },
  ]);
  await boomin.webhooks.endpoints.create({
    url: "https://example.com/hook",
    enabledEvents: ["distribution.live"],
  });
  assert.deepEqual(lastCall(calls).body, {
    url: "https://example.com/hook",
    enabled_events: ["distribution.live"],
  });
});

test("connect_config update sends allowed_origins (the different-domain launch call)", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.programs.connectConfig.update("prog_1", {
    allowedOrigins: ["https://coldstart-labs.dev"],
  });
  assert.deepEqual(lastCall(calls).body, { allowed_origins: ["https://coldstart-labs.dev"] });
});

test("payouts.run sends period_start / period_end", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await boomin.payouts.run({ periodStart: "2026-08-01", periodEnd: "2026-08-31" });
  assert.deepEqual(lastCall(calls).body, { period_start: "2026-08-01", period_end: "2026-08-31" });
});

test("performance ingest converts the field names but not `properties`", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: {} }]);
  await boomin.performance.events.create({
    deployment: "dep_1",
    type: "sale",
    valueMinor: 4900,
    externalEventId: "order_1",
    occurredAt: "2026-08-02T00:00:00Z",
    properties: { orderId: "order_1", lineItems: 2 },
  });
  assert.deepEqual(lastCall(calls).body, {
    deployment: "dep_1",
    type: "sale",
    value_minor: 4900,
    external_event_id: "order_1",
    occurred_at: "2026-08-02T00:00:00Z",
    properties: { orderId: "order_1", lineItems: 2 },
  });
});

test("a nested budget object is sent exactly as written", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "dist_1" } }]);
  await boomin.distributions.create({
    name: "Launch",
    objective: "acquisition",
    budget: { mode: "funded", asset: "credit", totalMinor: 10000 },
  });
  assert.deepEqual(lastCall(calls).body.budget, { mode: "funded", asset: "credit", totalMinor: 10000 });
});

// ── webhook_endpoints envelope ────────────────────────────────────────────────

test("webhook endpoint responses are unwrapped so the one-time secret is reachable", async () => {
  const { boomin } = createClient([
    { status: 201, body: { webhook_endpoint: { id: "we_1", secret: "whsec_abc", enabled_events: [] } } },
  ]);
  const { id, secret } = await boomin.webhooks.endpoints.create({ url: "https://example.com/hook" });
  assert.equal(id, "we_1");
  assert.equal(secret, "whsec_abc");
});

test("an already-bare endpoint response passes through unchanged", async () => {
  const { boomin } = createClient([{ status: 200, body: { id: "we_2", url: "https://example.com/hook" } }]);
  const endpoint = await boomin.webhooks.endpoints.retrieve("we_2");
  assert.equal(endpoint.id, "we_2");
});

// ── operations.wait accepts both readings ─────────────────────────────────────

test("operations.wait accepts the id STRING that launch returns", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: { id: "op_1", status: "succeeded" } }]);
  const settled = await boomin.operations.wait("op_1", { timeout: 1000, pollInterval: 10 });
  assert.equal(settled.status, "succeeded");
  assert.equal(lastCall(calls).url, "https://api.boomin.ai/v1/platform/operations/op_1");
});

test("operations.wait accepts an operation OBJECT", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: { id: "op_1", status: "failed" } }]);
  const settled = await boomin.operations.wait({ id: "op_1", status: "running" }, { timeout: 1000, pollInterval: 10 });
  assert.equal(settled.status, "failed");
  assert.equal(lastCall(calls).url, "https://api.boomin.ai/v1/platform/operations/op_1");
});

test("operations.retrieve accepts both forms too", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: { id: "op_9" } }]);
  await boomin.operations.retrieve({ id: "op_9" });
  assert.equal(lastCall(calls).url, "https://api.boomin.ai/v1/platform/operations/op_9");
});

test("operations.wait rejects a missing/undefined ref instead of polling /operations/undefined", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: {} }]);
  await assert.rejects(() => boomin.operations.wait(undefined), InvalidRequestError);
  // The old README passed `operation.id` on a string `operation` — i.e. undefined.
  await assert.rejects(() => boomin.operations.wait({ notAnId: true }), InvalidRequestError);
  assert.equal(calls.length, 0);
});

test("a wait timeout reports waiting_reason — the whole diagnosis when a launch parks", async () => {
  const { boomin } = createClient([
    { status: 200, body: { id: "op_1", status: "waiting", waiting_reason: "funding_required" } },
  ]);
  await assert.rejects(
    () => boomin.operations.wait("op_1", { timeout: 20, pollInterval: 10 }),
    (err) => {
      assert.ok(err instanceof BoominError);
      assert.equal(err.code, "operation_wait_timeout");
      assert.match(err.message, /funding_required/);
      return true;
    },
  );
});

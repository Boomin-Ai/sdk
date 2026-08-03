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

import { Boomin, InvalidRequestError, BoominError, ConflictingParametersError } from "../src/index.js";
import { snakeCaseBody, toSnakeKey, buildQueryString, REQUEST_FIELD_MAP } from "../src/core.js";
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

test("snakeCaseBody with no declared shape converts the top level and nothing else", () => {
  const out = snakeCaseBody({
    referralCode: "abc",
    metadata: { customerId: "cus_1" },
    anythingNested: { deepKey: 1 },
  });
  assert.deepEqual(Object.keys(out).sort(), ["anything_nested", "metadata", "referral_code"]);
  // An undeclared nested value is opaque by default — the SAFE default.
  assert.deepEqual(out.anything_nested, { deepKey: 1 });
  assert.deepEqual(out.metadata, { customerId: "cus_1" });
});

test("a camelCase key and its snake_case twin THROW instead of one silently winning", () => {
  assert.throws(
    () => snakeCaseBody({ enabled_events: ["a"], enabledEvents: ["b"] }),
    (err) => {
      assert.ok(err instanceof ConflictingParametersError);
      // Still catchable as the 400-family error it is.
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.code, "conflicting_parameters");
      assert.equal(err.param, "enabledEvents");
      assert.equal(err.conflictsWith, "enabled_events");
      assert.equal(err.status, null, "nothing was ever sent");
      assert.match(err.message, /refer to the same API field/);
      return true;
    },
  );
});

test("explicit snake_case wins when it is the SOLE spelling supplied", () => {
  assert.deepEqual(snakeCaseBody({ enabled_events: ["a"] }), { enabled_events: ["a"] });
  assert.deepEqual(snakeCaseBody({ enabledEvents: ["a"] }), { enabled_events: ["a"] });
});

test("a collision inside a DECLARED nested structure throws, named at its real path", () => {
  assert.throws(
    () => snakeCaseBody(
      { name: "x", budget: { mode: "funded", total_minor: 1, totalMinor: 2 } },
      "distributions.create",
    ),
    (err) => {
      assert.equal(err.param, "budget.totalMinor");
      assert.equal(err.conflictsWith, "budget.total_minor");
      return true;
    },
  );
});

test("a collision inside an OPAQUE payload is not a collision — those keys are yours", () => {
  const properties = { orderId: "1001", order_id: "shadow" };
  const out = snakeCaseBody({ deployment: "dep_1", properties }, "performance.events.create");
  assert.deepEqual(out.properties, { orderId: "1001", order_id: "shadow" });
});

test("a query-param collision throws too", () => {
  assert.throws(
    () => buildQueryString({ startingAfter: "a", starting_after: "b" }),
    ConflictingParametersError,
  );
});

// ── The field map is the contract ─────────────────────────────────────────────

test("the declared field map converts subjects[] elements and the budget object", () => {
  const out = snakeCaseBody(
    {
      name: "Launch",
      subjects: [{ subjectKind: "event", id: "u1", role: "primary" }, { kind: "offer", id: "u2" }],
      budget: { mode: "funded", totalMinor: 10000 },
    },
    "distributions.create",
  );
  assert.deepEqual(out.subjects, [
    { subject_kind: "event", id: "u1", role: "primary" },
    { kind: "offer", id: "u2" },
  ]);
  assert.deepEqual(out.budget, { mode: "funded", total_minor: 10000 });
});

test("declared conversion never reaches into spec/metadata/properties", () => {
  const spec = { enrollmentPolicy: "all_approved", nested: { deepKey: 1 } };
  const out = snakeCaseBody({ name: "Launch", spec }, "distributions.create");
  assert.deepEqual(out.spec, { enrollmentPolicy: "all_approved", nested: { deepKey: 1 } });

  const perms = { canPost: true, nested: { alsoCamel: 1 } };
  const permsOut = snakeCaseBody(
    { permissions: perms, rights: { someRight: 1 }, compensationDefaults: { rateBps: 500 } },
    "partnerships.updatePermissions",
  );
  assert.deepEqual(permsOut.permissions, perms);
  assert.deepEqual(permsOut.rights, { someRight: 1 });
  // The FIELD name is API-owned and converts; its CONTENTS do not.
  assert.deepEqual(permsOut.compensation_defaults, { rateBps: 500 });

  const meta = { customerTier: "gold" };
  assert.deepEqual(snakeCaseBody({ name: "P", metadata: meta }, "programs.create").metadata, meta);
});

test("every field-map entry names a real SDK request shape", () => {
  // Guard against a typo'd key quietly disabling nested conversion forever.
  const boomin = new Boomin("sk_test_x", { fetch: async () => new Response("{}") });
  for (const shape of Object.keys(REQUEST_FIELD_MAP)) {
    const path = shape.split(".");
    const method = path.pop();
    const owner = path.reduce((node, segment) => node?.[segment], boomin);
    assert.equal(typeof owner?.[method], "function", `${shape} is not a method on the client`);
  }
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

test("the nested budget object converts on the wire (it is a DECLARED API structure)", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "dist_1" } }]);
  await boomin.distributions.create({
    name: "Launch",
    objective: "acquisition",
    budget: { mode: "funded", asset: "credit", totalMinor: 10000 },
    subjects: [{ kind: "event", id: "1a2b", role: "primary" }],
  });
  assert.deepEqual(lastCall(calls).body.budget, { mode: "funded", asset: "credit", total_minor: 10000 });
  assert.deepEqual(lastCall(calls).body.subjects, [{ kind: "event", id: "1a2b", role: "primary" }]);
});

test("distributions.create sends spec verbatim while converting around it", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "dist_1" } }]);
  await boomin.distributions.create({
    name: "Launch",
    idempotencyKey: "seed-key-1234",
    spec: { enrollmentPolicy: "all_approved", destinationUrl: "https://x.com" },
  });
  const body = lastCall(calls).body;
  assert.equal(body.idempotency_key, "seed-key-1234");
  assert.deepEqual(body.spec, { enrollmentPolicy: "all_approved", destinationUrl: "https://x.com" });
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

test("a wait timeout reports waitingReason — the whole diagnosis when a launch parks", async () => {
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

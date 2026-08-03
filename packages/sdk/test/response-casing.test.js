/**
 * Response deserialization: the wire is snake_case, @boomin/sdk is camelCase.
 *
 * Before this, the SDK's contract was "camel-or-snake in, snake-only out" — a
 * caller wrote `valueMinor` and read back `value_minor` from the very same
 * object. These tests pin the symmetric contract, including the exceptions:
 * customer-owned payloads whose keys must round-trip byte-identical.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  camelCaseResponse, toCamelKey, toSnakeKey,
  OPAQUE_FIELDS, RESPONSE_FIELD_MAP,
} from "../src/core.js";
import { ConflictingParametersError, InvalidRequestError } from "../src/errors.js";
import { createClient } from "./helpers.js";

// ── The key rule ──────────────────────────────────────────────────────────────

test("toCamelKey converts lower_snake_case and leaves everything else alone", () => {
  assert.equal(toCamelKey("value_minor"), "valueMinor");
  assert.equal(toCamelKey("has_more"), "hasMore");
  assert.equal(toCamelKey("total_amount_cents"), "totalAmountCents");
  assert.equal(toCamelKey("id"), "id");
  assert.equal(toCamelKey("livemode"), "livemode");
  // Not well-formed snake_case → never guessed at.
  assert.equal(toCamelKey("_internal"), "_internal");
  assert.equal(toCamelKey("a__b"), "a__b");
  assert.equal(toCamelKey("Mixed_Case"), "Mixed_Case");
  assert.equal(toCamelKey("2fa_enabled"), "2fa_enabled");
  assert.equal(toCamelKey("trailing_"), "trailing_");
});

test("toCamelKey is the exact inverse of toSnakeKey over the keys it converts", () => {
  for (const key of [
    "value_minor", "external_event_id", "has_more", "approval_status",
    "target_operation_id", "basis_metric_key", "s3_key", "plan_hash",
  ]) {
    assert.equal(toSnakeKey(toCamelKey(key)), key, key);
  }
});

// ── Recursion + the opaque exceptions ─────────────────────────────────────────

test("camelCaseResponse converts keys recursively, never values", () => {
  const out = camelCaseResponse({
    id: "dep_1",
    observed_status: "live",
    budget_allocation_minor: 500,
    capabilities: { editable_fields: ["a_b"], actions: { pause: true } },
    owner: { type: "partner", id: "ptnr_1" },
    nested_list: [{ created_at: "t", inner: { deep_key: 1 } }],
  });
  assert.deepEqual(out, {
    id: "dep_1",
    observedStatus: "live",
    budgetAllocationMinor: 500,
    // Values are untouched: "a_b" stays "a_b" because it is a VALUE.
    capabilities: { editableFields: ["a_b"], actions: { pause: true } },
    owner: { type: "partner", id: "ptnr_1" },
    nestedList: [{ createdAt: "t", inner: { deepKey: 1 } }],
  });
});

test("customer-owned payloads keep every key byte-identical, at any depth", () => {
  const out = camelCaseResponse({
    id: "evt_1",
    value_minor: 4999,
    properties: { orderId: "1001", order_id: "also mine", nested: { line_items: 2, lineTotal: 9 } },
    metadata: { customer_tier: "gold", customerRef: "x" },
    spec: { enrollment_policy: "all_approved" },
    desired_state: { placement: "feed", ad_set_id: "1" },
    observed_state: { promo_link_id: "l1" },
    external_ids: { promo_link_id: "l1" },
    permissions: { can_post: true },
    rights: { may_repost: true },
    compensation_defaults: { rate_bps: 500 },
    stats: { "custom.event_type": 3 },
  });
  assert.equal(out.valueMinor, 4999);
  assert.deepEqual(out.properties, {
    orderId: "1001", order_id: "also mine", nested: { line_items: 2, lineTotal: 9 },
  });
  assert.deepEqual(out.metadata, { customer_tier: "gold", customerRef: "x" });
  assert.deepEqual(out.spec, { enrollment_policy: "all_approved" });
  assert.deepEqual(out.permissions, { can_post: true });
  assert.deepEqual(out.rights, { may_repost: true });
  assert.deepEqual(out.stats, { "custom.event_type": 3 });
  // The FIELD name is API-owned and converts; its CONTENTS never do.
  assert.deepEqual(out.desiredState, { placement: "feed", ad_set_id: "1" });
  assert.deepEqual(out.observedState, { promo_link_id: "l1" });
  assert.deepEqual(out.externalIds, { promo_link_id: "l1" });
  assert.deepEqual(out.compensationDefaults, { rate_bps: 500 });
});

test("every opaque field name is listed in BOTH spellings", () => {
  for (const field of OPAQUE_FIELDS) {
    assert.ok(
      OPAQUE_FIELDS.has(toSnakeKey(field)) && OPAQUE_FIELDS.has(toCamelKey(field)),
      `${field} is only listed in one spelling — it would leak on one side of the wire`,
    );
  }
});

test("OPAQUE_FIELDS is exactly the declared RESPONSE_FIELD_MAP, so the map is load-bearing", () => {
  const declared = new Set(Object.values(RESPONSE_FIELD_MAP).flat());
  const expected = new Set([...declared].flatMap((f) => [f, toCamelKey(f), toSnakeKey(f)]));
  assert.deepEqual([...OPAQUE_FIELDS].sort(), [...expected].sort());
  // The reviewer's named set, spelled out so a deletion cannot pass silently.
  for (const field of [
    "metadata", "properties", "spec", "desired_state", "observed_state",
    "external_ids", "permissions", "rights", "compensation_defaults", "stats",
  ]) {
    assert.ok(OPAQUE_FIELDS.has(field), `${field} must be customer-owned`);
  }
});

test("an opaque field nested inside an API structure is still opaque", () => {
  const out = camelCaseResponse({
    result: { observed_status: "live", external_ids: { promo_link_id: "l1" } },
  });
  assert.equal(out.result.observedStatus, "live");
  assert.deepEqual(out.result.externalIds, { promo_link_id: "l1" });
});

test("a response carrying BOTH spellings of one field throws — never picks a winner", () => {
  assert.throws(
    () => camelCaseResponse({ value_minor: 1, valueMinor: 2 }),
    (err) => {
      assert.ok(err instanceof ConflictingParametersError);
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.code, "conflicting_parameters");
      assert.equal(err.param, "valueMinor");
      assert.equal(err.conflictsWith, "value_minor");
      assert.match(err.message, /server bug/);
      return true;
    },
  );
});

test("a response collision is named at its real path", () => {
  assert.throws(
    () => camelCaseResponse({ object: "list", data: [{ id: "x", value_minor: 1, valueMinor: 2 }] }),
    (err) => {
      assert.equal(err.param, "data.0.valueMinor");
      assert.equal(err.conflictsWith, "data.0.value_minor");
      return true;
    },
  );
});

test("twin keys INSIDE a customer-owned payload are not a collision — they are your keys", () => {
  const out = camelCaseResponse({
    object: "performance_event",
    properties: { orderId: "1001", order_id: "also mine" },
  });
  assert.deepEqual(out.properties, { orderId: "1001", order_id: "also mine" });
});

test("non-objects and arrays of scalars pass straight through", () => {
  assert.equal(camelCaseResponse(null), null);
  assert.equal(camelCaseResponse("a_b"), "a_b");
  assert.equal(camelCaseResponse(7), 7);
  assert.deepEqual(camelCaseResponse(["a_b", 1]), ["a_b", 1]);
});

// ── Through the client ────────────────────────────────────────────────────────

test("performance.events.create round-trips camelCase in and camelCase out", async () => {
  const { boomin } = createClient([
    {
      status: 201,
      body: {
        id: "pev_1", object: "performance_event", deployment: "dep_1",
        value_minor: 4999, occurred_at: "2026-08-02T00:00:00Z",
        received_at: "2026-08-02T00:00:01Z", properties: { orderId: "1001" },
      },
    },
  ]);
  const event = await boomin.performance.events.create({
    deployment: "dep_1", type: "sale", valueMinor: 4999,
    idempotencyKey: "evt_123", properties: { orderId: "1001" },
  });
  assert.equal(event.valueMinor, 4999);
  assert.equal(event.receivedAt, "2026-08-02T00:00:01Z");
  assert.equal(event.occurredAt, "2026-08-02T00:00:00Z");
  assert.equal(event.value_minor, undefined);
  // What went in is what came back.
  assert.deepEqual(event.properties, { orderId: "1001" });
});

test("list envelopes camelCase the envelope AND every element", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        object: "list",
        data: [{ id: "enr_1", approval_status: "approved", billing_status: "billable" }],
        has_more: true,
      },
    },
  ]);
  const page = await boomin.enrollments.list();
  assert.equal(page.hasMore, true);
  assert.equal(page.object, "list");
  assert.equal(page.data[0].approvalStatus, "approved");
  assert.equal(page.data[0].billingStatus, "billable");
});

test("auto-pagination still follows the cursor now that has_more is hasMore", async () => {
  const { boomin, calls } = createClient([
    { status: 200, body: { object: "list", data: [{ id: "a" }, { id: "b" }], has_more: true } },
    { status: 200, body: { object: "list", data: [{ id: "c" }], has_more: false } },
  ]);
  const seen = [];
  for await (const item of boomin.partners.list()) seen.push(item.id);
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /starting_after=b/);
});

test("the webhook_endpoint envelope unwraps after camelCasing", async () => {
  const { boomin } = createClient([
    {
      status: 201,
      body: { webhook_endpoint: { id: "we_1", secret: "whsec_abc", enabled_events: ["payout.settled"] } },
    },
  ]);
  const endpoint = await boomin.webhooks.endpoints.create({
    url: "https://x.com/wh", enabledEvents: ["payout.settled"],
  });
  assert.equal(endpoint.id, "we_1");
  assert.equal(endpoint.secret, "whsec_abc", "the one-time signing secret is still reachable");
  assert.deepEqual(endpoint.enabledEvents, ["payout.settled"]);
});

test("distribution nested objects convert on the way back", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        id: "dist_1", object: "distribution", status: "active", plan_hash: "h",
        budget: { mode: "funded", asset: "credit", total: 10000, consumed: 0, released: 0 },
        deployments: { total: 2, live: 1 },
        launched_at: "2026-08-02T00:00:00Z",
      },
    },
  ]);
  const dist = await boomin.distributions.retrieve("dist_1");
  assert.equal(dist.planHash, "h");
  assert.equal(dist.launchedAt, "2026-08-02T00:00:00Z");
  assert.equal(dist.budget.total, 10000);
  assert.equal(dist.deployments.live, 1);
});

test("operations.wait reads the camelCase waitingReason", async () => {
  const { boomin } = createClient([
    { status: 200, body: { id: "op_1", status: "waiting", waiting_reason: "funding_required" } },
  ]);
  await assert.rejects(
    () => boomin.operations.wait("op_1", { timeout: 20, pollInterval: 10 }),
    /funding_required/,
  );
});

test("a response collision surfaces as itself, carrying status + requestId", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      headers: { "request-id": "req_abc" },
      body: { id: "pev_1", value_minor: 1, valueMinor: 2 },
    },
  ]);
  await assert.rejects(
    () => boomin.performance.events.create({ deployment: "dep_1", type: "sale" }),
    (err) => {
      // NOT swallowed as "malformed JSON" — the JSON parsed fine, the API lied.
      assert.ok(err instanceof ConflictingParametersError);
      assert.equal(err.status, 200);
      assert.equal(err.requestId, "req_abc");
      return true;
    },
  );
});

// ── The escape hatch ──────────────────────────────────────────────────────────

test("rawResponses: true hands back the wire objects untouched", async () => {
  const { boomin } = createClient(
    [{ status: 200, body: { object: "list", data: [{ id: "enr_1", approval_status: "approved" }], has_more: false } }],
    { rawResponses: true },
  );
  const page = await boomin.enrollments.list();
  assert.equal(page.has_more, false);
  assert.equal(page.hasMore, undefined);
  assert.equal(page.data[0].approval_status, "approved");
});

test("rawResponses still auto-paginates and still unwraps the endpoint envelope", async () => {
  const { boomin, calls } = createClient(
    [
      { status: 200, body: { object: "list", data: [{ id: "a" }], has_more: true } },
      { status: 200, body: { object: "list", data: [{ id: "b" }], has_more: false } },
    ],
    { rawResponses: true },
  );
  const seen = [];
  for await (const item of boomin.partners.list()) seen.push(item.id);
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(calls.length, 2);

  const { boomin: raw2 } = createClient(
    [{ status: 201, body: { webhook_endpoint: { id: "we_1", secret: "whsec_x" } } }],
    { rawResponses: true },
  );
  const endpoint = await raw2.webhooks.endpoints.create({ url: "https://x.com/wh" });
  assert.equal(endpoint.secret, "whsec_x");
});

test("requests are converted the same either way — rawResponses is output-only", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: {} }], { rawResponses: true });
  await boomin.performance.events.create({ deployment: "dep_1", type: "sale", valueMinor: 1 });
  assert.equal(calls[0].body.value_minor, 1);
});

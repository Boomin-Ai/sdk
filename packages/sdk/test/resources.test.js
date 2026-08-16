/**
 * Every resource client method is asserted against its wire contract:
 * verb, path, query, and body — table-driven over a mocked fetch.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createClient, lastCall } from "./helpers.js";

const BASE = "https://api.boomin.ai/v1/platform";

/**
 * @type {Array<{ name: string, invoke: (b: any) => Promise<unknown>,
 *   method: string, path: string, body?: unknown }>}
 * `body: undefined` asserts NO body was sent.
 */
const CASES = [
  // programs (+ nested requirements/tiers/connectConfig/handoffConfig)
  { name: "programs.create", invoke: (b) => b.programs.create({ name: "Creators" }), method: "POST", path: "/programs", body: { name: "Creators" } },
  { name: "programs.retrieve", invoke: (b) => b.programs.retrieve("prog_1"), method: "GET", path: "/programs/prog_1" },
  { name: "programs.update", invoke: (b) => b.programs.update("prog_1", { name: "New" }), method: "POST", path: "/programs/prog_1", body: { name: "New" } },
  { name: "programs.list", invoke: (b) => b.programs.list({ limit: 5 }), method: "GET", path: "/programs?limit=5" },
  { name: "programs.requirements.create", invoke: (b) => b.programs.requirements.create("prog_1", { kind: "min_followers" }), method: "POST", path: "/programs/prog_1/requirements", body: { kind: "min_followers" } },
  { name: "programs.requirements.retrieve", invoke: (b) => b.programs.requirements.retrieve("prog_1", "req_1"), method: "GET", path: "/programs/prog_1/requirements/req_1" },
  { name: "programs.requirements.update", invoke: (b) => b.programs.requirements.update("prog_1", "req_1", { kind: "x" }), method: "POST", path: "/programs/prog_1/requirements/req_1", body: { kind: "x" } },
  { name: "programs.requirements.list", invoke: (b) => b.programs.requirements.list("prog_1"), method: "GET", path: "/programs/prog_1/requirements" },
  { name: "programs.requirements.del", invoke: (b) => b.programs.requirements.del("prog_1", "req_1"), method: "DELETE", path: "/programs/prog_1/requirements/req_1" },
  { name: "programs.tiers.create", invoke: (b) => b.programs.tiers.create("prog_1", { name: "Gold" }), method: "POST", path: "/programs/prog_1/tiers", body: { name: "Gold" } },
  { name: "programs.tiers.list", invoke: (b) => b.programs.tiers.list("prog_1"), method: "GET", path: "/programs/prog_1/tiers" },
  { name: "programs.tiers.del", invoke: (b) => b.programs.tiers.del("prog_1", "tier_1"), method: "DELETE", path: "/programs/prog_1/tiers/tier_1" },
  { name: "programs.connectConfig.retrieve", invoke: (b) => b.programs.connectConfig.retrieve("prog_1"), method: "GET", path: "/programs/prog_1/connect_config" },
  { name: "programs.connectConfig.update", invoke: (b) => b.programs.connectConfig.update("prog_1", { theme: "dark" }), method: "POST", path: "/programs/prog_1/connect_config", body: { theme: "dark" } },
  { name: "programs.handoffConfig.retrieve", invoke: (b) => b.programs.handoffConfig.retrieve("prog_1"), method: "GET", path: "/programs/prog_1/handoff_config" },
  { name: "programs.handoffConfig.update", invoke: (b) => b.programs.handoffConfig.update("prog_1", { issuer: "acme" }), method: "POST", path: "/programs/prog_1/handoff_config", body: { issuer: "acme" } },

  // partners
  { name: "entities.retrieve", invoke: (b) => b.entities.retrieve("ent_1"), method: "GET", path: "/entities/ent_1" },
  { name: "entities.list", invoke: (b) => b.entities.list(), method: "GET", path: "/entities" },
  // Deprecated getters DELEGATE to the canonical clients: old code keeps
  // working and speaks the canonical wire (old ids decode forever server-side).
  { name: "partners.retrieve (deprecated → entities)", invoke: (b) => b.partners.retrieve("ptnr_1"), method: "GET", path: "/entities/ptnr_1" },
  { name: "partners.list (deprecated → entities)", invoke: (b) => b.partners.list(), method: "GET", path: "/entities" },

  // partnerships
  { name: "relationships.list", invoke: (b) => b.relationships.list({ status: "active" }), method: "GET", path: "/relationships?status=active" },
  { name: "relationships.retrieve", invoke: (b) => b.relationships.retrieve("rel_1"), method: "GET", path: "/relationships/rel_1" },
  { name: "relationships.pause", invoke: (b) => b.relationships.pause("rel_1"), method: "POST", path: "/relationships/rel_1/pause", body: {} },
  { name: "relationships.resume", invoke: (b) => b.relationships.resume("rel_1"), method: "POST", path: "/relationships/rel_1/resume", body: {} },
  { name: "relationships.end", invoke: (b) => b.relationships.end("rel_1", { reason: "done" }), method: "POST", path: "/relationships/rel_1/end", body: { reason: "done" } },
  { name: "relationships.updatePermissions", invoke: (b) => b.relationships.updatePermissions("rel_1", { permissions: { publish: true } }), method: "POST", path: "/relationships/rel_1/permissions", body: { permissions: { publish: true } } },
  // Deprecated getter delegates — legacy pship_ ids ride the canonical route.
  { name: "partnerships.retrieve (deprecated → relationships)", invoke: (b) => b.partnerships.retrieve("pship_1"), method: "GET", path: "/relationships/pship_1" },
  { name: "partnerships.updatePermissions (deprecated → relationships)", invoke: (b) => b.partnerships.updatePermissions("pship_1", { permissions: { publish: true } }), method: "POST", path: "/relationships/pship_1/permissions", body: { permissions: { publish: true } } },
  // Relationship stack (RELATIONSHIP_CORE §2/§4/§5).
  { name: "assertions.create", invoke: (b) => b.assertions.create({ externalUserId: "u_1", issuer: "atlantium.ai", key: "advisor_verified", value: true, expiresAt: "2030-01-01T00:00:00Z" }), method: "POST", path: "/assertions", body: { external_user_id: "u_1", issuer: "atlantium.ai", key: "advisor_verified", value: true, expires_at: "2030-01-01T00:00:00Z" } },
  { name: "assertions.revoke", invoke: (b) => b.assertions.revoke({ entity: "ent_1", key: "advisor_verified" }), method: "POST", path: "/assertions/revoke", body: { entity: "ent_1", key: "advisor_verified" } },
  { name: "assertions.list", invoke: (b) => b.assertions.list({ entity: "ent_1", includeExpired: true }), method: "GET", path: "/assertions?entity=ent_1&include_expired=true" },
  { name: "assertions.retrieveEvent", invoke: (b) => b.assertions.retrieveEvent("asrt_1"), method: "GET", path: "/assertions/asrt_1" },
  { name: "operatingTypes.create", invoke: (b) => b.operatingTypes.create({ key: "advisor", name: "Advisor" }), method: "POST", path: "/operating_types", body: { key: "advisor", name: "Advisor" } },
  { name: "operatingTypes.retrieve (by key)", invoke: (b) => b.operatingTypes.retrieve("advisor"), method: "GET", path: "/operating_types/advisor" },
  { name: "operatingTypes.update (reactivate)", invoke: (b) => b.operatingTypes.update("otype_1", { status: "active" }), method: "POST", path: "/operating_types/otype_1", body: { status: "active" } },
  { name: "operatingTypes.list", invoke: (b) => b.operatingTypes.list(), method: "GET", path: "/operating_types" },
  { name: "operatingTypes.archive", invoke: (b) => b.operatingTypes.archive("otype_1"), method: "DELETE", path: "/operating_types/otype_1" },
  { name: "metricKeys.create", invoke: (b) => b.metricKeys.create({ key: "x:demo_submitted", displayName: "Demos" }), method: "POST", path: "/metric_keys", body: { key: "x:demo_submitted", display_name: "Demos" } },
  // `:` percent-encodes in the path segment; Hono decodes it server-side.
  { name: "metricKeys.retrieve (by key)", invoke: (b) => b.metricKeys.retrieve("x:demo_submitted"), method: "GET", path: "/metric_keys/x%3Ademo_submitted" },
  { name: "metricKeys.list", invoke: (b) => b.metricKeys.list(), method: "GET", path: "/metric_keys" },
  { name: "metricKeys.archive", invoke: (b) => b.metricKeys.archive("mkey_1"), method: "DELETE", path: "/metric_keys/mkey_1" },
  { name: "enrollments.update (set capacity)", invoke: (b) => b.enrollments.update("enr_1", { operatingType: "advisor" }), method: "POST", path: "/enrollments/enr_1", body: { operating_type: "advisor" } },
  { name: "enrollments.requirementOverrides.create", invoke: (b) => b.enrollments.requirementOverrides.create("enr_1", { requirement: "11111111-1111-1111-1111-111111111111", disabled: true }), method: "POST", path: "/enrollments/enr_1/requirement_overrides", body: { requirement: "11111111-1111-1111-1111-111111111111", disabled: true } },
  { name: "enrollments.requirementOverrides.list", invoke: (b) => b.enrollments.requirementOverrides.list("enr_1"), method: "GET", path: "/enrollments/enr_1/requirement_overrides" },
  { name: "enrollments.requirementOverrides.del (archive)", invoke: (b) => b.enrollments.requirementOverrides.del("enr_1", "ovr_1"), method: "DELETE", path: "/enrollments/enr_1/requirement_overrides/ovr_1" },
  { name: "programs.standingPreview (simulate — claim keys frozen)", invoke: (b) => b.programs.standingPreview("prog_1", { enrollment: "enr_1", simulate: { operatingType: "advisor", assertions: { advisor_verified: true } } }), method: "POST", path: "/programs/prog_1/standing_preview", body: { enrollment: "enr_1", simulate: { operating_type: "advisor", assertions: { advisor_verified: true } } } },

  // enrollments (flat; payload carries program)
  { name: "enrollments.create", invoke: (b) => b.enrollments.create({ program: "prog_1", email: "c@x.com" }), method: "POST", path: "/enrollments", body: { program: "prog_1", email: "c@x.com" } },
  { name: "enrollments.retrieve", invoke: (b) => b.enrollments.retrieve("enr_1"), method: "GET", path: "/enrollments/enr_1" },
  { name: "enrollments.list", invoke: (b) => b.enrollments.list({ program: "prog_1", approvalStatus: "pending" }), method: "GET", path: "/enrollments?program=prog_1&approval_status=pending" },
  { name: "enrollments.approve", invoke: (b) => b.enrollments.approve("enr_1"), method: "POST", path: "/enrollments/enr_1/approve", body: {} },
  { name: "enrollments.reject", invoke: (b) => b.enrollments.reject("enr_1"), method: "POST", path: "/enrollments/enr_1/reject", body: {} },
  { name: "enrollments.pause", invoke: (b) => b.enrollments.pause("enr_1"), method: "POST", path: "/enrollments/enr_1/pause", body: {} },
  { name: "enrollments.resume", invoke: (b) => b.enrollments.resume("enr_1"), method: "POST", path: "/enrollments/enr_1/resume", body: {} },

  // distributions
  { name: "distributions.create", invoke: (b) => b.distributions.create({ objective: "acquisition", programs: ["prog_1"] }), method: "POST", path: "/distributions", body: { objective: "acquisition", programs: ["prog_1"] } },
  { name: "distributions.update", invoke: (b) => b.distributions.update("dist_1", { name: "Q3" }), method: "POST", path: "/distributions/dist_1", body: { name: "Q3" } },
  { name: "distributions.retrieve", invoke: (b) => b.distributions.retrieve("dist_1"), method: "GET", path: "/distributions/dist_1" },
  { name: "distributions.list", invoke: (b) => b.distributions.list({ status: "active" }), method: "GET", path: "/distributions?status=active" },
  { name: "distributions.validate", invoke: (b) => b.distributions.validate("dist_1"), method: "POST", path: "/distributions/dist_1/validate", body: {} },
  // launch takes no body FIELDS; the only key it accepts is idempotency_key,
  // and the SDK converts the camelCase spelling on the way out.
  { name: "distributions.launch", invoke: (b) => b.distributions.launch("dist_1", { idempotencyKey: "launch-1" }), method: "POST", path: "/distributions/dist_1/launch", body: { idempotency_key: "launch-1" } },
  { name: "distributions.pause", invoke: (b) => b.distributions.pause("dist_1"), method: "POST", path: "/distributions/dist_1/pause", body: {} },
  { name: "distributions.resume", invoke: (b) => b.distributions.resume("dist_1"), method: "POST", path: "/distributions/dist_1/resume", body: {} },
  { name: "distributions.cancel", invoke: (b) => b.distributions.cancel("dist_1"), method: "POST", path: "/distributions/dist_1/cancel", body: {} },

  // deployments
  { name: "deployments.retrieve", invoke: (b) => b.deployments.retrieve("dep_1"), method: "GET", path: "/deployments/dep_1" },
  { name: "deployments.list", invoke: (b) => b.deployments.list({ distribution: "dist_1" }), method: "GET", path: "/deployments?distribution=dist_1" },
  { name: "deployments.pause", invoke: (b) => b.deployments.pause("dep_1"), method: "POST", path: "/deployments/dep_1/pause", body: {} },
  { name: "deployments.resume", invoke: (b) => b.deployments.resume("dep_1"), method: "POST", path: "/deployments/dep_1/resume", body: {} },
  { name: "deployments.cancel", invoke: (b) => b.deployments.cancel("dep_1"), method: "POST", path: "/deployments/dep_1/cancel", body: {} },

  // connections
  { name: "connections.list", invoke: (b) => b.connections.list({ provider: "instagram" }), method: "GET", path: "/connections?provider=instagram" },
  { name: "connections.retrieve", invoke: (b) => b.connections.retrieve("conn_1"), method: "GET", path: "/connections/conn_1" },
  { name: "connections.revoke", invoke: (b) => b.connections.revoke("conn_1"), method: "POST", path: "/connections/conn_1/revoke", body: {} },

  // performance (measurement IN)
  { name: "performance.summary", invoke: (b) => b.performance.summary({ distribution: "dist_1" }), method: "GET", path: "/performance/summary?distribution=dist_1" },
  { name: "performance.events.create", invoke: (b) => b.performance.events.create({ deployment: "dep_1", type: "conversion", value: 4900 }), method: "POST", path: "/performance/events", body: { deployment: "dep_1", type: "conversion", value: 4900 } },

  // events (operational feed OUT)
  { name: "events.list", invoke: (b) => b.events.list({ type: "distribution.live", startingAfter: "evt_9" }), method: "GET", path: "/events?type=distribution.live&starting_after=evt_9" },

  // operations
  { name: "operations.retrieve", invoke: (b) => b.operations.retrieve("op_1"), method: "GET", path: "/operations/op_1" },
  { name: "operations.list", invoke: (b) => b.operations.list({ subjectType: "distribution" }), method: "GET", path: "/operations?subject_type=distribution" },

  // webhooks endpoints CRUD
  { name: "webhooks.endpoints.create", invoke: (b) => b.webhooks.endpoints.create({ url: "https://x.com/wh" }), method: "POST", path: "/webhook_endpoints", body: { url: "https://x.com/wh" } },
  { name: "webhooks.endpoints.retrieve", invoke: (b) => b.webhooks.endpoints.retrieve("we_1"), method: "GET", path: "/webhook_endpoints/we_1" },
  { name: "webhooks.endpoints.update", invoke: (b) => b.webhooks.endpoints.update("we_1", { url: "https://y.com/wh" }), method: "POST", path: "/webhook_endpoints/we_1", body: { url: "https://y.com/wh" } },
  { name: "webhooks.endpoints.list", invoke: (b) => b.webhooks.endpoints.list(), method: "GET", path: "/webhook_endpoints" },
  { name: "webhooks.endpoints.del", invoke: (b) => b.webhooks.endpoints.del("we_1"), method: "DELETE", path: "/webhook_endpoints/we_1" },

  // payouts
  { name: "payouts.list", invoke: (b) => b.payouts.list({ status: "pending" }), method: "GET", path: "/payouts?status=pending" },
  { name: "payouts.run", invoke: (b) => b.payouts.run({ rail: "stripe_connect" }), method: "POST", path: "/payouts/run", body: { rail: "stripe_connect" } },
  { name: "payouts.exportCsv", invoke: (b) => b.payouts.exportCsv({ format: "paypal_payouts_csv" }), method: "POST", path: "/payouts/export_csv", body: { format: "paypal_payouts_csv" } },
  { name: "payouts.connectStatus", invoke: (b) => b.payouts.connectStatus(), method: "GET", path: "/payouts/connect_status" },
  { name: "payouts.batches.list", invoke: (b) => b.payouts.batches.list(), method: "GET", path: "/payouts/batches" },
  { name: "payouts.batches.retrieve", invoke: (b) => b.payouts.batches.retrieve("pb_1"), method: "GET", path: "/payouts/batches/pb_1" },
];

for (const wire of CASES) {
  test(`wire contract: ${wire.name} -> ${wire.method} ${wire.path}`, async () => {
    const { boomin, calls } = createClient([
      { status: 200, body: { object: "list", data: [], has_more: false } },
    ]);
    await wire.invoke(boomin);
    const call = lastCall(calls);
    assert.equal(call.method, wire.method);
    assert.equal(call.url, `${BASE}${wire.path}`);
    if (wire.body === undefined) {
      assert.equal(call.rawBody, null, "expected no request body");
    } else {
      assert.deepEqual(call.body, wire.body);
    }
    if (call.method === "GET") {
      assert.equal("Idempotency-Key" in call.headers, false);
    } else {
      assert.ok(call.headers["Idempotency-Key"], "mutations must carry an Idempotency-Key");
    }
  });
}

test("the 12 resource clients exist", () => {
  const { boomin } = createClient();
  for (const client of [
    "programs", "partners", "partnerships", "enrollments", "distributions", "deployments",
    "connections", "performance", "events", "operations", "webhooks", "payouts",
  ]) {
    assert.ok(boomin[client], `boomin.${client} missing`);
  }
});

test("distributions.launch resolves the 202 envelope verbatim", async () => {
  const envelope = {
    distribution: { id: "dist_1", status: "launching" },
    status: "launching",
    operation: { id: "op_1", status: "pending", kind: "distribution.launch" },
  };
  const { boomin } = createClient([{ status: 202, body: envelope }]);
  const result = await boomin.distributions.launch("dist_1");
  assert.deepEqual(result, envelope);
});

test("operations.wait polls until terminal and returns the operation", async () => {
  const { boomin, calls } = createClient([
    { status: 200, body: { id: "op_1", status: "pending" } },
    { status: 200, body: { id: "op_1", status: "running" } },
    { status: 200, body: { id: "op_1", status: "succeeded" } },
  ]);
  const op = await boomin.operations.wait("op_1", { timeout: 5000, pollInterval: 1 });
  assert.equal(op.status, "succeeded");
  assert.equal(calls.length, 3);
});

test("operations.wait returns failed/partial operations without throwing", async () => {
  const { boomin } = createClient([{ status: 200, body: { id: "op_1", status: "partial" } }]);
  const op = await boomin.operations.wait("op_1", { timeout: 1000, pollInterval: 1 });
  assert.equal(op.status, "partial");
});

test("operations.wait times out with code operation_wait_timeout", async () => {
  const { boomin } = createClient([{ status: 200, body: { id: "op_1", status: "running" } }]);
  const err = await boomin.operations
    .wait("op_1", { timeout: 10, pollInterval: 5 })
    .catch((e) => e);
  assert.equal(err.code, "operation_wait_timeout");
  assert.match(err.message, /op_1/);
});

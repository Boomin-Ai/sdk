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
  { name: "partners.retrieve", invoke: (b) => b.partners.retrieve("ptr_1"), method: "GET", path: "/partners/ptr_1" },
  { name: "partners.list", invoke: (b) => b.partners.list(), method: "GET", path: "/partners" },

  // partnerships
  { name: "partnerships.list", invoke: (b) => b.partnerships.list({ status: "active" }), method: "GET", path: "/partnerships?status=active" },
  { name: "partnerships.retrieve", invoke: (b) => b.partnerships.retrieve("ptn_1"), method: "GET", path: "/partnerships/ptn_1" },
  { name: "partnerships.pause", invoke: (b) => b.partnerships.pause("ptn_1"), method: "POST", path: "/partnerships/ptn_1/pause", body: {} },
  { name: "partnerships.resume", invoke: (b) => b.partnerships.resume("ptn_1"), method: "POST", path: "/partnerships/ptn_1/resume", body: {} },
  { name: "partnerships.end", invoke: (b) => b.partnerships.end("ptn_1", { reason: "done" }), method: "POST", path: "/partnerships/ptn_1/end", body: { reason: "done" } },
  { name: "partnerships.updatePermissions", invoke: (b) => b.partnerships.updatePermissions("ptn_1", { permissions: { publish: true } }), method: "POST", path: "/partnerships/ptn_1/permissions", body: { permissions: { publish: true } } },

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
  { name: "distributions.launch", invoke: (b) => b.distributions.launch("dist_1", { dryRun: true }), method: "POST", path: "/distributions/dist_1/launch", body: { dryRun: true } },
  { name: "distributions.pause", invoke: (b) => b.distributions.pause("dist_1"), method: "POST", path: "/distributions/dist_1/pause", body: {} },
  { name: "distributions.resume", invoke: (b) => b.distributions.resume("dist_1"), method: "POST", path: "/distributions/dist_1/resume", body: {} },
  { name: "distributions.cancel", invoke: (b) => b.distributions.cancel("dist_1"), method: "POST", path: "/distributions/dist_1/cancel", body: {} },

  // deployments
  { name: "deployments.retrieve", invoke: (b) => b.deployments.retrieve("dep_1"), method: "GET", path: "/deployments/dep_1" },
  { name: "deployments.list", invoke: (b) => b.deployments.list({ distribution: "dist_1" }), method: "GET", path: "/deployments?distribution=dist_1" },

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

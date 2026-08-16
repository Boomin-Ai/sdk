/** Relationship-stack groups (CLI 0.7.0): param builders + wire contracts +
 *  `network apply` planning, all through runV1Command with a mock fetch. */

import test from "node:test";
import assert from "node:assert/strict";

import { runV1Command } from "../src/v1.js";
import {
  assertionSubject,
  assertionValue,
  overrideAddParams,
  overridePatchParams,
  parseSimulatedAssertions,
  standingTestParams,
} from "../src/relationship.js";
import { normalizeNetworkFile, planNetworkApply } from "../src/network-apply.js";
import { createMockFetch, createLogCapture } from "./helpers.js";

const TOKEN = "sk_boomin_live_test";
const BASE = "http://127.0.0.1:8791/v1/platform";

function flags(overrides = {}) {
  return { _: [], origins: [], ...overrides };
}

function run(group, subcommand, flagValues, fetchImpl, log = createLogCapture()) {
  return runV1Command(group, subcommand, flags(flagValues), {
    token: TOKEN,
    platformApiBase: BASE,
    fetch: fetchImpl,
    log,
  });
}

// ── Param builders ────────────────────────────────────────────────────────────

test("assertionValue: true/false/number; everything else refused", () => {
  assert.equal(assertionValue("true"), true);
  assert.equal(assertionValue(true), true);
  assert.equal(assertionValue("false"), false);
  assert.equal(assertionValue("42"), 42);
  assert.throws(() => assertionValue("soon"), /--value/);
});

test("assertionSubject: entity XOR externalUserId+issuer", () => {
  assert.deepEqual(assertionSubject({ entity: "ent_1" }, "u"), { entity: "ent_1" });
  assert.deepEqual(
    assertionSubject({ externalUserId: "u_1", issuer: "t.example" }, "u"),
    { externalUserId: "u_1", issuer: "t.example" },
  );
  assert.throws(() => assertionSubject({ externalUserId: "u_1" }, "u"), /--issuer|subject/);
});

test("parseSimulatedAssertions: key=value pairs incl. null (simulate absence)", () => {
  assert.deepEqual(
    parseSimulatedAssertions(["advisor_verified=true", "club_member=null", "gmv=250"]),
    { advisor_verified: true, club_member: null, gmv: 250 },
  );
  assert.throws(() => parseSimulatedAssertions(["notapair"]), /key=value/);
});

test("standingTestParams: simulate assembles only what was asked", () => {
  assert.deepEqual(standingTestParams(flags()), {});
  assert.deepEqual(
    standingTestParams(flags({ enrollment: "enr_1", asserts: ["advisor_verified=true"], operatingType: "advisor" })),
    { enrollment: "enr_1", simulate: { assertions: { advisor_verified: true }, operatingType: "advisor" } },
  );
  assert.deepEqual(
    standingTestParams(flags({ enrollment: "enr_1", operatingType: "null" })),
    { enrollment: "enr_1", simulate: { operatingType: null } },
  );
});

test("override builders: patch needs --requirement, add needs metric+scope", () => {
  assert.deepEqual(
    overridePatchParams(flags({ requirement: "11111111-1111-1111-1111-111111111111", threshold: "5" })),
    { requirement: "11111111-1111-1111-1111-111111111111", threshold: 5 },
  );
  assert.deepEqual(
    overridePatchParams(flags({ requirement: "r1" }), { disabled: true }),
    { requirement: "r1", disabled: true },
  );
  assert.throws(() => overridePatchParams(flags()), /--requirement/);
  assert.deepEqual(
    overrideAddParams(flags({ metricKey: "x:demo_submitted", scope: "program_maintenance", operator: "gte", threshold: "1" })),
    { metricKey: "x:demo_submitted", scope: "program_maintenance", operator: "gte", threshold: 1 },
  );
  assert.throws(() => overrideAddParams(flags({ scope: "tier" })), /--metric-key/);
});

// ── Wire contracts ────────────────────────────────────────────────────────────

test("relationship list speaks the canonical route; partnership is an alias of it", async () => {
  for (const group of ["relationship", "partnership"]) {
    const fetchMock = createMockFetch([{ status: 200, body: { object: "list", data: [], has_more: false } }]);
    await run(group, "list", {}, fetchMock);
    assert.equal(fetchMock.calls[0].url, `${BASE}/relationships`);
  }
});

test("assertion assert posts the claim-addressed body", async () => {
  const fetchMock = createMockFetch([{ status: 201, body: { object: "assertion", id: "asrt_1", key: "advisor_verified", value: 1 } }]);
  await run("assertion", "assert", { entity: "ent_1", key: "advisor_verified", value: "true", expiresAt: "2030-01-01T00:00:00Z" }, fetchMock);
  const call = fetchMock.calls[0];
  assert.equal(call.url, `${BASE}/assertions`);
  assert.deepEqual(call.body, { entity: "ent_1", key: "advisor_verified", value: true, expires_at: "2030-01-01T00:00:00Z" });
});

test("assertion revoke is claim-addressed — subject + key", async () => {
  const fetchMock = createMockFetch([{ status: 200, body: { object: "assertion", key: "advisor_verified", action: "revoked" } }]);
  await run("assertion", "revoke", { externalUserId: "u_1", issuer: "t.example", key: "advisor_verified" }, fetchMock);
  assert.equal(fetchMock.calls[0].url, `${BASE}/assertions/revoke`);
  assert.deepEqual(fetchMock.calls[0].body, { external_user_id: "u_1", issuer: "t.example", key: "advisor_verified" });
});

test("operating-type create + metric register hit the vocabulary routes", async () => {
  const fetchMock = createMockFetch([{ status: 201, body: { object: "operating_type", id: "otype_1", key: "advisor", name: "Advisor", status: "active" } }]);
  await run("operating-type", "create", { _: ["advisor"], name: "Advisor" }, fetchMock);
  assert.equal(fetchMock.calls[0].url, `${BASE}/operating_types`);
  assert.deepEqual(fetchMock.calls[0].body, { key: "advisor", name: "Advisor" });

  const metricMock = createMockFetch([{ status: 201, body: { object: "metric_key", id: "mkey_1", key: "x:demo_submitted", status: "active" } }]);
  await run("metric", "register", { _: ["x:demo_submitted"], displayName: "Demos" }, metricMock);
  assert.equal(metricMock.calls[0].url, `${BASE}/metric_keys`);
  assert.deepEqual(metricMock.calls[0].body, { key: "x:demo_submitted", display_name: "Demos" });
});

test("standing test posts {enrollment, simulate} and renders the verdict + provenance", async () => {
  const fetchMock = createMockFetch([{
    status: 200,
    body: {
      object: "program.standing_preview", program: "prog_1", dry_run: true,
      enrollment: {
        object: "program.standing_result", enrollment: "enr_1", partner: "ent_1",
        status: "qualified", stored_status: "not_qualified", score: 1,
        met: [{ requirement: "r1", metric_key: "assert:advisor_verified", scope: "program_maintenance" }],
        failed: [],
        tier: null, operating_type: "otype_1",
        assertions: [{ key: "advisor_verified", value: 1, expires_at: null, simulated: true }],
        simulated: { assertions: { advisor_verified: true } },
      },
    },
  }]);
  const log = createLogCapture();
  await run("standing", "test", { program: "prog_1", enrollment: "enr_1", asserts: ["advisor_verified=true"] }, fetchMock, log);
  const call = fetchMock.calls[0];
  assert.equal(call.url, `${BASE}/programs/prog_1/standing_preview`);
  assert.deepEqual(call.body, { enrollment: "enr_1", simulate: { assertions: { advisor_verified: true } } });
  assert.match(log.text(), /PASS/);
  assert.match(log.text(), /stored: not_qualified/);
  assert.match(log.text(), /advisor_verified = 1\s+\(simulated\)/);
});

test("standing test refuses simulate without an enrollment", async () => {
  await assert.rejects(
    () => run("standing", "test", { program: "prog_1", asserts: ["advisor_verified=true"] }, createMockFetch()),
    /--enrollment/,
  );
});

test("enrollment set-type + overrides ride the enrollment routes", async () => {
  const fetchMock = createMockFetch([{ status: 200, body: { object: "enrollment", id: "enr_1", operating_type: "otype_1" } }]);
  await run("enrollment", "set-type", { _: ["enr_1"], type: "advisor" }, fetchMock);
  assert.equal(fetchMock.calls[0].url, `${BASE}/enrollments/enr_1`);
  assert.deepEqual(fetchMock.calls[0].body, { operating_type: "advisor" });

  const overrideMock = createMockFetch([{ status: 201, body: { object: "requirement_override", id: "ovr_1", requirement: "r1", disabled: true, status: "active" } }]);
  await run("enrollment", "overrides", { _: ["disable", "enr_1"], requirement: "r1" }, overrideMock);
  assert.equal(overrideMock.calls[0].url, `${BASE}/enrollments/enr_1/requirement_overrides`);
  assert.deepEqual(overrideMock.calls[0].body, { requirement: "r1", disabled: true });
});

// ── network apply ─────────────────────────────────────────────────────────────

test("normalizeNetworkFile refuses money-rule sections loudly", () => {
  assert.throws(
    () => normalizeNetworkFile({ program: "prog_1", payout_rules: [] }),
    /not applied by this CLI version/,
  );
});

/** URL-routed mock client (order-independent — planNetworkApply reads live
 *  state via Promise.all). */
function routedClient(routes) {
  const request = async (url) => {
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) return body;
    }
    throw new Error(`Unrouted: ${url}`);
  };
  const page = (data) => ({ object: "list", data, hasMore: false });
  return {
    programs: {
      retrieve: async (id) => request(`/programs/${id}$`),
      requirements: { list: async (id) => page(await request(`/programs/${id}/requirements`)) },
      tiers: { list: async (id) => page(await request(`/programs/${id}/tiers`)) },
    },
    operatingTypes: { list: async () => page(await request("/operating_types")) },
    metricKeys: { list: async () => page(await request("/metric_keys")) },
  };
}

test("planNetworkApply: creates what's missing, patches drift, archives absences, orders vocabulary first", async () => {
  const client = routedClient([
    ["/programs/prog_1/requirements", [
      { id: "r_keep", metricKey: "gmv_cents", scope: "program_maintenance", operatingType: null, operator: "gte", threshold: 100, status: "active" },
      { id: "r_stale", metricKey: "views", scope: "program_maintenance", operatingType: null, operator: "gte", threshold: 1, status: "active" },
    ]],
    ["/programs/prog_1/tiers", []],
    ["/programs/prog_1$", { id: "prog_1", name: "Creators", status: "active" }],
    ["/operating_types", [{ id: "ot_adv", key: "advisor", name: "Advisor", status: "active" }]],
    ["/metric_keys", [{ id: "mk_b", key: "views", builtin: true, status: "active" }]],
  ]);
  const { plan } = await planNetworkApply(client, {
    program: "prog_1",
    operating_types: [{ key: "advisor", name: "Advisors" }, { key: "reseller" }],
    metric_keys: [{ key: "x:demo_submitted" }],
    requirements: [
      { metric_key: "gmv_cents", scope: "program_maintenance", operator: "gte", threshold: 500 },
      { metric_key: "assert:advisor_verified", scope: "program_maintenance", operator: "exists", operating_type: "advisor", failure_policy: "immediate" },
    ],
  });
  const summary = plan.map((s) => `${s.kind} ${s.resource} ${s.label}`);
  assert.deepEqual(summary, [
    "update operating_type advisor",
    "create operating_type reseller",
    "create metric_key x:demo_submitted",
    "update requirement gmv_cents",
    "create requirement assert:advisor_verified @advisor",
    "archive requirement views",
  ]);
  // Vocabulary lands before the requirements that name it.
  assert.ok(summary.indexOf("create operating_type reseller") < summary.findIndex((s) => s.startsWith("create requirement")));
});

test("planNetworkApply: a requirement naming an undeclared, un-live type fails the diff", async () => {
  const client = routedClient([
    ["/programs/prog_1/requirements", []],
    ["/programs/prog_1/tiers", []],
    ["/programs/prog_1$", { id: "prog_1", name: "Creators" }],
    ["/operating_types", []],
    ["/metric_keys", []],
  ]);
  await assert.rejects(
    () => planNetworkApply(client, {
      program: "prog_1",
      requirements: [{ metric_key: "gmv_cents", scope: "program_maintenance", operating_type: "ghost" }],
    }),
    /neither live nor declared/,
  );
});

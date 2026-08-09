import test from "node:test";
import assert from "node:assert/strict";

import {
  sdkBaseUrl,
  parseCsv,
  parseJsonFlag,
  distributionCreateParams,
  enrollmentInviteParams,
  formatTable,
  distributionSummary,
  isV1Group,
  runV1Command,
} from "../src/v1.js";
import { ApiError } from "../src/errors.js";
import { createMockFetch, createLogCapture } from "./helpers.js";

const TOKEN = "sk_boomin_live_test";
const BASE = "http://127.0.0.1:8791/v1/platform";

function flags(overrides = {}) {
  return { _: [], origins: [], ...overrides };
}

function run(group, subcommand, flagValues, fetchImpl, log) {
  return runV1Command(group, subcommand, flags(flagValues), {
    token: TOKEN,
    platformApiBase: BASE,
    fetch: fetchImpl,
    log,
  });
}

// ── Parsing ───────────────────────────────────────────────────────────────────

test("sdkBaseUrl strips the /v1/platform suffix down to the API root", () => {
  assert.equal(sdkBaseUrl("https://api.boomin.ai/v1/platform"), "https://api.boomin.ai");
  assert.equal(sdkBaseUrl("http://127.0.0.1:8791/v1/platform/"), "http://127.0.0.1:8791");
  assert.equal(sdkBaseUrl("https://api.boomin.ai"), "https://api.boomin.ai");
});

test("parseCsv splits and trims", () => {
  assert.deepEqual(parseCsv(" prog_a, prog_b ,,"), ["prog_a", "prog_b"]);
  assert.deepEqual(parseCsv(undefined), []);
});

test("parseJsonFlag rejects malformed JSON with the flag name", () => {
  assert.deepEqual(parseJsonFlag('{"a":1}', "spec"), { a: 1 });
  assert.equal(parseJsonFlag(undefined, "spec"), undefined);
  assert.throws(() => parseJsonFlag("{nope", "spec"), /--spec must be valid JSON/);
});

test("distributionCreateParams shapes programs csv + budget flags", () => {
  const params = distributionCreateParams(flags({
    name: "Launch",
    objective: "acquisition",
    programs: "prog_a,prog_b",
    budgetMode: "funded",
    budgetAsset: "credit",
    budgetTotal: "10000",
  }));
  assert.deepEqual(params, {
    name: "Launch",
    objective: "acquisition",
    programs: ["prog_a", "prog_b"],
    budget: { mode: "funded", asset: "credit", total: 10000 },
  });
});

test("distributionCreateParams prefers --budget JSON and requires --name", () => {
  const params = distributionCreateParams(flags({
    name: "L",
    budget: '{"mode":"metered"}',
    budgetMode: "funded",
  }));
  assert.deepEqual(params.budget, { mode: "metered" });
  assert.throws(() => distributionCreateParams(flags({})), /--name is required/);
});

test("enrollmentInviteParams requires program and a target identity", () => {
  assert.throws(() => enrollmentInviteParams(flags({})), /--program is required/);
  assert.throws(() => enrollmentInviteParams(flags({ program: "prog_x" })), /--email or --partner/);
  // One vocabulary: the CLI hands the SDK camelCase and the SDK converts.
  assert.deepEqual(
    enrollmentInviteParams(flags({ program: "prog_x", email: "a@b.co", referralCode: "ada10" })),
    { program: "prog_x", email: "a@b.co", referralCode: "ada10" },
  );
});

// ── Output shaping ────────────────────────────────────────────────────────────

test("formatTable pads columns and handles empty lists", () => {
  const rows = [
    { id: "dist_1", status: "draft" },
    { id: "dist_22", status: "active" },
  ];
  const rendered = formatTable(rows, [
    { header: "ID", value: (r) => r.id },
    { header: "STATUS", value: (r) => r.status },
  ]);
  assert.equal(rendered, "ID       STATUS\ndist_1   draft\ndist_22  active");
  assert.equal(formatTable([], [{ header: "ID", value: (r) => r.id }]), "(none)");
});

test("distributionSummary renders rollup + budget lines", () => {
  const text = distributionSummary({
    id: "dist_1",
    name: "Launch",
    status: "active",
    programs: ["prog_a"],
    deployments: { total: 3, live: 2 },
    budget: { mode: "funded", asset: "credit", total: 10000, consumed: 100, released: 0 },
  });
  assert.match(text, /Distribution: dist_1/);
  assert.match(text, /Deployments: 2\/3 live/);
  assert.match(text, /Budget: funded credit 10000 \(consumed 100\)/);
});

// ── Dispatch + wire behavior over a mocked transport ──────────────────────────

test("isV1Group knows the eight groups", () => {
  for (const group of ["program", "distribution", "enrollment", "partnership", "connection", "payout", "webhook", "events"]) {
    assert.ok(isV1Group(group), group);
  }
  assert.ok(!isV1Group("token"));
});

test("distribution launch polls the operation to terminal then refetches", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { distribution: "dist_1", status: "launching", operation: "op_1" } },
    { status: 200, body: { id: "op_1", status: "running" } },
    { status: 200, body: { id: "op_1", status: "succeeded", kind: "distribution.launch" } },
    { status: 200, body: { id: "dist_1", status: "active", deployments: { total: 1, live: 1 } } },
  ]);
  const log = createLogCapture();
  await run("distribution", "launch", { _: ["dist_1"], pollInterval: "0.001", timeout: "5" }, fetchImpl, log);

  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(fetchImpl.calls[0].url, `${BASE}/distributions/dist_1/launch`);
  assert.ok(fetchImpl.calls[0].headers["Idempotency-Key"], "launch carries an Idempotency-Key");
  assert.equal(fetchImpl.calls[1].url, `${BASE}/operations/op_1`);
  assert.equal(fetchImpl.calls[2].url, `${BASE}/operations/op_1`);
  assert.equal(fetchImpl.calls[3].url, `${BASE}/distributions/dist_1`);
  assert.match(log.text(), /Status: succeeded/);
  assert.match(log.text(), /Status: active/);
});

test("distribution launch --no-wait returns the 202 body without polling", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { distribution: "dist_1", status: "launching", operation: "op_1" } },
  ]);
  const log = createLogCapture();
  await run("distribution", "launch", { _: ["dist_1"], noWait: true }, fetchImpl, log);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(log.text(), /Launch accepted: dist_1 status=launching/);
  assert.match(log.text(), /Operation: op_1/);
});

test("distribution create posts shaped params and prints the draft", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "dist_9", object: "distribution", status: "draft", name: "L", programs: ["prog_a"] } },
  ]);
  const log = createLogCapture();
  await run("distribution", "create", { name: "L", programs: "prog_a" }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].url, `${BASE}/distributions`);
  assert.deepEqual(fetchImpl.calls[0].body, { name: "L", programs: ["prog_a"] });
  assert.match(log.text(), /Distribution: dist_9/);
  assert.match(log.text(), /Status: draft/);
});

test("distribution pause waits on the operation returned alongside the 202 body", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { id: "dist_1", object: "distribution", status: "active", operation: "op_7" } },
    { status: 200, body: { id: "op_7", status: "succeeded" } },
    { status: 200, body: { id: "dist_1", status: "paused" } },
  ]);
  const log = createLogCapture();
  await run("distribution", "pause", { _: ["dist_1"], pollInterval: "0.001", timeout: "5" }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].url, `${BASE}/distributions/dist_1/pause`);
  assert.equal(fetchImpl.calls[1].url, `${BASE}/operations/op_7`);
  assert.match(log.text(), /Status: paused/);
});

test("enrollment invite → approve round-trip hits the flat enrollment routes", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "enr_1", program: "prog_a", partnership: "pship_1", approval_status: "pending", status: "active" } },
    { status: 200, body: { id: "enr_1", approval_status: "approved", status: "active" } },
  ]);
  const log = createLogCapture();
  await run("enrollment", "invite", { program: "prog_a", email: "ada@example.com" }, fetchImpl, log);
  await run("enrollment", "approve", { _: ["enr_1"] }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].url, `${BASE}/enrollments`);
  assert.deepEqual(fetchImpl.calls[0].body, { program: "prog_a", email: "ada@example.com" });
  assert.equal(fetchImpl.calls[1].url, `${BASE}/enrollments/enr_1/approve`);
  assert.match(log.text(), /Approval: approved/);
});

test("enrollment list forwards program/status filters as snake_case query", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", data: [], has_more: false } },
  ]);
  const log = createLogCapture();
  await run("enrollment", "list", { program: "prog_a", approvalStatus: "pending", limit: "5" }, fetchImpl, log);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/v1/platform/enrollments");
  assert.equal(url.searchParams.get("program"), "prog_a");
  assert.equal(url.searchParams.get("approval_status"), "pending");
  assert.equal(url.searchParams.get("limit"), "5");
});

test("payout list renders the list envelope as a table", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", data: [{ id: "po_1", status: "pending", amount_cents: 1200, period_start: "2026-08-01", period_end: "2026-09-01" }], has_more: false } },
  ]);
  const log = createLogCapture();
  await run("payout", "list", {}, fetchImpl, log);
  assert.equal(new URL(fetchImpl.calls[0].url).pathname, "/v1/platform/payouts");
  assert.match(log.text(), /po_1\s+pending\s+1200/);
});

test("webhook create unwraps {webhook_endpoint} and reveals the secret once", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { webhook_endpoint: { id: "we_1", url: "https://x.co/h", status: "enabled", enabled_events: [], secret: "whsec_abc" } } },
  ]);
  const log = createLogCapture();
  await run("webhook", "create", { url: "https://x.co/h" }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].url, `${BASE}/webhook_endpoints`);
  assert.match(log.text(), /Endpoint: we_1/);
  assert.match(log.text(), /whsec_abc/);
});

test("webhook rotate-secret posts to /rotate_secret and delete uses DELETE", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { webhook_endpoint: { id: "we_1", secret: "whsec_new" } } },
    { status: 200, body: { id: "we_1", object: "webhook_endpoint", deleted: true } },
  ]);
  const log = createLogCapture();
  await run("webhook", "rotate-secret", { _: ["we_1"] }, fetchImpl, log);
  await run("webhook", "delete", { _: ["we_1"] }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(fetchImpl.calls[0].url, `${BASE}/webhook_endpoints/we_1/rotate_secret`);
  assert.equal(fetchImpl.calls[1].method, "DELETE");
  assert.equal(fetchImpl.calls[1].url, `${BASE}/webhook_endpoints/we_1`);
  assert.match(log.text(), /whsec_new/);
  assert.match(log.text(), /Deleted webhook endpoint we_1/);
});

test("events list forwards --type and prints seq-ordered rows", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", data: [{ id: "evt_1", seq: 42, type: "distribution.live", subject: { type: "distribution", id: "dist_1" } }], has_more: false } },
  ]);
  const log = createLogCapture();
  await run("events", "list", { type: "distribution.live" }, fetchImpl, log);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/v1/platform/events");
  assert.equal(url.searchParams.get("type"), "distribution.live");
  assert.match(log.text(), /42\s+evt_1\s+distribution\.live/);
});

test("--json prints the SDK's camelCase objects, not the raw wire body", async () => {
  // The wire stays snake_case; the SDK camelCases keys on the way back, so the
  // CLI's machine-readable output speaks the same vocabulary as its flags.
  const body = { object: "list", data: [{ id: "dist_1", status: "draft", plan_hash: "h" }], has_more: false };
  const fetchImpl = createMockFetch([{ status: 200, body }]);
  const log = createLogCapture();
  await run("distribution", "list", { json: true }, fetchImpl, log);
  assert.deepEqual(JSON.parse(log.text()), {
    object: "list",
    data: [{ id: "dist_1", status: "draft", planHash: "h" }],
    hasMore: false,
  });
});

test("payout export accepts a 202, polls the operation, then reads the batch", async () => {
  // The 202 carries id STRINGS and no URL; download_url is minted on READ of
  // the batch, so the command has to make the second call to find the file.
  const fetchImpl = createMockFetch([
    { status: 202, body: { batch: "pb_1", status: "exporting", operation: "op_1", items: [{ id: "pbi_1" }], skipped: [] } },
    { status: 200, body: { id: "op_1", status: "succeeded", kind: "payout_batch.export" } },
    { status: 200, body: { id: "pb_1", status: "exported", export_file_key: "k", download_url: "https://r2.test/pb_1.csv" } },
  ]);
  const log = createLogCapture();
  await run("payout", "export", { periodStart: "2026-08-01", periodEnd: "2026-09-01", pollInterval: 0.001 }, fetchImpl, log);
  // periodStart/periodEnd went out as the snake_case wire form.
  assert.deepEqual(fetchImpl.calls[0].body, { period_start: "2026-08-01", period_end: "2026-09-01" });
  assert.equal(new URL(fetchImpl.calls[1].url).pathname, "/v1/platform/operations/op_1");
  assert.equal(new URL(fetchImpl.calls[2].url).pathname, "/v1/platform/payouts/batches/pb_1");
  assert.match(log.text(), /Export key: k/);
  assert.match(log.text(), /Download: https:\/\/r2\.test\/pb_1\.csv/);
});

test("webhook create sends enabledEvents and renders the camelCase echo", async () => {
  const fetchImpl = createMockFetch([
    {
      status: 201,
      body: { webhook_endpoint: { id: "we_1", url: "https://x.com/wh", enabled_events: ["payout.settled"], secret: "whsec_1" } },
    },
  ]);
  const log = createLogCapture();
  await run("webhook", "create", { url: "https://x.com/wh", events: "payout.settled" }, fetchImpl, log);
  assert.deepEqual(fetchImpl.calls[0].body, {
    url: "https://x.com/wh",
    enabled_events: ["payout.settled"],
  });
  assert.match(log.text(), /Events: payout\.settled/);
  assert.match(log.text(), /whsec_1/);
});

test("missing_scope errors surface as ApiError with a suggested command", async () => {
  const fetchImpl = createMockFetch([
    { status: 403, body: { error: { code: "missing_scope", message: "missing_scope:distributions:launch" } } },
  ]);
  const log = createLogCapture();
  await assert.rejects(
    () => run("distribution", "launch", { _: ["dist_1"], noWait: true }, fetchImpl, log),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "missing_scope");
      assert.equal(error.requiredScope, "distributions:launch");
      assert.match(error.suggestedCommand, /distributions:launch/);
      return true;
    },
  );
});

test("typed v1 error codes pass through (distribution_not_found)", async () => {
  const fetchImpl = createMockFetch([
    { status: 404, body: { error: { code: "distribution_not_found", message: "Distribution not found." } } },
  ]);
  await assert.rejects(
    () => run("distribution", "get", { _: ["dist_nope"] }, createMockFetch([
      { status: 404, body: { error: { code: "distribution_not_found", message: "Distribution not found." } } },
    ]), createLogCapture()),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "distribution_not_found");
      assert.equal(error.status, 404);
      return true;
    },
  );
  void fetchImpl;
});

test("unknown subcommand throws with the verb list", async () => {
  await assert.rejects(
    () => run("distribution", "destroy", {}, createMockFetch(), createLogCapture()),
    /Unknown distribution subcommand: destroy/,
  );
});

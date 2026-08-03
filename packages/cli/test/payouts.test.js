/**
 * CLI 0.4.0 — `payout rules|rails|batches`, and the two behaviours that decide
 * whether a scheduled payout job is trustworthy:
 *
 *   1. `payout run` EXITS NON-ZERO when nothing is configured. A config error
 *      that printed a cheerful zero would let a monthly job "succeed" forever
 *      while paying nobody.
 *   2. `payout export` polls the operation and then READS the batch for the
 *      presigned URL, because the 202 does not carry one.
 *
 * Plus the flag→payload builders, where `--columns` must reach the wire
 * untouched: those headers are the file a bank ingests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  booleanFlag,
  numberFlag,
  payoutRailCreateParams,
  payoutRuleCreateParams,
  payoutRuleScope,
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

const pathOf = (call) => new URL(call.url).pathname;

// ── Flag → payload ────────────────────────────────────────────────────────────

test("numberFlag rejects garbage instead of letting NaN reach a money field", () => {
  assert.equal(numberFlag("500", "per-unit-minor"), 500);
  assert.equal(numberFlag(undefined, "per-unit-minor"), undefined);
  assert.throws(() => numberFlag("lots", "per-unit-minor"), /--per-unit-minor must be a number/);
});

test("booleanFlag: bare --default is true, --default=false is false", () => {
  assert.equal(booleanFlag(true), true);
  assert.equal(booleanFlag("false"), false);
  assert.equal(booleanFlag("no"), false);
  assert.equal(booleanFlag("yes"), true);
  assert.equal(booleanFlag(undefined), undefined);
});

test("rule scope is discriminated, and infers its type from the id flag given", () => {
  assert.deepEqual(payoutRuleScope({ program: "prog_1" }), { type: "program", program: "prog_1" });
  assert.deepEqual(payoutRuleScope({ program: "prog_1", member: "enr_9" }), {
    type: "member", program: "prog_1", member: "enr_9",
  });
  // --scope wins outright, for shapes the flags do not spell.
  assert.deepEqual(payoutRuleScope({ scope: '{"type":"unit","program":"prog_1","unit":"u"}' }), {
    type: "unit", program: "prog_1", unit: "u",
  });
});

test("every rule scope needs a program — the evaluator resolves through membership", () => {
  assert.throws(() => payoutRuleScope({}), /--program is required/);
});

test("rule create params speak *Minor, and reject a rule with no type", () => {
  assert.deepEqual(
    payoutRuleCreateParams({
      name: "Registration CPA", type: "cpa", program: "prog_1",
      metricKey: "event_registration", perUnitMinor: "500",
    }),
    {
      name: "Registration CPA", type: "cpa",
      scope: { type: "program", program: "prog_1" },
      metricKey: "event_registration", perUnitMinor: 500,
    },
  );
  assert.throws(() => payoutRuleCreateParams({ name: "x", program: "prog_1" }), /--type is required/);
  assert.throws(() => payoutRuleCreateParams({ type: "cpa", program: "prog_1" }), /--name is required/);
});

test("rail create params carry the columns JSON through unchanged", () => {
  const columns = '[{"key":"email","header":"Email Address"},{"key":"amount","header":"payoutAmount"}]';
  assert.deepEqual(
    payoutRailCreateParams({ rail: "csv_batch", format: "paypal_payouts_csv", columns, default: true }),
    {
      rail: "csv_batch",
      config: {
        format: "paypal_payouts_csv",
        columns: [{ key: "email", header: "Email Address" }, { key: "amount", header: "payoutAmount" }],
      },
      isDefault: true,
    },
  );
  assert.throws(() => payoutRailCreateParams({ format: "x" }), /--rail is required/);
});

// ── Rules ─────────────────────────────────────────────────────────────────────

test("payout rules create posts the discriminated scope and *_minor money", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "prule_1", object: "payout_rule", name: "Registration CPA", type: "cpa", status: "active", scope: { type: "program", program: "prog_1" }, metric_key: "event_registration", per_unit_minor: 500, currency: "usd" } },
  ]);
  const log = createLogCapture();
  await run("payout", "rules", {
    _: ["create"], name: "Registration CPA", type: "cpa", program: "prog_1",
    metricKey: "event_registration", perUnitMinor: "500",
  }, fetchImpl, log);

  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/rules");
  assert.deepEqual(fetchImpl.calls[0].body, {
    name: "Registration CPA",
    type: "cpa",
    scope: { type: "program", program: "prog_1" },
    metric_key: "event_registration",
    per_unit_minor: 500,
  });
  assert.match(log.text(), /Rule: prule_1/);
  assert.match(log.text(), /Per unit \(minor\): 500/);
  // The create output says what to do INSTEAD of editing it later.
  assert.match(log.text(), /payout rules archive prule_1/);
});

test("payout rules list renders scope + economics in one row", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", has_more: false, data: [
      { id: "prule_1", status: "active", type: "revenue_split", name: "Rev share", scope: { type: "program", program: "prog_1" }, rate_bps: 2000 },
    ] } },
  ]);
  const log = createLogCapture();
  await run("payout", "rules", { _: ["list"], program: "prog_1", status: "active" }, fetchImpl, log);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/v1/platform/payouts/rules");
  assert.equal(url.searchParams.get("program"), "prog_1");
  assert.equal(url.searchParams.get("status"), "active");
  assert.match(log.text(), /prule_1\s+active\s+revenue_split\s+program:prog_1\s+2000bps/);
});

test("payout rules archive is a POST to /archive and says history is kept", async () => {
  const fetchImpl = createMockFetch([{ status: 200, body: { id: "prule_1", status: "archived" } }]);
  const log = createLogCapture();
  await run("payout", "rules", { _: ["archive", "prule_1"] }, fetchImpl, log);
  assert.equal(fetchImpl.calls[0].method, "POST");
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/rules/prule_1/archive");
  assert.match(log.text(), /Archived prule_1/);
  assert.match(log.text(), /stays in the ledger/);
});

test("payout rules update refuses an economics-only invocation before it reaches the wire", async () => {
  const fetchImpl = createMockFetch();
  await assert.rejects(
    () => run("payout", "rules", { _: ["update", "prule_1"], rateBps: "2000" }, fetchImpl, createLogCapture()),
    /Pass --name and\/or --status/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("immutable_parameter comes back typed, with the replacement command attached", async () => {
  const fetchImpl = createMockFetch([
    { status: 400, body: { error: { code: "immutable_parameter", param: "rate_bps", message: "'rate_bps' cannot be changed after a payout rule is created" } } },
  ]);
  await assert.rejects(
    () => run("payout", "rules", { _: ["update", "prule_1"], status: "paused" }, fetchImpl, createLogCapture()),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "immutable_parameter");
      assert.match(error.suggestedCommand, /payout rules archive/);
      return true;
    },
  );
});

// ── Rails ─────────────────────────────────────────────────────────────────────

test("payout rails create sends columns byte-identical and reads them back the same", async () => {
  // Every header here is one the camel/snake converter would happily mangle.
  const columns = [
    { key: "email", header: "Email Address" },
    { key: "amount", header: "payoutAmount" },
    { key: "name", header: "Recipient_Name" },
  ];
  const stored = { format: "paypal_payouts_csv", wallet_funded: false, columns };
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "prail_1", object: "payout_rail", rail: "csv_batch", status: "active", is_default: true, config: stored } },
  ]);
  const log = createLogCapture();
  await run("payout", "rails", {
    _: ["create"], rail: "csv_batch", format: "paypal_payouts_csv",
    walletFunded: "false", default: true, columns: JSON.stringify(columns),
  }, fetchImpl, log);

  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/rails");
  // API-owned half converted; customer-owned half did not move at all.
  assert.deepEqual(fetchImpl.calls[0].body, {
    rail: "csv_batch",
    is_default: true,
    config: { format: "paypal_payouts_csv", wallet_funded: false, columns },
  });
  assert.equal(JSON.stringify(fetchImpl.calls[0].body.config.columns), JSON.stringify(columns));
  // …and the printed rail shows them exactly as stored.
  assert.match(log.text(), /Columns: \[\{"key":"email","header":"Email Address"\}/);
  assert.match(log.text(), /Default: yes/);
});

test("payout rails list shows which rail is default and how many columns it maps", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { object: "list", has_more: false, data: [
      { id: "prail_1", rail: "csv_batch", status: "active", is_default: true, config: { format: "wise_batch_csv", columns: [{ key: "email", header: "E" }] } },
      { id: "prail_2", rail: "stripe_connect", status: "disabled", is_default: false, config: {} },
    ] } },
  ]);
  const log = createLogCapture();
  await run("payout", "rails", { _: ["list"] }, fetchImpl, log);
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/rails");
  assert.match(log.text(), /prail_1\s+csv_batch\s+active\s+yes\s+wise_batch_csv\s+1/);
  assert.match(log.text(), /prail_2\s+stripe_connect\s+disabled/);
});

test("payout_rail_already_exists suggests listing rails, never retrying the create", async () => {
  const fetchImpl = createMockFetch([
    { status: 409, body: { error: { code: "payout_rail_already_exists", param: "rail", message: "The 'csv_batch' rail is already configured for this brand." } } },
  ]);
  await assert.rejects(
    () => run("payout", "rails", { _: ["create"], rail: "csv_batch", format: "wise_batch_csv" }, fetchImpl, createLogCapture()),
    (error) => {
      assert.equal(error.code, "payout_rail_already_exists");
      assert.equal(error.status, 409);
      assert.match(error.suggestedCommand, /payout rails list/);
      return true;
    },
  );
});

test("payout rails update with no flags refuses rather than POSTing an empty replace", async () => {
  const fetchImpl = createMockFetch();
  await assert.rejects(
    () => run("payout", "rails", { _: ["update", "prail_1"] }, fetchImpl, createLogCapture()),
    /Pass at least one of/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ── run ───────────────────────────────────────────────────────────────────────

test("payout run prints the outcome and every counter", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: {
      object: "payout_run", outcome: "no_eligible_activity",
      rules_evaluated: 3, splits_evaluated: 1, events_evaluated: 14,
      payouts_created: 0, underfunded: 0, awaiting_account: 0, payouts: [],
      summary: { total_amount_minor: 0, count: 0, awaiting_account: 0, bridged: 0, unresolved_recipients: 0 },
    } },
  ]);
  const log = createLogCapture();
  await run("payout", "run", { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, fetchImpl, log);
  const text = log.text();
  assert.match(text, /Payout run 2026-08-01\.\.2026-09-01: no_eligible_activity/);
  assert.match(text, /Rules evaluated: 3/);
  assert.match(text, /Splits evaluated: 1/);
  assert.match(text, /Events evaluated: 14/);
  assert.match(text, /Payouts created: 0/);
  assert.match(text, /Awaiting account: 0/);
  assert.match(text, /Total \(minor\): 0/);
  // A configured brand with a quiet month is a SUCCESS, and says why.
  assert.match(text, /nothing qualified/);
});

test("payout run FAILS on payout_rules_required — a config error is not a quiet zero", async () => {
  const fetchImpl = createMockFetch([
    { status: 409, body: { error: {
      code: "payout_rules_required", param: "rules",
      message: "This brand has no active payout rule and no active content split.",
    } } },
  ]);
  await assert.rejects(
    () => run("payout", "run", { periodStart: "2026-08-01", periodEnd: "2026-09-01" }, fetchImpl, createLogCapture()),
    (error) => {
      // Throwing is how the CLI exits non-zero (cli.js sets process.exitCode
      // = 1 on any rejection). If this ever resolved, a monthly payout job
      // would report success while paying nobody.
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "payout_rules_required");
      assert.equal(error.status, 409);
      assert.match(error.suggestedCommand, /payout rules create/);
      return true;
    },
  );
});

// ── batches ───────────────────────────────────────────────────────────────────

test("payout batches create freezes synchronously and points at export", async () => {
  const fetchImpl = createMockFetch([
    { status: 201, body: { id: "pb_1", object: "payout_batch", rail: "csv_batch", status: "built", item_count: 2, total_amount_cents: 4200, items: [{ id: "pbi_1" }, { id: "pbi_2" }], skipped: [] } },
  ]);
  const log = createLogCapture();
  await run("payout", "batches", { _: ["create"], rail: "csv_batch", periodStart: "2026-08-01", periodEnd: "2026-09-01" }, fetchImpl, log);
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/batches");
  assert.deepEqual(fetchImpl.calls[0].body, { rail: "csv_batch", period_start: "2026-08-01", period_end: "2026-09-01" });
  assert.match(log.text(), /Batch: pb_1/);
  assert.match(log.text(), /payout batches export pb_1/);
});

test("payout batches export polls the operation, reads the batch, writes --out", async () => {
  const csv = "Email Address,Amount\npartner@example.com,42.00\n";
  const fetchImpl = createMockFetch([
    { status: 202, body: { batch: "pb_1", status: "exporting", operation: "op_1" } },
    { status: 200, body: { id: "op_1", status: "running" } },
    { status: 200, body: { id: "op_1", status: "succeeded", kind: "payout_batch.export" } },
    { status: 200, body: { id: "pb_1", status: "exported", export_file_key: "exports/pb_1.csv", download_url: "https://r2.test/pb_1.csv", item_count: 1 } },
    { status: 200, body: csv },
  ]);
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "boomin-cli-")), "payouts.csv");
  const log = createLogCapture();
  await run("payout", "batches", { _: ["export", "pb_1"], out, pollInterval: 0.001 }, fetchImpl, log);

  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/batches/pb_1/export");
  assert.equal(pathOf(fetchImpl.calls[1]), "/v1/platform/operations/op_1");
  assert.equal(pathOf(fetchImpl.calls[3]), "/v1/platform/payouts/batches/pb_1");
  assert.equal(fetchImpl.calls[4].url, "https://r2.test/pb_1.csv");
  assert.equal(JSON.parse(await fs.readFile(out, "utf8")), csv);
  assert.match(log.text(), /Wrote /);
});

test("payout batches export --no-wait hands back the operation id and stops", async () => {
  const fetchImpl = createMockFetch([{ status: 202, body: { batch: "pb_1", status: "exporting", operation: "op_1" } }]);
  const log = createLogCapture();
  await run("payout", "batches", { _: ["export", "pb_1"], noWait: true }, fetchImpl, log);
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(log.text(), /Operation: op_1/);
});

test("an export whose operation FAILED exits non-zero instead of leaving an empty file", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { batch: "pb_1", status: "exporting", operation: "op_1" } },
    { status: 200, body: { id: "op_1", status: "failed", error: { code: "payout_export_unconfigured" } } },
  ]);
  await assert.rejects(
    () => run("payout", "batches", { _: ["export", "pb_1"], out: "/tmp/never-written.csv", pollInterval: 0.001 }, fetchImpl, createLogCapture()),
    (error) => {
      assert.match(error.message, /finished 'failed'/);
      return true;
    },
  );
});

test("--out with no download_url is an error, not a 0-byte CSV", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { batch: "pb_1", status: "exporting", operation: "op_1" } },
    { status: 200, body: { id: "op_1", status: "succeeded" } },
    { status: 200, body: { id: "pb_1", status: "exported", export_file_key: "exports/pb_1.csv", download_url: null } },
  ]);
  await assert.rejects(
    () => run("payout", "batches", { _: ["export", "pb_1"], out: "/tmp/never-written.csv", pollInterval: 0.001 }, fetchImpl, createLogCapture()),
    (error) => {
      assert.equal(error.code, "payout_export_unconfigured");
      assert.match(error.message, /no download_url/);
      return true;
    },
  );
});

test("payout batches confirm sends the external ref + results, then follows the operation", async () => {
  const fetchImpl = createMockFetch([
    { status: 202, body: { batch: "pb_1", status: "confirming", operation: "op_2" } },
    { status: 200, body: { id: "op_2", status: "succeeded", kind: "payout_batch.confirm" } },
    { status: 200, body: { id: "pb_1", status: "paid", item_count: 1 } },
  ]);
  const log = createLogCapture();
  await run("payout", "batches", {
    _: ["confirm", "pb_1"],
    externalBatchRef: "PAYPAL-2026-08",
    results: '[{"item":"pbi_1","status":"paid"}]',
    pollInterval: 0.001,
  }, fetchImpl, log);
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/batches/pb_1/confirm");
  assert.deepEqual(fetchImpl.calls[0].body, {
    external_batch_ref: "PAYPAL-2026-08",
    results: [{ item: "pbi_1", status: "paid" }],
  });
  assert.match(log.text(), /Status: paid/);
});

test("payout batches cancel is synchronous", async () => {
  const fetchImpl = createMockFetch([{ status: 200, body: { id: "pb_1", status: "canceled" } }]);
  const log = createLogCapture();
  await run("payout", "batches", { _: ["cancel", "pb_1"] }, fetchImpl, log);
  assert.equal(pathOf(fetchImpl.calls[0]), "/v1/platform/payouts/batches/pb_1/cancel");
  assert.match(log.text(), /Status: canceled/);
});

// ── Dispatch ──────────────────────────────────────────────────────────────────

test("unknown sub-group verbs list the real ones", async () => {
  for (const [group, pattern] of [
    ["rules", /Unknown payout rules subcommand: destroy\. Use list\|create\|show\|update\|archive/],
    ["rails", /Unknown payout rails subcommand: destroy\. Use list\|create\|show\|update/],
    ["batches", /Unknown payout batches subcommand: destroy\. Use list\|show\|create\|export\|confirm\|cancel/],
  ]) {
    await assert.rejects(
      () => run("payout", group, { _: ["destroy"] }, createMockFetch(), createLogCapture()),
      pattern,
    );
  }
  await assert.rejects(
    () => run("payout", "disburse", {}, createMockFetch(), createLogCapture()),
    /Use list\|run\|export\|connect\|rules\|rails\|batches/,
  );
});

test("--json prints camelCase objects for the config surface too", async () => {
  const fetchImpl = createMockFetch([
    { status: 200, body: { id: "prail_1", object: "payout_rail", is_default: true, config: { wallet_funded: true, columns: [{ key: "email", header: "Email Address" }] } } },
  ]);
  const log = createLogCapture();
  await run("payout", "rails", { _: ["show", "prail_1"], json: true }, fetchImpl, log);
  assert.deepEqual(JSON.parse(log.text()), {
    id: "prail_1",
    object: "payout_rail",
    isDefault: true,
    // API-owned keys camelCased; the customer's columns untouched.
    config: { walletFunded: true, columns: [{ key: "email", header: "Email Address" }] },
  });
});

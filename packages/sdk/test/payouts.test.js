/**
 * The payout CONFIGURATION surface: `payouts.{rules,rails,batches}`.
 *
 * The centre of gravity here is `config.columns`. A rail's column mapping
 * decides which field of a payout row lands in the recipient column of a file
 * a human uploads to a bank. The SDK's casing boundary rewrites keys by
 * default; if it rewrote a header inside that array — or reordered it — the
 * exported file would silently become a different file. Every other assertion
 * in this file is a contract check; the `columns` ones are money-correctness.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  Boomin,
  ConflictError,
  InvalidRequestError,
  ImmutableParameterError,
  PayoutBatchEmptyError,
  PayoutBatchStateError,
  PayoutRailAlreadyExistsError,
  PayoutRailRequiredError,
  PayoutRulesRequiredError,
} from "../src/index.js";
import { errorFromResponse } from "../src/errors.js";
import { snakeCaseBody, camelCaseResponse, OPAQUE_FIELDS, REQUEST_FIELD_MAP } from "../src/core.js";
import { createClient, lastCall } from "./helpers.js";

const V1 = "https://api.boomin.ai/v1/platform";

// ── Nesting: one primitive, not three ─────────────────────────────────────────

test("rules/rails/batches hang off payouts — there are no root clients", () => {
  const boomin = new Boomin("sk_test_x");
  for (const nested of ["rules", "rails", "batches"]) {
    assert.equal(typeof boomin.payouts[nested], "object", `payouts.${nested} missing`);
  }
  // Distribution is the flagship primitive; payouts is one supporting system.
  assert.equal(boomin.payoutRules, undefined);
  assert.equal(boomin.payoutRails, undefined);
});

test("a rule is archived, never deleted — del() does not exist", () => {
  const boomin = new Boomin("sk_test_x");
  assert.equal(typeof boomin.payouts.rules.archive, "function");
  // payouts.rule_id cascades: a hard delete would take the ledger rows the
  // rule produced with it, so the verb the API exposes is the verb here.
  assert.equal(boomin.payouts.rules.del, undefined);
});

// ── Paths + verbs ─────────────────────────────────────────────────────────────

test("every method hits its documented path", async () => {
  const { boomin, calls } = createClient([{ status: 200, body: { id: "x" } }]);

  await boomin.payouts.rules.create({ name: "n", type: "cpa", scope: { type: "program", program: "prog_1" } });
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/rules`]);

  await boomin.payouts.rules.list();
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["GET", `${V1}/payouts/rules`]);

  await boomin.payouts.rules.retrieve("prule_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["GET", `${V1}/payouts/rules/prule_1`]);

  await boomin.payouts.rules.update("prule_1", { status: "paused" });
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/rules/prule_1`]);

  await boomin.payouts.rules.archive("prule_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/rules/prule_1/archive`]);
  assert.deepEqual(lastCall(calls).body, {});

  await boomin.payouts.rails.create({ rail: "stripe_connect" });
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/rails`]);

  await boomin.payouts.rails.list();
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["GET", `${V1}/payouts/rails`]);

  await boomin.payouts.rails.retrieve("prail_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["GET", `${V1}/payouts/rails/prail_1`]);

  await boomin.payouts.rails.update("prail_1", { status: "disabled" });
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/rails/prail_1`]);

  await boomin.payouts.batches.create({ rail: "csv_batch" });
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/batches`]);

  await boomin.payouts.batches.export("pbatch_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/batches/pbatch_1/export`]);

  await boomin.payouts.batches.confirm("pbatch_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/batches/pbatch_1/confirm`]);

  await boomin.payouts.batches.cancel("pbatch_1");
  assert.deepEqual([lastCall(calls).method, lastCall(calls).url], ["POST", `${V1}/payouts/batches/pbatch_1/cancel`]);
});

test("mutations carry an Idempotency-Key like every other POST", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "prail_1" } }]);
  await boomin.payouts.rails.create({ rail: "csv_batch", config: { format: "wise_batch_csv" } });
  assert.match(String(lastCall(calls).headers["Idempotency-Key"] ?? ""), /\S/);
});

// ── The scope object (API-owned: it converts) ─────────────────────────────────

test("rule scope is a nested API-owned object, so its keys convert", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "prule_1" } }]);
  await boomin.payouts.rules.create({
    name: "Registration CPA",
    type: "cpa",
    metricKey: "event_registration",
    perUnitMinor: 500,
    scope: { type: "member", program: "prog_1", member: "enr_9" },
  });
  assert.deepEqual(lastCall(calls).body, {
    name: "Registration CPA",
    type: "cpa",
    metric_key: "event_registration",
    per_unit_minor: 500,
    scope: { type: "member", program: "prog_1", member: "enr_9" },
  });
});

test("money is *_minor on the wire, never *_cents", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "prule_1" } }]);
  await boomin.payouts.rules.create({
    name: "Signup bonus",
    type: "threshold_bonus",
    scope: { type: "program", program: "prog_1" },
    metricKey: "event_registration",
    threshold: 10,
    bonusMinor: 25_000,
  });
  const body = lastCall(calls).body;
  assert.equal(body.bonus_minor, 25_000);
  assert.equal(body.bonus_cents, undefined, "the object carries its own currency; 'cents' is USD-specific");
});

test("per_unit_minor / bonus_minor read back as perUnitMinor / bonusMinor", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        id: "prule_1", object: "payout_rule", type: "cpa",
        scope: { type: "program", program: "prog_1" },
        metric_key: "event_registration", per_unit_minor: 500, bonus_minor: null,
        revenue_basis: "net", status: "active",
      },
    },
  ]);
  const rule = await boomin.payouts.rules.retrieve("prule_1");
  assert.equal(rule.perUnitMinor, 500);
  assert.equal(rule.bonusMinor, null);
  assert.equal(rule.metricKey, "event_registration");
  assert.equal(rule.revenueBasis, "net");
  assert.deepEqual(rule.scope, { type: "program", program: "prog_1" });
});

// ── config: the split ─────────────────────────────────────────────────────────

test("config.format and config.walletFunded are API-owned, so they convert", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "prail_1" } }]);
  await boomin.payouts.rails.create({
    rail: "csv_batch",
    isDefault: true,
    config: { format: "paypal_payouts_csv", walletFunded: true },
  });
  assert.deepEqual(lastCall(calls).body, {
    rail: "csv_batch",
    is_default: true,
    config: { format: "paypal_payouts_csv", wallet_funded: true },
  });
});

/**
 * THE ONE THAT MATTERS. Headers are the customer's own words, in the
 * customer's own casing, and they are what a bank reads. Every spelling below
 * is one the key converter would happily mangle if `columns` were not declared
 * opaque: `Email Address` (spaced), `payoutAmount` (camel), `Recipient_Name`
 * (mixed snake), `IBAN` (upper).
 */
const MIXED_CASE_COLUMNS = [
  { key: "email", header: "Email Address" },
  { key: "amount", header: "payoutAmount" },
  { key: "name", header: "Recipient_Name" },
  { key: "reference", header: "IBAN" },
];

test("config.columns leaves the SDK byte-identical on the way out", async () => {
  const { boomin, calls } = createClient([{ status: 201, body: { id: "prail_1" } }]);
  await boomin.payouts.rails.create({
    rail: "csv_batch",
    config: { format: "paypal_payouts_csv", columns: MIXED_CASE_COLUMNS },
  });
  // Serialized from the recorded request body, so this compares what actually
  // went on the wire — key names, header values AND array order.
  assert.equal(
    JSON.stringify(lastCall(calls).body.config.columns),
    JSON.stringify(MIXED_CASE_COLUMNS),
  );
});

test("config.columns comes back byte-identical too — create → retrieve round trip", async () => {
  // The server echoes what it stored. jsonb may reorder the keys WITHIN an
  // entry (see the API's note), so the fixture is written in the order the API
  // actually returns; what must never change is the header text, the key
  // vocabulary, and the ORDER OF THE ARRAY.
  const stored = { format: "paypal_payouts_csv", wallet_funded: false, columns: MIXED_CASE_COLUMNS };
  const { boomin, calls } = createClient([
    { status: 201, body: { id: "prail_1", object: "payout_rail", rail: "csv_batch", is_default: true, config: stored } },
    { status: 200, body: { id: "prail_1", object: "payout_rail", rail: "csv_batch", is_default: true, config: stored } },
  ]);

  const created = await boomin.payouts.rails.create({
    rail: "csv_batch",
    config: { format: "paypal_payouts_csv", columns: MIXED_CASE_COLUMNS },
  });
  const fetched = await boomin.payouts.rails.retrieve("prail_1");

  const sent = JSON.stringify(calls[0].body.config.columns);
  assert.equal(sent, JSON.stringify(MIXED_CASE_COLUMNS), "request left unchanged");
  assert.equal(JSON.stringify(created.config.columns), sent, "create response unchanged");
  assert.equal(JSON.stringify(fetched.config.columns), sent, "retrieve response unchanged");
  // And the API-owned half of the SAME object still converted, both times.
  assert.equal(created.config.walletFunded, false);
  assert.equal(fetched.config.format, "paypal_payouts_csv");
  assert.equal(fetched.config.wallet_funded, undefined);
});

test("columns survive at depth — inside a list, and inside a webhook envelope", () => {
  const columns = MIXED_CASE_COLUMNS;
  const page = camelCaseResponse({
    object: "list",
    has_more: false,
    data: [{ id: "prail_1", object: "payout_rail", is_default: true, config: { wallet_funded: true, columns } }],
  });
  assert.equal(page.hasMore, false);
  assert.equal(page.data[0].isDefault, true);
  assert.equal(page.data[0].config.walletFunded, true);
  assert.equal(JSON.stringify(page.data[0].config.columns), JSON.stringify(columns));

  // No `object` discriminator down here at all — enforcement is by NAME at
  // every depth, which is the whole reason OPAQUE_FIELDS is a global union.
  const envelope = camelCaseResponse({ data: { object: { config: { columns } } } });
  assert.equal(JSON.stringify(envelope.data.object.config.columns), JSON.stringify(columns));
  assert.ok(OPAQUE_FIELDS.has("columns"));
});

test("the request map declares both halves of config — neither alone is correct", () => {
  for (const shape of ["payouts.rails.create", "payouts.rails.update"]) {
    const config = REQUEST_FIELD_MAP[shape].config;
    assert.equal(config.kind, "object", `${shape}: config must be declared, or walletFunded 400s`);
    assert.equal(config.fields.columns.kind, "opaque", `${shape}: columns must be opaque, or headers get rewritten`);
  }
  // Declared-but-not-opaque is the money bug; this is what it would look like.
  const wrong = snakeCaseBody({ config: { columns: [{ key: "email", header: "Email Address" }] } }, "unknown.shape");
  assert.deepEqual(wrong.config.columns[0], { key: "email", header: "Email Address" });
});

test("results[] on confirm is API-owned and converts per element", async () => {
  const { boomin, calls } = createClient([{ status: 202, body: {} }]);
  await boomin.payouts.batches.confirm("pbatch_1", {
    externalBatchRef: "PAYPAL-2026-08",
    results: [{ item: "pbi_1", status: "paid" }, { item: "pbi_2", status: "failed", reason: "closed account" }],
  });
  assert.deepEqual(lastCall(calls).body, {
    external_batch_ref: "PAYPAL-2026-08",
    results: [{ item: "pbi_1", status: "paid" }, { item: "pbi_2", status: "failed", reason: "closed account" }],
  });
});

// ── Changed response shapes ───────────────────────────────────────────────────

test("run resolves outcome + counters + a snake_case summary, all camelCased", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        object: "payout_run", outcome: "no_eligible_activity",
        rules_evaluated: 3, splits_evaluated: 0, events_evaluated: 14,
        payouts_created: 0, underfunded: 0, awaiting_account: 0, payouts: [],
        summary: { total_amount_minor: 0, count: 0, awaiting_account: 0, bridged: 0, unresolved_recipients: 0 },
      },
    },
  ]);
  const run = await boomin.payouts.run({ periodStart: "2026-08-01", periodEnd: "2026-09-01" });
  // A caller branches on THIS, never on `payouts.length`.
  assert.equal(run.outcome, "no_eligible_activity");
  assert.equal(run.rulesEvaluated, 3);
  assert.equal(run.eventsEvaluated, 14);
  assert.equal(run.payoutsCreated, 0);
  assert.equal(run.awaitingAccount, 0);
  assert.equal(run.summary.totalAmountMinor, 0);
  assert.equal(run.summary.unresolvedRecipients, 0);
});

test("run throws PayoutRulesRequiredError — 'unconfigured' is not 'nothing owed'", async () => {
  const { boomin } = createClient([
    { status: 409, body: { error: { code: "payout_rules_required", message: "no active rule", param: "rules" } } },
  ]);
  await assert.rejects(
    () => boomin.payouts.run({ periodStart: "2026-08-01", periodEnd: "2026-09-01" }),
    (err) => {
      assert.ok(err instanceof PayoutRulesRequiredError);
      assert.ok(err instanceof ConflictError, "still catchable as the 409 family");
      assert.equal(err.code, "payout_rules_required");
      assert.equal(err.param, "rules");
      return true;
    },
  );
});

test("exportCsv is a 202 handing back id STRINGS — no download_url", async () => {
  const { boomin } = createClient([
    {
      status: 202,
      body: {
        batch: "pbatch_1", status: "exporting", operation: "op_1",
        items: [{ id: "pbi_1" }], skipped: [],
      },
    },
  ]);
  const accepted = await boomin.payouts.exportCsv({ periodStart: "2026-08-01" });
  assert.equal(accepted.batch, "pbatch_1");
  assert.equal(accepted.operation, "op_1");
  assert.equal(accepted.status, "exporting");
  assert.equal(accepted.downloadUrl, undefined, "the URL now lives on the batch, re-minted on read");
  assert.equal(accepted.items.length, 1);
});

test("batches.retrieve is where downloadUrl lives", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        id: "pbatch_1", object: "payout_batch", status: "exported", item_count: 2,
        total_amount_cents: 4200, export_file_key: "exports/pbatch_1.csv",
        download_url: "https://r2.example/exports/pbatch_1.csv?sig=abc",
        items: [{ id: "pbi_1" }, { id: "pbi_2" }],
      },
    },
  ]);
  const batch = await boomin.payouts.batches.retrieve("pbatch_1");
  assert.equal(batch.downloadUrl, "https://r2.example/exports/pbatch_1.csv?sig=abc");
  assert.equal(batch.exportFileKey, "exports/pbatch_1.csv");
  assert.equal(batch.itemCount, 2);
  assert.equal(batch.items.length, 2);
});

test("connectStatus rails carry identity and state only — never config", async () => {
  const { boomin } = createClient([
    {
      status: 200,
      body: {
        object: "payouts.connect_status",
        rails: [{ id: "prail_1", object: "payout_rail", rail: "csv_batch", status: "active", is_default: true }],
        stripe: { configured: true, partner_accounts: 3, partner_accounts_payouts_enabled: 2 },
      },
    },
  ]);
  const status = await boomin.payouts.connectStatus();
  assert.equal(status.rails[0].isDefault, true);
  assert.equal(status.rails[0].config, undefined, "config is payout_rails:read, not payouts:read");
  assert.equal(status.stripe.partnerAccountsPayoutsEnabled, 2);
});

// ── Error taxonomy ────────────────────────────────────────────────────────────

test("payout codes select their dedicated classes", () => {
  const cases = [
    ["payout_rules_required", 409, PayoutRulesRequiredError],
    ["payout_rail_required", 409, PayoutRailRequiredError],
    ["payout_rail_not_configured", 404, PayoutRailRequiredError],
    ["payout_rail_disabled", 409, PayoutRailRequiredError],
    ["payout_rail_already_exists", 409, PayoutRailAlreadyExistsError],
    ["immutable_parameter", 400, ImmutableParameterError],
    ["payout_batch_empty", 409, PayoutBatchEmptyError],
    ["payout_batch_conflict", 409, PayoutBatchStateError],
    ["payout_batch_not_exportable", 409, PayoutBatchStateError],
    ["payout_batch_not_confirmable", 409, PayoutBatchStateError],
    ["payout_batch_not_cancelable", 409, PayoutBatchStateError],
    ["payout_batch_not_disbursable", 409, PayoutBatchStateError],
  ];
  for (const [code, status, Klass] of cases) {
    const err = errorFromResponse(status, { error: { code, message: code } }, "req_1");
    assert.ok(err instanceof Klass, `${code} -> ${Klass.name}`);
    assert.equal(err.code, code);
    assert.equal(err.status, status);
  }
});

test("codes without a dedicated class still land on the right status family", () => {
  for (const code of ["payout_rule_not_found", "payout_rail_not_found"]) {
    assert.ok(errorFromResponse(404, { error: { code } }, null) instanceof InvalidRequestError);
  }
  assert.ok(errorFromResponse(400, { error: { code: "payout_export_format_invalid" } }, null) instanceof InvalidRequestError);
});

test("an economics edit is refused by the API, and the class says which concept is frozen", async () => {
  const { boomin } = createClient([
    {
      status: 400,
      body: {
        error: {
          code: "immutable_parameter",
          param: "rate_bps",
          message: "'rate_bps' cannot be changed after a payout rule is created",
        },
      },
    },
  ]);
  await assert.rejects(
    () => boomin.payouts.rules.update("prule_1", { rateBps: 2000 }),
    (err) => {
      assert.ok(err instanceof ImmutableParameterError);
      assert.ok(err instanceof InvalidRequestError);
      assert.equal(err.param, "rate_bps");
      return true;
    },
  );
});

test("a second create for a configured rail is a typed conflict, not a silent rewrite", async () => {
  const { boomin } = createClient([
    { status: 409, body: { error: { code: "payout_rail_already_exists", param: "rail", message: "already configured" } } },
  ]);
  await assert.rejects(
    () => boomin.payouts.rails.create({ rail: "csv_batch", config: { format: "wise_batch_csv" } }),
    PayoutRailAlreadyExistsError,
  );
});

// ── Pagination ────────────────────────────────────────────────────────────────

test("rules and rails lists auto-paginate like every other list", async () => {
  const { boomin, calls } = createClient([
    { status: 200, body: { object: "list", data: [{ id: "prule_1" }], has_more: true } },
    { status: 200, body: { object: "list", data: [{ id: "prule_2" }], has_more: false } },
  ]);
  const seen = [];
  for await (const rule of boomin.payouts.rules.list({ status: "active" })) seen.push(rule.id);
  assert.deepEqual(seen, ["prule_1", "prule_2"]);
  assert.match(calls[0].url, /\/payouts\/rules\?status=active/);
  assert.match(calls[1].url, /starting_after=prule_1/);
});

/**
 * CLI 0.4.0 — command groups over the LIVE /v1/platform REST tree
 * (DISTRIBUTION_CORE §4), driven through @boomin/sdk (the wire truth:
 * bare objects, launch = {distribution,status,operation} id strings,
 * errors = {error:{code}}, list envelopes {object:'list',data,has_more} —
 * which the SDK hands back as {object,data,hasMore}).
 *
 * Groups: program, distribution, enrollment, partnership, connection, payout,
 * webhook, events. Operation-returning commands (launch/pause/resume/cancel,
 * and 0.4.0's payout export/confirm) poll the operation to a terminal status by
 * default; --no-wait skips.
 *
 * EXIT CODES. Every command here signals failure by THROWING — cli.js sets
 * process.exitCode = 1 on any rejection. That matters most for `payout run`: a
 * brand with nothing configured answers 409 payout_rules_required, and a
 * config error that printed a cheerful zero and exited 0 would let a scheduled
 * payout job "succeed" every month while paying nobody.
 *
 * CASING: @boomin/sdk speaks camelCase in BOTH directions — params go out as
 * camelCase and responses come back camelCase (`hasMore`, `approvalStatus`,
 * `amountCents`), with the REST wire staying snake_case underneath. So every
 * property read below is camelCase, and `--json` prints the SDK's camelCase
 * object, not the raw wire body.
 */

import fs from "node:fs/promises";
import path from "node:path";
import Boomin, { BoominError } from "@boomin/sdk";
import { ApiError } from "./errors.js";

const TERMINAL_OPERATION_STATUSES = new Set(["succeeded", "partial", "failed", "canceled"]);

// ── Client plumbing ───────────────────────────────────────────────────────────

/** The SDK takes the API ROOT and appends /v1/platform itself. */
export function sdkBaseUrl(platformApiBaseValue) {
  return String(platformApiBaseValue || "")
    .replace(/\/+$/, "")
    .replace(/\/v1\/platform$/, "");
}

export function createV1Client({ token, platformApiBase, brand, fetch: fetchImpl }) {
  return new Boomin(token, {
    baseUrl: sdkBaseUrl(platformApiBase),
    ...(brand ? { brand } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/**
 * The next command to run, per typed error code. Every one of these is a
 * CONFIGURATION fault whose fix is another CLI command — printing the API's
 * sentence and stopping would leave the operator to translate a REST path back
 * into a command themselves.
 */
const CODE_SUGGESTIONS = {
  payout_rules_required:
    'npx @boomin/cli payout rules create --name "Rev share" --type revenue_split --program prog_... --rate-bps 2000',
  payout_rail_required:
    "npx @boomin/cli payout rails create --rail csv_batch --format paypal_payouts_csv --default",
  payout_rail_not_configured:
    "npx @boomin/cli payout rails create --rail csv_batch --format paypal_payouts_csv --default",
  payout_rail_disabled: "npx @boomin/cli payout rails update <prail_id> --status active",
  // Create is not upsert: the fix is to say `update` out loud about the rail
  // that already exists, never to retry the create.
  payout_rail_already_exists: "npx @boomin/cli payout rails list",
  // Economics are frozen once a rule exists; the replacement is a NEW rule.
  immutable_parameter: "npx @boomin/cli payout rules archive <prule_id>",
};

/** Map SDK errors onto the CLI's ApiError so the top-level handler prints
 * typed codes and the missing-scope suggested command. */
function translateError(error) {
  if (!(error instanceof BoominError)) return error;
  const missingScope = String(error.message || "").startsWith("missing_scope:")
    ? error.message.slice("missing_scope:".length)
    : null;
  return new ApiError(error.message, {
    status: error.status ?? undefined,
    code: error.code ?? "error",
    requiredScope: missingScope || undefined,
    suggestedCommand: missingScope
      ? `npx @boomin/cli token create --name "Platform" --scopes org:read,${missingScope} --save`
      : CODE_SUGGESTIONS[error.code] ?? undefined,
    response: error.raw ?? undefined,
  });
}

// ── Flag → payload parsing (exported for unit tests) ──────────────────────────

export function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseJsonFlag(value, flagName) {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`--${flagName} must be valid JSON.`);
  }
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  );
}

export function distributionCreateParams(flags) {
  if (!flags.name) throw new Error("--name is required. Usage: npx @boomin/cli distribution create --name \"Launch\" --programs prog_...");
  const budget = parseJsonFlag(flags.budget, "budget")
    ?? (flags.budgetMode
      ? removeEmpty({
          mode: String(flags.budgetMode),
          asset: flags.budgetAsset ? String(flags.budgetAsset) : undefined,
          total: flags.budgetTotal !== undefined ? Number(flags.budgetTotal) : undefined,
        })
      : undefined);
  return removeEmpty({
    name: String(flags.name),
    objective: flags.objective ? String(flags.objective) : undefined,
    description: flags.description ? String(flags.description) : undefined,
    programs: flags.programs ? parseCsv(flags.programs) : undefined,
    spec: parseJsonFlag(flags.spec, "spec"),
    subjects: parseJsonFlag(flags.subjects, "subjects"),
    budget,
  });
}

/**
 * Flags → POST /programs payload, mirroring the API's programCreateSchema
 * EXACTLY (name required; type/description/visibility/metadata optional).
 * No invented flags: the schema is the contract.
 */
export function programCreateParams(flags) {
  if (!flags.name) throw new Error("--name is required. Usage: npx @boomin/cli program create --name \"Creator program\"");
  return removeEmpty({
    name: String(flags.name),
    type: flags.type ? String(flags.type) : undefined,
    description: flags.description ? String(flags.description) : undefined,
    visibility: flags.visibility ? String(flags.visibility) : undefined,
    metadata: parseJsonFlag(flags.metadata, "metadata"),
  });
}

/** Flags → POST /programs/{id} payload (programUpdateSchema: every field
 * optional, but the API answers an empty patch with a 400 — say so first). */
export function programUpdateParams(flags) {
  const params = removeEmpty({
    name: flags.name ? String(flags.name) : undefined,
    description: flags.description ? String(flags.description) : undefined,
    status: flags.status ? String(flags.status) : undefined,
    visibility: flags.visibility ? String(flags.visibility) : undefined,
    metadata: parseJsonFlag(flags.metadata, "metadata"),
  });
  if (!Object.keys(params).length) {
    throw new Error("Pass at least one of --name, --description, --status, --visibility, --metadata. Usage: npx @boomin/cli program update <prog_id> --status paused");
  }
  return params;
}

export function enrollmentInviteParams(flags) {
  if (!flags.program) throw new Error("--program is required. Usage: npx @boomin/cli enrollment invite --program prog_... --email partner@example.com");
  if (!flags.email && !flags.partner) throw new Error("Pass --email or --partner to identify who to invite.");
  return removeEmpty({
    program: String(flags.program),
    email: flags.email ? String(flags.email) : undefined,
    partner: flags.partner ? String(flags.partner) : undefined,
    name: flags.name ? String(flags.name) : undefined,
    referralCode: flags.referralCode ? String(flags.referralCode) : undefined,
    metadata: parseJsonFlag(flags.metadata, "metadata"),
  });
}

/** A numeric flag, or undefined when absent. Rejects garbage loudly rather
 *  than letting NaN reach a money field. */
export function numberFlag(value, flagName) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${flagName} must be a number.`);
  return parsed;
}

/** A boolean flag: bare `--default` is true, `--default=false` is false. */
export function booleanFlag(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === false) return value;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

/**
 * The rule's scope, as the discriminated object the API takes — never a raw
 * applies_to/scope_id pair. `--program` is required on EVERY variant: the
 * evaluator resolves recipients through program membership, so a rule without
 * one could never pay anybody whatever its type.
 */
export function payoutRuleScope(flags) {
  const explicit = parseJsonFlag(flags.scope, "scope");
  if (explicit) return explicit;
  if (!flags.program) {
    throw new Error("--program is required (every rule scope carries one). Usage: npx @boomin/cli payout rules create --name \"Rev share\" --type revenue_split --program prog_...");
  }
  const inferred = flags.collection ? "collection" : flags.unit ? "unit" : flags.member ? "member" : "program";
  return removeEmpty({
    type: flags.scopeType ? String(flags.scopeType) : inferred,
    program: String(flags.program),
    collection: flags.collection ? String(flags.collection) : undefined,
    unit: flags.unit ? String(flags.unit) : undefined,
    member: flags.member ? String(flags.member) : undefined,
  });
}

/**
 * Money is `--per-unit-minor` / `--bonus-minor`, in minor units of the rule's
 * own currency. There is no `--*-cents` spelling: the rule carries its
 * currency, and "cents" is a USD-specific word.
 */
export function payoutRuleCreateParams(flags) {
  if (!flags.name) throw new Error("--name is required. Usage: npx @boomin/cli payout rules create --name \"Rev share\" --type revenue_split --program prog_... --rate-bps 2000");
  if (!flags.type) throw new Error("--type is required: revenue_split | cpa | threshold_bonus.");
  return removeEmpty({
    name: String(flags.name),
    type: String(flags.type),
    scope: payoutRuleScope(flags),
    metricKey: flags.metricKey ? String(flags.metricKey) : undefined,
    rateBps: numberFlag(flags.rateBps, "rate-bps"),
    perUnitMinor: numberFlag(flags.perUnitMinor, "per-unit-minor"),
    threshold: numberFlag(flags.threshold, "threshold"),
    bonusMinor: numberFlag(flags.bonusMinor, "bonus-minor"),
    windowKey: flags.windowKey ? String(flags.windowKey) : undefined,
    windowDays: numberFlag(flags.windowDays, "window-days"),
    currency: flags.currency ? String(flags.currency) : undefined,
  });
}

/**
 * A rail's config. `--columns` is passed to the API EXACTLY as given: it is the
 * operator's own column mapping, and its headers are what a bank reads. The
 * CLI parses the JSON and hands the array over untouched — the SDK's casing
 * boundary treats it as opaque for the same reason.
 */
export function payoutRailConfig(flags) {
  const explicit = parseJsonFlag(flags.config, "config");
  if (explicit) return explicit;
  const config = removeEmpty({
    format: flags.format ? String(flags.format) : undefined,
    walletFunded: booleanFlag(flags.walletFunded),
    columns: parseJsonFlag(flags.columns, "columns"),
  });
  return Object.keys(config).length ? config : undefined;
}

export function payoutRailCreateParams(flags) {
  if (!flags.rail) throw new Error("--rail is required: csv_batch | stripe_connect. Usage: npx @boomin/cli payout rails create --rail csv_batch --format paypal_payouts_csv --default");
  return removeEmpty({
    rail: String(flags.rail),
    config: payoutRailConfig(flags),
    isDefault: booleanFlag(flags.default ?? flags.isDefault),
    status: flags.status ? String(flags.status) : undefined,
  });
}

export function listParams(flags, extra = {}) {
  return removeEmpty({
    limit: flags.limit !== undefined ? Number(flags.limit) : undefined,
    startingAfter: flags.startingAfter ? String(flags.startingAfter) : undefined,
    ...extra,
  });
}

function requireId(flags, usage) {
  const id = flags._[0];
  if (!id) throw new Error(`An id is required. Usage: ${usage}`);
  return String(id);
}

// ── Output shaping (exported for unit tests) ──────────────────────────────────

export function formatTable(rows, columns) {
  if (!rows.length) return "(none)";
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => String(column.value(row) ?? "").length)));
  const line = (cells) => cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ").trimEnd();
  return [
    line(columns.map((column) => column.header)),
    ...rows.map((row) => line(columns.map((column) => column.value(row)))),
  ].join("\n");
}

export function formatObject(value, fields) {
  return fields
    .filter(([, accessor]) => accessor(value) !== undefined && accessor(value) !== null)
    .map(([label, accessor]) => `${label}: ${formatCell(accessor(value))}`)
    .join("\n");
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function distributionSummary(distribution) {
  const deployments = distribution.deployments
    ? `${distribution.deployments.live}/${distribution.deployments.total} live`
    : undefined;
  const budget = distribution.budget && distribution.budget.mode !== "none"
    ? `${distribution.budget.mode} ${distribution.budget.asset ?? ""} ${distribution.budget.total ?? 0} (consumed ${distribution.budget.consumed ?? 0})`.replace(/\s+/g, " ").trim()
    : undefined;
  return formatObject(distribution, [
    ["Distribution", (d) => d.id],
    ["Name", (d) => d.name],
    ["Objective", (d) => d.objective],
    ["Status", (d) => d.status],
    ["Programs", (d) => (d.programs?.length ? d.programs.join(", ") : undefined)],
    ["Deployments", () => deployments],
    ["Budget", () => budget],
    ["Valid", (d) => d.valid],
    ["Errors", (d) => (Array.isArray(d.errors) && d.errors.length ? JSON.stringify(d.errors) : undefined)],
    ["Created", (d) => d.createdAt],
  ]);
}

export function programSummary(program) {
  return formatObject(program, [
    ["Program", (p) => p.id],
    ["Name", (p) => p.name],
    ["Type", (p) => p.type],
    ["Status", (p) => p.status],
    ["Visibility", (p) => p.visibility],
    ["Description", (p) => p.description],
    ["Metadata", (p) => (p.metadata && Object.keys(p.metadata).length ? JSON.stringify(p.metadata) : undefined)],
    ["Created", (p) => p.createdAt],
  ]);
}

const PROGRAM_COLUMNS = [
  { header: "ID", value: (p) => p.id },
  { header: "STATUS", value: (p) => p.status },
  { header: "TYPE", value: (p) => p.type ?? "" },
  { header: "VISIBILITY", value: (p) => p.visibility ?? "" },
  { header: "NAME", value: (p) => p.name ?? "" },
];

const DISTRIBUTION_COLUMNS = [
  { header: "ID", value: (d) => d.id },
  { header: "STATUS", value: (d) => d.status },
  { header: "OBJECTIVE", value: (d) => d.objective ?? "" },
  { header: "DEPLOYMENTS", value: (d) => (d.deployments ? `${d.deployments.live}/${d.deployments.total}` : "") },
  { header: "NAME", value: (d) => d.name ?? "" },
];

const ENROLLMENT_COLUMNS = [
  { header: "ID", value: (e) => e.id },
  { header: "APPROVAL", value: (e) => e.approvalStatus },
  { header: "STATUS", value: (e) => e.status },
  { header: "PROGRAM", value: (e) => e.program },
  { header: "PARTNERSHIP", value: (e) => e.partnership },
  { header: "CODE", value: (e) => e.referralCode ?? "" },
];

const PARTNERSHIP_COLUMNS = [
  { header: "ID", value: (p) => p.id },
  { header: "STATUS", value: (p) => p.status },
  { header: "PARTNER", value: (p) => (typeof p.partner === "object" ? `${p.partner.name ?? p.partner.email ?? ""} (${p.partner.id})` : p.partner) },
  { header: "STARTED", value: (p) => p.startedAt ?? "" },
];

const CONNECTION_COLUMNS = [
  { header: "ID", value: (c) => c.id },
  { header: "PROVIDER", value: (c) => c.provider },
  { header: "KIND", value: (c) => c.kind },
  { header: "STATUS", value: (c) => c.status },
  { header: "OWNER", value: (c) => (c.owner ? `${c.owner.type}:${c.owner.id}` : "") },
];

const PAYOUT_COLUMNS = [
  { header: "ID", value: (p) => p.id },
  { header: "STATUS", value: (p) => p.status },
  { header: "AMOUNT", value: (p) => (p.amountCents !== undefined ? p.amountCents : p.amount ?? "") },
  { header: "PERIOD", value: (p) => (p.periodStart ? `${p.periodStart}..${p.periodEnd}` : "") },
];

const PAYOUT_RULE_COLUMNS = [
  { header: "ID", value: (r) => r.id },
  { header: "STATUS", value: (r) => r.status },
  { header: "TYPE", value: (r) => r.type },
  { header: "SCOPE", value: (r) => (r.scope ? `${r.scope.type}:${r.scope.program ?? ""}` : "") },
  // The economics, in whichever field this rule type actually uses.
  { header: "ECONOMICS", value: (r) => payoutRuleEconomics(r) },
  { header: "NAME", value: (r) => r.name ?? "" },
];

/** One cell describing what this rule pays — rate, per-unit, or bonus. */
function payoutRuleEconomics(rule) {
  if (rule.rateBps !== undefined && rule.rateBps !== null) return `${rule.rateBps}bps`;
  if (rule.perUnitMinor !== undefined && rule.perUnitMinor !== null) {
    return `${rule.perUnitMinor} ${rule.currency ?? ""}/unit`.trim();
  }
  if (rule.bonusMinor !== undefined && rule.bonusMinor !== null) {
    return `${rule.bonusMinor} ${rule.currency ?? ""} @ ${rule.threshold ?? "?"}`.trim();
  }
  return "";
}

const PAYOUT_RAIL_COLUMNS = [
  { header: "ID", value: (r) => r.id },
  { header: "RAIL", value: (r) => r.rail },
  { header: "STATUS", value: (r) => r.status },
  { header: "DEFAULT", value: (r) => (r.isDefault ? "yes" : "") },
  { header: "FORMAT", value: (r) => r.config?.format ?? "" },
  { header: "COLUMNS", value: (r) => (Array.isArray(r.config?.columns) ? r.config.columns.length : "") },
];

const PAYOUT_BATCH_COLUMNS = [
  { header: "ID", value: (b) => b.id },
  { header: "STATUS", value: (b) => b.status },
  { header: "RAIL", value: (b) => b.rail ?? "" },
  { header: "ITEMS", value: (b) => b.itemCount ?? "" },
  { header: "TOTAL", value: (b) => b.totalAmountCents ?? "" },
  { header: "PERIOD", value: (b) => (b.periodStart ? `${b.periodStart}..${b.periodEnd ?? ""}` : "") },
];

const WEBHOOK_COLUMNS = [
  { header: "ID", value: (w) => w.id },
  { header: "STATUS", value: (w) => w.status },
  { header: "EVENTS", value: (w) => (Array.isArray(w.enabledEvents) && w.enabledEvents.length ? w.enabledEvents.join(",") : "(all)") },
  { header: "URL", value: (w) => w.url },
];

const EVENT_COLUMNS = [
  { header: "SEQ", value: (e) => e.seq },
  { header: "ID", value: (e) => e.id },
  { header: "TYPE", value: (e) => e.type },
  { header: "SUBJECT", value: (e) => (e.subject ? `${e.subject.type}:${e.subject.id}` : "") },
  { header: "CREATED", value: (e) => e.createdAt ?? "" },
];

// ── Operation polling ─────────────────────────────────────────────────────────

async function waitForOperation(client, operationId, flags, log) {
  const timeout = Number(flags.timeout || 120) * 1000;
  const pollInterval = Number(flags.pollInterval || 2) * 1000;
  if (!flags.json) log(`Waiting on ${operationId} ...`);
  const operation = await client.operations.wait(operationId, { timeout, pollInterval });
  return operation;
}

function operationSummary(operation) {
  return formatObject(operation, [
    ["Operation", (o) => o.id],
    ["Kind", (o) => o.kind],
    ["Status", (o) => o.status],
    ["Waiting reason", (o) => o.waitingReason],
    ["Error", (o) => (o.error ? JSON.stringify(o.error) : undefined)],
  ]);
}

// ── Command groups ────────────────────────────────────────────────────────────

export async function programCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "create") {
    const program = await client.programs.create(programCreateParams(flags));
    if (flags.json) return log(JSON.stringify(program, null, 2));
    log(programSummary(program));
    // The id is the very next thing the operator types — hand it to them
    // inside the commands they will run, not buried in a summary line.
    log(`\nNext: npx @boomin/cli enrollment invite --program ${program.id} --email partner@example.com`);
    log(`  or: npx @boomin/cli distribution create --name "Launch" --programs ${program.id}`);
    return;
  }
  if (subcommand === "list") {
    // GET /programs takes pagination only (no status/type filters server-side).
    const page = await client.programs.list(listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PROGRAM_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli program get <prog_id>");
    const program = await client.programs.retrieve(id);
    if (flags.json) return log(JSON.stringify(program, null, 2));
    return log(programSummary(program));
  }
  if (subcommand === "update") {
    const id = requireId(flags, "npx @boomin/cli program update <prog_id> --status paused");
    const program = await client.programs.update(id, programUpdateParams(flags));
    if (flags.json) return log(JSON.stringify(program, null, 2));
    return log(programSummary(program));
  }
  throw new Error(`Unknown program subcommand: ${subcommand}. Use create|list|get|update.`);
}

export async function distributionCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "create") {
    const distribution = await client.distributions.create(distributionCreateParams(flags));
    if (flags.json) return log(JSON.stringify(distribution, null, 2));
    log(distributionSummary(distribution));
    log(`\nNext: npx @boomin/cli distribution validate ${distribution.id}`);
    return;
  }
  if (subcommand === "list") {
    const page = await client.distributions.list(listParams(flags, { status: flags.status || undefined }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, DISTRIBUTION_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli distribution get <dist_id>");
    const distribution = await client.distributions.retrieve(id);
    if (flags.json) return log(JSON.stringify(distribution, null, 2));
    return log(distributionSummary(distribution));
  }
  if (subcommand === "validate") {
    const id = requireId(flags, "npx @boomin/cli distribution validate <dist_id>");
    const distribution = await client.distributions.validate(id);
    if (flags.json) return log(JSON.stringify(distribution, null, 2));
    log(distributionSummary(distribution));
    if (distribution.valid) log(`\nReady. Next: npx @boomin/cli distribution launch ${distribution.id}`);
    return;
  }
  if (subcommand === "launch") {
    const id = requireId(flags, "npx @boomin/cli distribution launch <dist_id>");
    // 202 {distribution, status:'launching', operation} — id STRINGS, never a
    // synchronous success. The operation is the progress surface.
    const accepted = await client.distributions.launch(id);
    if (flags.noWait) {
      if (flags.json) return log(JSON.stringify(accepted, null, 2));
      log(`Launch accepted: ${accepted.distribution} status=${accepted.status}`);
      log(`Operation: ${accepted.operation} (poll with: npx @boomin/cli distribution get ${accepted.distribution})`);
      return;
    }
    const operation = await waitForOperation(client, accepted.operation, flags, log);
    const distribution = await client.distributions.retrieve(accepted.distribution);
    if (flags.json) return log(JSON.stringify({ ...accepted, operation, distribution }, null, 2));
    log(operationSummary(operation));
    log("");
    log(distributionSummary(distribution));
    return;
  }
  if (subcommand === "pause" || subcommand === "resume" || subcommand === "cancel") {
    const id = requireId(flags, `npx @boomin/cli distribution ${subcommand} <dist_id>`);
    // 202: bare distribution + `operation` (the progress handle) alongside.
    const accepted = await client.distributions[subcommand](id);
    if (flags.noWait) {
      if (flags.json) return log(JSON.stringify(accepted, null, 2));
      log(distributionSummary(accepted));
      log(`Operation: ${accepted.operation}`);
      return;
    }
    const operation = await waitForOperation(client, accepted.operation, flags, log);
    const distribution = await client.distributions.retrieve(id);
    if (flags.json) return log(JSON.stringify({ ...accepted, operation, distribution }, null, 2));
    log(operationSummary(operation));
    log("");
    log(distributionSummary(distribution));
    return;
  }
  throw new Error(`Unknown distribution subcommand: ${subcommand}. Use create|list|get|validate|launch|pause|resume|cancel.`);
}

export async function enrollmentCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "invite") {
    const enrollment = await client.enrollments.create(enrollmentInviteParams(flags));
    if (flags.json) return log(JSON.stringify(enrollment, null, 2));
    log(formatObject(enrollment, [
      ["Enrollment", (e) => e.id],
      ["Program", (e) => e.program],
      ["Partnership", (e) => e.partnership],
      ["Approval", (e) => e.approvalStatus],
      ["Status", (e) => e.status],
      ["Referral code", (e) => e.referralCode],
    ]));
    log(`\nNext: npx @boomin/cli enrollment approve ${enrollment.id}`);
    return;
  }
  if (subcommand === "approve" || subcommand === "reject") {
    const id = requireId(flags, `npx @boomin/cli enrollment ${subcommand} <enr_id>`);
    const enrollment = await client.enrollments[subcommand](id);
    if (flags.json) return log(JSON.stringify(enrollment, null, 2));
    return log(formatObject(enrollment, [
      ["Enrollment", (e) => e.id],
      ["Approval", (e) => e.approvalStatus],
      ["Status", (e) => e.status],
      ["Qualification", (e) => e.qualificationStatus],
    ]));
  }
  if (subcommand === "list") {
    const page = await client.enrollments.list(listParams(flags, {
      program: flags.program || undefined,
      status: flags.status || undefined,
      approvalStatus: flags.approvalStatus || undefined,
    }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, ENROLLMENT_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli enrollment get <enr_id>");
    const enrollment = await client.enrollments.retrieve(id);
    if (flags.json) return log(JSON.stringify(enrollment, null, 2));
    return log(formatObject(enrollment, [
      ["Enrollment", (e) => e.id],
      ["Program", (e) => e.program],
      ["Partnership", (e) => e.partnership],
      ["Partner", (e) => e.partner],
      ["Approval", (e) => e.approvalStatus],
      ["Status", (e) => e.status],
      ["Billing", (e) => e.billingStatus],
      ["Qualification", (e) => e.qualificationStatus],
      ["Referral code", (e) => e.referralCode],
    ]));
  }
  throw new Error(`Unknown enrollment subcommand: ${subcommand}. Use invite|approve|reject|list|get.`);
}

export async function partnershipCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "list") {
    const page = await client.partnerships.list(listParams(flags, { status: flags.status || undefined }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PARTNERSHIP_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli partnership get <pship_id>");
    const partnership = await client.partnerships.retrieve(id);
    if (flags.json) return log(JSON.stringify(partnership, null, 2));
    log(formatObject(partnership, [
      ["Partnership", (p) => p.id],
      ["Status", (p) => p.status],
      ["Partner", (p) => (typeof p.partner === "object" ? `${p.partner.name ?? p.partner.email ?? ""} (${p.partner.id})` : p.partner)],
      ["Started", (p) => p.startedAt],
      ["Ended", (p) => p.endedAt],
    ]));
    if (Array.isArray(partnership.enrollments) && partnership.enrollments.length) {
      log("");
      log(formatTable(partnership.enrollments, ENROLLMENT_COLUMNS));
    }
    return;
  }
  // `resume` is the canonical verb on every surface — shipped alongside pause.
  if (subcommand === "pause" || subcommand === "resume" || subcommand === "end") {
    const id = requireId(flags, `npx @boomin/cli partnership ${subcommand} <pship_id>`);
    const partnership = await client.partnerships[subcommand](id);
    if (flags.json) return log(JSON.stringify(partnership, null, 2));
    return log(formatObject(partnership, [
      ["Partnership", (p) => p.id],
      ["Status", (p) => p.status],
      // A relationship pause moves this partner's own INSTRUMENTS, never the
      // shared channels they sit on — so the verb reports link codes, plus the
      // channels those links live on for context.
      ["Links paused", (p) => (p.linksPaused ? p.linksPaused.join(", ") || "(none)" : undefined)],
      ["Links resumed", (p) => (p.linksResumed ? p.linksResumed.join(", ") || "(none)" : undefined)],
      ["Channels", (p) => (p.channels ? p.channels.join(", ") || "(none)" : undefined)],
      ["Ended", (p) => p.endedAt],
    ]));
  }
  throw new Error(`Unknown partnership subcommand: ${subcommand}. Use list|get|pause|resume|end.`);
}

export async function connectionCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "list") {
    const page = await client.connections.list(listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    return log(formatTable(page.data, CONNECTION_COLUMNS));
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli connection get <conn_id>");
    const connection = await client.connections.retrieve(id);
    if (flags.json) return log(JSON.stringify(connection, null, 2));
    return log(formatObject(connection, [
      ["Connection", (c) => c.id],
      ["Provider", (c) => c.provider],
      ["Kind", (c) => c.kind],
      ["Status", (c) => c.status],
      ["Account", (c) => c.providerAccountId],
      ["Owner", (c) => (c.owner ? `${c.owner.type}:${c.owner.id}` : undefined)],
      ["Grants", (c) => (Array.isArray(c.grants) ? c.grants.length : undefined)],
    ]));
  }
  if (subcommand === "revoke") {
    const id = requireId(flags, "npx @boomin/cli connection revoke <conn_id>");
    const connection = await client.connections.revoke(id);
    if (flags.json) return log(JSON.stringify(connection, null, 2));
    return log(`Revoked ${connection.id ?? id} (status: ${connection.status ?? "revoked"}).`);
  }
  throw new Error(`Unknown connection subcommand: ${subcommand}. Use list|get|revoke.`);
}

function payoutRuleSummary(rule) {
  return formatObject(rule, [
    ["Rule", (r) => r.id],
    ["Name", (r) => r.name],
    ["Type", (r) => r.type],
    ["Status", (r) => r.status],
    ["Scope", (r) => (r.scope ? JSON.stringify(r.scope) : undefined)],
    ["Metric", (r) => r.metricKey],
    ["Rate (bps)", (r) => r.rateBps],
    ["Per unit (minor)", (r) => r.perUnitMinor],
    ["Threshold", (r) => r.threshold],
    ["Bonus (minor)", (r) => r.bonusMinor],
    ["Window", (r) => (r.windowKey ? `${r.windowKey}${r.windowDays ? ` / ${r.windowDays}d` : ""}` : undefined)],
    ["Currency", (r) => r.currency],
    ["Revenue basis", (r) => r.revenueBasis],
    ["Created", (r) => r.createdAt],
  ]);
}

function payoutRailSummary(rail) {
  return formatObject(rail, [
    ["Rail", (r) => r.id],
    ["Kind", (r) => r.rail],
    ["Status", (r) => r.status],
    ["Default", (r) => (r.isDefault ? "yes" : "no")],
    ["Format", (r) => r.config?.format],
    ["Wallet funded", (r) => (r.config?.walletFunded === undefined ? undefined : String(r.config.walletFunded))],
    // Printed as the JSON that was stored, headers and order intact — the
    // point of `columns` is that it is byte-for-byte what you sent.
    ["Columns", (r) => (r.config?.columns ? JSON.stringify(r.config.columns) : undefined)],
    ["Livemode", (r) => (r.livemode === undefined ? undefined : String(r.livemode))],
    ["Created", (r) => r.createdAt],
  ]);
}

function payoutBatchSummary(batch) {
  return formatObject(batch, [
    ["Batch", (b) => b.id],
    ["Status", (b) => b.status],
    ["Rail", (b) => b.rail],
    ["Items", (b) => b.itemCount ?? (Array.isArray(b.items) ? b.items.length : undefined)],
    ["Total", (b) => b.totalAmountCents],
    ["Currency", (b) => b.currency],
    ["Period", (b) => (b.periodStart ? `${b.periodStart}..${b.periodEnd ?? ""}` : undefined)],
    ["Export key", (b) => b.exportFileKey],
    ["Export format", (b) => b.exportFormat],
    ["Download", (b) => b.downloadUrl],
    ["Skipped", (b) => (Array.isArray(b.skipped) ? b.skipped.length : undefined)],
    ["Error", (b) => (b.error ? JSON.stringify(b.error) : undefined)],
  ]);
}

/**
 * Drive an accepted export (202 `{batch, status, operation}`) to a file.
 *
 * The export is a kernel Operation and the artifact URL is NOT in the 202 — it
 * is minted on READ of the batch, so this polls the operation to terminal and
 * then reads the batch. An operation that ended anything but `succeeded` is a
 * FAILURE here, not a quiet "no file this time": it throws, so a scheduled
 * export exits non-zero instead of leaving an empty --out path behind.
 */
async function resolveExport(accepted, flags, ctx) {
  const { client, log } = ctx;
  if (flags.noWait) {
    if (!flags.json) {
      log(`Export accepted: batch ${accepted.batch} status=${accepted.status}`);
      log(`Operation: ${accepted.operation} (then: npx @boomin/cli payout batches show ${accepted.batch})`);
    }
    return { accepted, operation: null, batch: null, outPath: null };
  }
  const operation = await waitForOperation(client, accepted.operation, flags, log);
  if (operation.status !== "succeeded") {
    throw new ApiError(
      `Export operation ${operation.id} finished '${operation.status}'${operation.error ? `: ${JSON.stringify(operation.error)}` : ""}.`,
      { code: operation.error?.code ?? "payout_export_failed", status: undefined },
    );
  }
  const batch = await client.payouts.batches.retrieve(accepted.batch);
  let outPath = null;
  if (flags.out) {
    if (!batch.downloadUrl) {
      // The batch exported but no presigned URL came back — the file exists and
      // was NOT delivered. Saying so beats writing a 0-byte CSV.
      throw new ApiError(
        `Batch ${batch.id} has no download_url, so --out cannot be written (export key: ${batch.exportFileKey ?? "none"}).`,
        { code: "payout_export_unconfigured" },
      );
    }
    outPath = path.resolve(process.cwd(), String(flags.out));
    const response = await (ctx.fetch ?? fetch)(batch.downloadUrl);
    if (!response.ok) throw new Error(`CSV download failed with ${response.status}.`);
    await fs.writeFile(outPath, Buffer.from(await response.arrayBuffer()));
  }
  return { accepted, operation, batch, outPath };
}

function printExport(result, flags, log) {
  const { accepted, operation, batch, outPath } = result;
  if (flags.json) {
    return log(JSON.stringify(removeEmpty({ ...accepted, operation, batch, out: outPath }), null, 2));
  }
  if (!operation) return undefined;
  log(operationSummary(operation));
  log("");
  log(payoutBatchSummary(batch));
  if (outPath) log(`Wrote ${outPath}`);
  return undefined;
}

/** `payout rules …` — how a partner EARNS (scope: payout_rules:read|write). */
async function payoutRulesCommand(verb, flags, ctx) {
  const { client, log } = ctx;
  if (verb === "list") {
    const page = await client.payouts.rules.list(listParams(flags, {
      program: flags.program || undefined,
      status: flags.status || undefined,
      type: flags.type || undefined,
    }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PAYOUT_RULE_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return undefined;
  }
  if (verb === "create") {
    const rule = await client.payouts.rules.create(payoutRuleCreateParams(flags));
    if (flags.json) return log(JSON.stringify(rule, null, 2));
    log(payoutRuleSummary(rule));
    log("\nEconomics are frozen from here. To change money: create a replacement rule, then");
    log(`  npx @boomin/cli payout rules archive ${rule.id}`);
    return undefined;
  }
  if (verb === "show") {
    const id = requireId(flags, "npx @boomin/cli payout rules show <prule_id>");
    const rule = await client.payouts.rules.retrieve(id);
    if (flags.json) return log(JSON.stringify(rule, null, 2));
    return log(payoutRuleSummary(rule));
  }
  if (verb === "update") {
    const id = requireId(flags, "npx @boomin/cli payout rules update <prule_id> --status paused");
    // Only name and status are mutable. Anything else is answered by the API
    // with immutable_parameter naming the frozen concept — the CLI does not
    // pre-empt that, because the API's message says what to do instead.
    const params = removeEmpty({
      name: flags.name ? String(flags.name) : undefined,
      status: flags.status ? String(flags.status) : undefined,
    });
    if (!Object.keys(params).length) throw new Error("Pass --name and/or --status. A rule's economics cannot be changed; create a replacement rule and archive this one.");
    const rule = await client.payouts.rules.update(id, params);
    if (flags.json) return log(JSON.stringify(rule, null, 2));
    return log(payoutRuleSummary(rule));
  }
  if (verb === "archive") {
    const id = requireId(flags, "npx @boomin/cli payout rules archive <prule_id>");
    const rule = await client.payouts.rules.archive(id);
    if (flags.json) return log(JSON.stringify(rule, null, 2));
    log(`Archived ${rule.id ?? id} (status: ${rule.status ?? "archived"}).`);
    log("Every payout this rule produced stays in the ledger — archive stops it firing, it does not erase history.");
    return undefined;
  }
  throw new Error(`Unknown payout rules subcommand: ${verb}. Use list|create|show|update|archive.`);
}

/** `payout rails …` — how money physically LEAVES (payout_rails:read|write). */
async function payoutRailsCommand(verb, flags, ctx) {
  const { client, log } = ctx;
  if (verb === "list") {
    const page = await client.payouts.rails.list(listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PAYOUT_RAIL_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return undefined;
  }
  if (verb === "create") {
    const rail = await client.payouts.rails.create(payoutRailCreateParams(flags));
    if (flags.json) return log(JSON.stringify(rail, null, 2));
    log(payoutRailSummary(rail));
    return undefined;
  }
  if (verb === "show") {
    const id = requireId(flags, "npx @boomin/cli payout rails show <prail_id>");
    const rail = await client.payouts.rails.retrieve(id);
    if (flags.json) return log(JSON.stringify(rail, null, 2));
    return log(payoutRailSummary(rail));
  }
  if (verb === "update") {
    const id = requireId(flags, "npx @boomin/cli payout rails update <prail_id> --status disabled");
    // `config` REPLACES the stored object wholesale — there is no merge, here
    // or in the API, because a half-applied column mapping is a file that pays
    // the wrong column. Omit the config flags to leave it untouched.
    const params = removeEmpty({
      config: payoutRailConfig(flags),
      isDefault: booleanFlag(flags.default ?? flags.isDefault),
      status: flags.status ? String(flags.status) : undefined,
    });
    if (!Object.keys(params).length) throw new Error("Pass at least one of --config/--format/--columns/--wallet-funded, --default, --status.");
    const rail = await client.payouts.rails.update(id, params);
    if (flags.json) return log(JSON.stringify(rail, null, 2));
    return log(payoutRailSummary(rail));
  }
  throw new Error(`Unknown payout rails subcommand: ${verb}. Use list|create|show|update.`);
}

/** `payout batches …` — one frozen disbursement run. */
async function payoutBatchesCommand(verb, flags, ctx) {
  const { client, log } = ctx;
  if (verb === "list") {
    const page = await client.payouts.batches.list(listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PAYOUT_BATCH_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return undefined;
  }
  if (verb === "show") {
    const id = requireId(flags, "npx @boomin/cli payout batches show <pbatch_id>");
    const batch = await client.payouts.batches.retrieve(id);
    if (flags.json) return log(JSON.stringify(batch, null, 2));
    return log(payoutBatchSummary(batch));
  }
  if (verb === "create") {
    const batch = await client.payouts.batches.create(removeEmpty({
      rail: flags.rail ? String(flags.rail) : undefined,
      periodStart: flags.periodStart ? String(flags.periodStart) : undefined,
      periodEnd: flags.periodEnd ? String(flags.periodEnd) : undefined,
    }));
    if (flags.json) return log(JSON.stringify(batch, null, 2));
    log(payoutBatchSummary(batch));
    log(`\nNext: npx @boomin/cli payout batches export ${batch.id} --out payouts.csv`);
    return undefined;
  }
  if (verb === "export") {
    const id = requireId(flags, "npx @boomin/cli payout batches export <pbatch_id> [--out payouts.csv]");
    const accepted = await client.payouts.batches.export(id);
    return printExport(await resolveExport(accepted, flags, ctx), flags, log);
  }
  if (verb === "confirm") {
    const id = requireId(flags, "npx @boomin/cli payout batches confirm <pbatch_id> --external-batch-ref PAYPAL-2026-08");
    const accepted = await client.payouts.batches.confirm(id, removeEmpty({
      externalBatchRef: flags.externalBatchRef ? String(flags.externalBatchRef) : undefined,
      results: parseJsonFlag(flags.results, "results"),
    }));
    if (flags.noWait) {
      if (flags.json) return log(JSON.stringify(accepted, null, 2));
      log(`Confirm accepted: batch ${accepted.batch} status=${accepted.status}`);
      log(`Operation: ${accepted.operation}`);
      return undefined;
    }
    const operation = await waitForOperation(client, accepted.operation, flags, log);
    const batch = await client.payouts.batches.retrieve(accepted.batch);
    if (flags.json) return log(JSON.stringify({ ...accepted, operation, batch }, null, 2));
    log(operationSummary(operation));
    log("");
    log(payoutBatchSummary(batch));
    return undefined;
  }
  if (verb === "cancel") {
    const id = requireId(flags, "npx @boomin/cli payout batches cancel <pbatch_id>");
    const batch = await client.payouts.batches.cancel(id);
    if (flags.json) return log(JSON.stringify(batch, null, 2));
    return log(payoutBatchSummary(batch));
  }
  throw new Error(`Unknown payout batches subcommand: ${verb}. Use list|show|create|export|confirm|cancel.`);
}

export async function payoutCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  // Sub-groups mirror the REST tree: /payouts/{rules,rails,batches}.
  if (subcommand === "rules" || subcommand === "rails" || subcommand === "batches") {
    const verb = flags._.shift();
    if (!verb) throw new Error(`A subcommand is required: npx @boomin/cli payout ${subcommand} list`);
    const group = { rules: payoutRulesCommand, rails: payoutRailsCommand, batches: payoutBatchesCommand }[subcommand];
    return group(String(verb), flags, ctx);
  }
  if (subcommand === "list") {
    const page = await client.payouts.list(listParams(flags, {
      status: flags.status || undefined,
      periodStart: flags.periodStart || undefined,
      periodEnd: flags.periodEnd || undefined,
    }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PAYOUT_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "run") {
    if (!flags.periodStart || !flags.periodEnd) {
      throw new Error("--period-start and --period-end (YYYY-MM-DD) are required. Usage: npx @boomin/cli payout run --period-start 2026-08-01 --period-end 2026-09-01");
    }
    // A brand with no active rule and no active content split answers 409
    // payout_rules_required, which propagates and exits NON-ZERO. That is the
    // whole point of the distinction: "nothing is configured" must fail a
    // script, while "configured, nothing qualified" is a success whose
    // `outcome` says so.
    const result = await client.payouts.run({ periodStart: String(flags.periodStart), periodEnd: String(flags.periodEnd) });
    if (flags.json) return log(JSON.stringify(result, null, 2));
    log(`Payout run ${flags.periodStart}..${flags.periodEnd}: ${result.outcome ?? "(no outcome reported)"}`);
    // The counters, always — an empty run is only explicable if you can see
    // what it evaluated to reach zero.
    log(formatObject(result, [
      ["Rules evaluated", (r) => r.rulesEvaluated],
      ["Splits evaluated", (r) => r.splitsEvaluated],
      ["Events evaluated", (r) => r.eventsEvaluated],
      ["Payouts created", (r) => r.payoutsCreated],
      ["Underfunded", (r) => r.underfunded],
      ["Awaiting account", (r) => r.awaitingAccount],
    ]));
    if (result.summary) {
      log("");
      log(formatObject(result.summary, [
        ["Total (minor)", (s) => s.totalAmountMinor],
        ["Count", (s) => s.count],
        ["Awaiting account", (s) => s.awaitingAccount],
        ["Bridged", (s) => s.bridged],
        ["Unresolved recipients", (s) => s.unresolvedRecipients],
      ]));
    }
    if (result.outcome === "no_eligible_activity") {
      log("\nNo compensable activity in this window. The run itself was fine — nothing qualified.");
    }
    log("");
    log(formatTable(result.payouts ?? [], PAYOUT_COLUMNS));
    return;
  }
  if (subcommand === "export") {
    // Build + export in one call (202). The build half is synchronous, so a
    // missing rail or an empty period still fails here, immediately and typed.
    const accepted = await client.payouts.exportCsv(removeEmpty({
      periodStart: flags.periodStart ? String(flags.periodStart) : undefined,
      periodEnd: flags.periodEnd ? String(flags.periodEnd) : undefined,
    }));
    return printExport(await resolveExport(accepted, flags, ctx), flags, log);
  }
  if (subcommand === "connect") {
    const status = await client.payouts.connectStatus();
    if (flags.json) return log(JSON.stringify(status, null, 2));
    log(`Rails: ${Array.isArray(status.rails) && status.rails.length ? status.rails.map((rail) => rail.rail ?? rail.id ?? JSON.stringify(rail)).join(", ") : "(none configured)"}`);
    if (status.stripe) {
      log(`Stripe configured: ${status.stripe.configured ? "yes" : "no"}`);
      log(`Partner payout accounts: ${status.stripe.partnerAccounts} (${status.stripe.partnerAccountsPayoutsEnabled} payouts-enabled)`);
    }
    return;
  }
  throw new Error(`Unknown payout subcommand: ${subcommand}. Use list|run|export|connect|rules|rails|batches.`);
}

/** Webhook endpoint responses arrive wrapped on create/get/update/rotate. The
 * SDK already unwraps them; this stays as a belt-and-braces for a wrapped body
 * (camelCased `webhookEndpoint`, or `webhook_endpoint` under rawResponses). */
function unwrapEndpoint(response) {
  return response?.webhookEndpoint ?? response?.webhook_endpoint ?? response;
}

export async function webhookCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "create") {
    if (!flags.url) throw new Error("--url is required. Usage: npx @boomin/cli webhook create --url https://example.com/webhooks/boomin");
    const raw = await client.webhooks.endpoints.create(removeEmpty({
      url: String(flags.url),
      description: flags.description ? String(flags.description) : undefined,
      enabledEvents: flags.events ? parseCsv(flags.events) : undefined,
    }));
    if (flags.json) return log(JSON.stringify(raw, null, 2));
    const endpoint = unwrapEndpoint(raw);
    log(formatObject(endpoint, [
      ["Endpoint", (w) => w.id],
      ["URL", (w) => w.url],
      ["Events", (w) => (Array.isArray(w.enabledEvents) && w.enabledEvents.length ? w.enabledEvents.join(", ") : "(all public events)")],
      ["Status", (w) => w.status],
    ]));
    if (endpoint.secret) {
      log("");
      log("Signing secret (shown once — copy it now):");
      log(`  ${endpoint.secret}`);
    }
    return;
  }
  if (subcommand === "list") {
    const page = await client.webhooks.endpoints.list(listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    return log(formatTable(page.data, WEBHOOK_COLUMNS));
  }
  if (subcommand === "delete") {
    const id = requireId(flags, "npx @boomin/cli webhook delete <we_id>");
    const result = await client.webhooks.endpoints.del(id);
    if (flags.json) return log(JSON.stringify(result, null, 2));
    return log(`Deleted webhook endpoint ${result?.id ?? id}.`);
  }
  if (subcommand === "rotate-secret") {
    const id = requireId(flags, "npx @boomin/cli webhook rotate-secret <we_id>");
    const raw = await client.webhooks.endpoints.rotateSecret(id);
    if (flags.json) return log(JSON.stringify(raw, null, 2));
    const endpoint = unwrapEndpoint(raw);
    log(`Rotated signing secret for ${endpoint.id ?? id}. The previous secret stays honored for a short overlap window.`);
    if (endpoint.secret) {
      log("");
      log("New signing secret (shown once — copy it now):");
      log(`  ${endpoint.secret}`);
    }
    return;
  }
  throw new Error(`Unknown webhook subcommand: ${subcommand}. Use create|list|delete|rotate-secret.`);
}

export async function eventsCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "list") {
    const page = await client.events.list(listParams(flags, { type: flags.type || undefined }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, EVENT_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last seq or evt_ id)");
    return;
  }
  throw new Error(`Unknown events subcommand: ${subcommand}. Use list.`);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const GROUPS = {
  program: programCommand,
  distribution: distributionCommand,
  enrollment: enrollmentCommand,
  partnership: partnershipCommand,
  connection: connectionCommand,
  payout: payoutCommand,
  webhook: webhookCommand,
  events: eventsCommand,
};

export function isV1Group(command) {
  return Object.prototype.hasOwnProperty.call(GROUPS, command);
}

export async function runV1Command(group, subcommand, flags, options = {}) {
  const handler = GROUPS[group];
  if (!handler) throw new Error(`Unknown command group: ${group}`);
  if (!subcommand) throw new Error(`A subcommand is required for '${group}'. Run: npx @boomin/cli help ${group}`);
  const client = options.client ?? createV1Client({
    token: options.token,
    platformApiBase: options.platformApiBase,
    brand: flags.brand,
    fetch: options.fetch,
  });
  const ctx = { client, log: options.log ?? console.log, fetch: options.fetch };
  try {
    await handler(subcommand, flags, ctx);
  } catch (error) {
    throw translateError(error);
  }
}

export { TERMINAL_OPERATION_STATUSES };

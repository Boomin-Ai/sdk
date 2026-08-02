/**
 * CLI 0.3.0 — command groups over the LIVE /v1/platform REST tree
 * (DISTRIBUTION_CORE §4), driven through @boomin/sdk (the wire truth:
 * bare objects, launch = {distribution,status,operation} id strings,
 * errors = {error:{code}}, list envelopes {object:'list',data,has_more}).
 *
 * Groups: distribution, enrollment, partnership, connection, payout,
 * webhook, events. Operation-returning commands (launch/pause/resume/cancel)
 * poll the operation to a terminal status by default; --no-wait skips.
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
      : undefined,
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

export function enrollmentInviteParams(flags) {
  if (!flags.program) throw new Error("--program is required. Usage: npx @boomin/cli enrollment invite --program prog_... --email partner@example.com");
  if (!flags.email && !flags.partner) throw new Error("Pass --email or --partner to identify who to invite.");
  return removeEmpty({
    program: String(flags.program),
    email: flags.email ? String(flags.email) : undefined,
    partner: flags.partner ? String(flags.partner) : undefined,
    name: flags.name ? String(flags.name) : undefined,
    referral_code: flags.referralCode ? String(flags.referralCode) : undefined,
    metadata: parseJsonFlag(flags.metadata, "metadata"),
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
    ["Created", (d) => d.created_at],
  ]);
}

const DISTRIBUTION_COLUMNS = [
  { header: "ID", value: (d) => d.id },
  { header: "STATUS", value: (d) => d.status },
  { header: "OBJECTIVE", value: (d) => d.objective ?? "" },
  { header: "DEPLOYMENTS", value: (d) => (d.deployments ? `${d.deployments.live}/${d.deployments.total}` : "") },
  { header: "NAME", value: (d) => d.name ?? "" },
];

const ENROLLMENT_COLUMNS = [
  { header: "ID", value: (e) => e.id },
  { header: "APPROVAL", value: (e) => e.approval_status },
  { header: "STATUS", value: (e) => e.status },
  { header: "PROGRAM", value: (e) => e.program },
  { header: "PARTNERSHIP", value: (e) => e.partnership },
  { header: "CODE", value: (e) => e.referral_code ?? "" },
];

const PARTNERSHIP_COLUMNS = [
  { header: "ID", value: (p) => p.id },
  { header: "STATUS", value: (p) => p.status },
  { header: "PARTNER", value: (p) => (typeof p.partner === "object" ? `${p.partner.name ?? p.partner.email ?? ""} (${p.partner.id})` : p.partner) },
  { header: "STARTED", value: (p) => p.started_at ?? "" },
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
  { header: "AMOUNT", value: (p) => (p.amount_cents !== undefined ? p.amount_cents : p.amount ?? "") },
  { header: "PERIOD", value: (p) => (p.period_start ? `${p.period_start}..${p.period_end}` : "") },
];

const WEBHOOK_COLUMNS = [
  { header: "ID", value: (w) => w.id },
  { header: "STATUS", value: (w) => w.status },
  { header: "EVENTS", value: (w) => (Array.isArray(w.enabled_events) && w.enabled_events.length ? w.enabled_events.join(",") : "(all)") },
  { header: "URL", value: (w) => w.url },
];

const EVENT_COLUMNS = [
  { header: "SEQ", value: (e) => e.seq },
  { header: "ID", value: (e) => e.id },
  { header: "TYPE", value: (e) => e.type },
  { header: "SUBJECT", value: (e) => (e.subject ? `${e.subject.type}:${e.subject.id}` : "") },
  { header: "CREATED", value: (e) => e.created_at ?? "" },
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
    ["Waiting reason", (o) => o.waiting_reason],
    ["Error", (o) => (o.error ? JSON.stringify(o.error) : undefined)],
  ]);
}

// ── Command groups ────────────────────────────────────────────────────────────

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
    if (page.has_more) log("(more — use --starting-after with the last id)");
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
      ["Approval", (e) => e.approval_status],
      ["Status", (e) => e.status],
      ["Referral code", (e) => e.referral_code],
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
      ["Approval", (e) => e.approval_status],
      ["Status", (e) => e.status],
      ["Qualification", (e) => e.qualification_status],
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
    if (page.has_more) log("(more — use --starting-after with the last id)");
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
      ["Approval", (e) => e.approval_status],
      ["Status", (e) => e.status],
      ["Billing", (e) => e.billing_status],
      ["Qualification", (e) => e.qualification_status],
      ["Referral code", (e) => e.referral_code],
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
    if (page.has_more) log("(more — use --starting-after with the last id)");
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
      ["Started", (p) => p.started_at],
      ["Ended", (p) => p.ended_at],
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
      ["Deployments paused", (p) => (p.deployments_paused ? p.deployments_paused.join(", ") || "(none)" : undefined)],
      ["Deployments resumed", (p) => (p.deployments_resumed ? p.deployments_resumed.join(", ") || "(none)" : undefined)],
      ["Ended", (p) => p.ended_at],
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
      ["Account", (c) => c.provider_account_id],
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

export async function payoutCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "list") {
    const page = await client.payouts.list(listParams(flags, {
      status: flags.status || undefined,
      periodStart: flags.periodStart || undefined,
      periodEnd: flags.periodEnd || undefined,
    }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, PAYOUT_COLUMNS));
    if (page.has_more) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "run") {
    if (!flags.periodStart || !flags.periodEnd) {
      throw new Error("--period-start and --period-end (YYYY-MM-DD) are required. Usage: npx @boomin/cli payout run --period-start 2026-08-01 --period-end 2026-09-01");
    }
    const result = await client.payouts.run({ period_start: String(flags.periodStart), period_end: String(flags.periodEnd) });
    if (flags.json) return log(JSON.stringify(result, null, 2));
    log(`Payout run complete for ${flags.periodStart}..${flags.periodEnd}.`);
    if (result.summary) log(formatObject(result.summary, Object.keys(result.summary).map((key) => [key, (s) => s[key]])));
    log(formatTable(result.payouts ?? [], PAYOUT_COLUMNS));
    return;
  }
  if (subcommand === "export") {
    const result = await client.payouts.exportCsv(removeEmpty({
      period_start: flags.periodStart ? String(flags.periodStart) : undefined,
      period_end: flags.periodEnd ? String(flags.periodEnd) : undefined,
    }));
    let outPath = null;
    if (flags.out && result.download_url) {
      outPath = path.resolve(process.cwd(), String(flags.out));
      const response = await (ctx.fetch ?? fetch)(result.download_url);
      if (!response.ok) throw new Error(`CSV download failed with ${response.status}.`);
      await fs.writeFile(outPath, Buffer.from(await response.arrayBuffer()));
    }
    if (flags.json) return log(JSON.stringify({ ...result, ...(outPath ? { out: outPath } : {}) }, null, 2));
    log(formatObject(result, [
      ["Batch", (r) => r.id],
      ["Status", (r) => r.status],
      ["Items", (r) => (Array.isArray(r.items) ? r.items.length : undefined)],
      ["Skipped", (r) => (Array.isArray(r.skipped) ? r.skipped.length : undefined)],
      ["Export key", (r) => r.export_file_key],
      ["Download", (r) => r.download_url],
    ]));
    if (outPath) log(`Wrote ${outPath}`);
    return;
  }
  if (subcommand === "connect") {
    const status = await client.payouts.connectStatus();
    if (flags.json) return log(JSON.stringify(status, null, 2));
    log(`Rails: ${Array.isArray(status.rails) && status.rails.length ? status.rails.map((rail) => rail.rail ?? rail.id ?? JSON.stringify(rail)).join(", ") : "(none configured)"}`);
    if (status.stripe) {
      log(`Stripe configured: ${status.stripe.configured ? "yes" : "no"}`);
      log(`Partner payout accounts: ${status.stripe.partner_accounts} (${status.stripe.partner_accounts_payouts_enabled} payouts-enabled)`);
    }
    return;
  }
  throw new Error(`Unknown payout subcommand: ${subcommand}. Use list|run|export|connect.`);
}

/** Webhook endpoint responses arrive as {webhook_endpoint:{...}} on
 * create/get/update/rotate — unwrap for shaping, keep raw for --json. */
function unwrapEndpoint(response) {
  return response?.webhook_endpoint ?? response;
}

export async function webhookCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "create") {
    if (!flags.url) throw new Error("--url is required. Usage: npx @boomin/cli webhook create --url https://example.com/webhooks/boomin");
    const raw = await client.webhooks.endpoints.create(removeEmpty({
      url: String(flags.url),
      description: flags.description ? String(flags.description) : undefined,
      enabled_events: flags.events ? parseCsv(flags.events) : undefined,
    }));
    if (flags.json) return log(JSON.stringify(raw, null, 2));
    const endpoint = unwrapEndpoint(raw);
    log(formatObject(endpoint, [
      ["Endpoint", (w) => w.id],
      ["URL", (w) => w.url],
      ["Events", (w) => (Array.isArray(w.enabled_events) && w.enabled_events.length ? w.enabled_events.join(", ") : "(all public events)")],
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
    if (page.has_more) log("(more — use --starting-after with the last seq or evt_ id)");
    return;
  }
  throw new Error(`Unknown events subcommand: ${subcommand}. Use list.`);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const GROUPS = {
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

/**
 * Relationship-stack command groups (RELATIONSHIP_CORE §2/§4/§5, CLI 0.7.0):
 * `relationship` (canonical; `partnership` stays an alias forever),
 * `assertion`, `operating-type`, `metric`, `standing test`, and the
 * enrollment extensions (`set-type`, `overrides …`).
 *
 * Conventions match v1.js: every group is `(subcommand, flags, ctx)` with
 * `ctx = { client, log }`; `--json` prints the raw response; param builders
 * are exported for unit tests.
 */

import {
  booleanFlag,
  formatObject,
  formatTable,
  listParams,
  numberFlag,
  parseJsonFlag,
  requireId,
} from "./v1.js";

// ── relationship (alias: partnership) ─────────────────────────────────────────

const RELATIONSHIP_COLUMNS = [
  { header: "ID", value: (p) => p.id },
  { header: "STATUS", value: (p) => p.status },
  { header: "PARTNER", value: (p) => (typeof p.partner === "object" ? (p.partner?.name ?? p.partner?.email ?? p.partner?.id ?? "") : p.partner ?? "") },
  { header: "STARTED", value: (p) => p.startedAt ?? "" },
];

export async function relationshipCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "list") {
    const page = await client.relationships.list(listParams(flags, { status: flags.status || undefined }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, RELATIONSHIP_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli relationship get <rel_id>");
    const relationship = await client.relationships.retrieve(id);
    if (flags.json) return log(JSON.stringify(relationship, null, 2));
    return log(formatObject(relationship, [
      ["Relationship", (p) => p.id],
      ["Status", (p) => p.status],
      ["Partner", (p) => (typeof p.partner === "object" ? `${p.partner.name ?? p.partner.email ?? ""} (${p.partner.id})` : p.partner)],
      ["Started", (p) => p.startedAt],
      ["Ended", (p) => p.endedAt],
    ]));
  }
  if (subcommand === "pause" || subcommand === "resume" || subcommand === "end") {
    const id = requireId(flags, `npx @boomin/cli relationship ${subcommand} <rel_id>`);
    const relationship = await client.relationships[subcommand](id);
    if (flags.json) return log(JSON.stringify(relationship, null, 2));
    return log(formatObject(relationship, [
      ["Relationship", (p) => p.id],
      ["Status", (p) => p.status],
      // A relationship pause moves this partner's own INSTRUMENTS, never the
      // shared channels they sit on.
      ["Links paused", (p) => (p.linksPaused ? p.linksPaused.join(", ") || "(none)" : undefined)],
      ["Links resumed", (p) => (p.linksResumed ? p.linksResumed.join(", ") || "(none)" : undefined)],
      ["Channels", (p) => (p.channels ? p.channels.join(", ") || "(none)" : undefined)],
      ["Ended", (p) => p.endedAt],
    ]));
  }
  throw new Error(`Unknown relationship subcommand: ${subcommand}. Use list|get|pause|resume|end.`);
}

// ── assertion ─────────────────────────────────────────────────────────────────

/** The claim address: `--entity ent_…` OR `--external-user-id … --issuer …`.
 *  NEVER an `asrt_` id — events are history, claims are state. */
export function assertionSubject(flags, usage) {
  if (flags.entity) return { entity: String(flags.entity) };
  if (flags.externalUserId && flags.issuer) {
    return { externalUserId: String(flags.externalUserId), issuer: String(flags.issuer) };
  }
  throw new Error(`An assertion subject is required: --entity ent_… OR --external-user-id … --issuer …\nUsage: ${usage}`);
}

/** `--value` accepts true/false or a finite number. */
export function assertionValue(raw) {
  if (raw === true || raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  throw new Error(`--value must be true, false, or a number. Got: ${raw}`);
}

const ASSERTION_COLUMNS = [
  { header: "KEY", value: (a) => a.key },
  { header: "VALUE", value: (a) => a.value },
  { header: "EXPIRES", value: (a) => a.expiresAt ?? "" },
  { header: "EFFECTIVE", value: (a) => a.effectiveAt ?? "" },
  { header: "EVENT", value: (a) => a.id ?? "" },
];

export async function assertionCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "assert" || subcommand === "create") {
    const usage = "npx @boomin/cli assertion assert --entity ent_… --key advisor_verified --value true [--expires-at 2027-01-01T00:00:00Z]";
    if (!flags.key) throw new Error(`--key is required.\nUsage: ${usage}`);
    if (flags.value === undefined) throw new Error(`--value is required (true, false, or a number).\nUsage: ${usage}`);
    const assertion = await client.assertions.create({
      ...assertionSubject(flags, usage),
      key: String(flags.key),
      value: assertionValue(flags.value),
      ...(flags.expiresAt ? { expiresAt: String(flags.expiresAt) } : {}),
    });
    if (flags.json) return log(JSON.stringify(assertion, null, 2));
    return log(formatObject(assertion ?? {}, [
      ["Assertion", (a) => a.id],
      ["Entity", (a) => a.entity],
      ["Key", (a) => a.key],
      ["Value", (a) => a.value],
      ["Expires", (a) => a.expiresAt],
    ]));
  }
  if (subcommand === "revoke") {
    const usage = "npx @boomin/cli assertion revoke --entity ent_… --key advisor_verified";
    if (!flags.key) throw new Error(`--key is required.\nUsage: ${usage}`);
    const result = await client.assertions.revoke({
      ...assertionSubject(flags, usage),
      key: String(flags.key),
    });
    if (flags.json) return log(JSON.stringify(result, null, 2));
    return log(`Revoked '${flags.key}' (re-evaluation queued).`);
  }
  if (subcommand === "list") {
    const usage = "npx @boomin/cli assertion list --entity ent_… [--key k] [--include-expired]";
    const page = await client.assertions.list(listParams(flags, {
      ...assertionSubject(flags, usage),
      key: flags.key ? String(flags.key) : undefined,
      includeExpired: flags.includeExpired ? booleanFlag(flags.includeExpired) : undefined,
    }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    log(formatTable(page.data, ASSERTION_COLUMNS));
    if (page.hasMore) log("(more — use --starting-after with the last id)");
    return;
  }
  throw new Error(`Unknown assertion subcommand: ${subcommand}. Use assert|revoke|list.`);
}

// ── operating-type ────────────────────────────────────────────────────────────

const OPERATING_TYPE_COLUMNS = [
  { header: "ID", value: (t) => t.id },
  { header: "KEY", value: (t) => t.key },
  { header: "NAME", value: (t) => t.name },
  { header: "STATUS", value: (t) => t.status },
];

function operatingTypeSummary(type) {
  return formatObject(type, [
    ["Operating type", (t) => t.id],
    ["Key", (t) => t.key],
    ["Name", (t) => t.name],
    ["Status", (t) => t.status],
    ["Created", (t) => t.createdAt],
  ]);
}

export async function operatingTypeCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "create") {
    const key = flags.key ?? flags._?.[0];
    if (!key) throw new Error("Usage: npx @boomin/cli operating-type create <key> [--name \"Advisor\"]");
    const type = await client.operatingTypes.create({
      key: String(key),
      name: String(flags.name ?? key),
      ...(flags.metadata ? { metadata: parseJsonFlag(flags.metadata, "--metadata") } : {}),
    });
    if (flags.json) return log(JSON.stringify(type, null, 2));
    log(operatingTypeSummary(type));
    log(`\nNext: npx @boomin/cli enrollment set-type <enr_id> --type ${type.key}`);
    return;
  }
  if (subcommand === "list") {
    const page = await client.operatingTypes.list(listParams(flags, { status: flags.status || undefined }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    return log(formatTable(page.data, OPERATING_TYPE_COLUMNS));
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli operating-type get <otype_id|key>");
    const type = await client.operatingTypes.retrieve(id);
    if (flags.json) return log(JSON.stringify(type, null, 2));
    return log(operatingTypeSummary(type));
  }
  if (subcommand === "update") {
    const id = requireId(flags, "npx @boomin/cli operating-type update <otype_id|key> [--name …] [--status active]");
    const type = await client.operatingTypes.update(id, {
      ...(flags.name ? { name: String(flags.name) } : {}),
      ...(flags.status ? { status: String(flags.status) } : {}),
      ...(flags.metadata ? { metadata: parseJsonFlag(flags.metadata, "--metadata") } : {}),
    });
    if (flags.json) return log(JSON.stringify(type, null, 2));
    return log(operatingTypeSummary(type));
  }
  if (subcommand === "archive") {
    const id = requireId(flags, "npx @boomin/cli operating-type archive <otype_id|key>");
    const type = await client.operatingTypes.archive(id);
    if (flags.json) return log(JSON.stringify(type, null, 2));
    return log(`Archived '${type.key ?? id}'. Keys are never recycled — reactivate with: npx @boomin/cli operating-type update ${type.id ?? id} --status active`);
  }
  throw new Error(`Unknown operating-type subcommand: ${subcommand}. Use create|list|get|update|archive.`);
}

// ── metric ────────────────────────────────────────────────────────────────────

const METRIC_KEY_COLUMNS = [
  { header: "KEY", value: (k) => k.key },
  { header: "BUILTIN", value: (k) => (k.builtin ? "yes" : "") },
  { header: "STATUS", value: (k) => k.status },
  { header: "NAME", value: (k) => k.displayName ?? "" },
  { header: "ID", value: (k) => k.id ?? "" },
];

export async function metricCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "register" || subcommand === "create") {
    const key = flags.key ?? flags._?.[0];
    if (!key) throw new Error("Usage: npx @boomin/cli metric register <x:key> [--display-name \"Demos submitted\"]");
    const metric = await client.metricKeys.create({
      key: String(key),
      ...(flags.displayName ? { displayName: String(flags.displayName) } : {}),
      ...(flags.description ? { description: String(flags.description) } : {}),
      ...(flags.metadata ? { metadata: parseJsonFlag(flags.metadata, "--metadata") } : {}),
    });
    if (flags.json) return log(JSON.stringify(metric, null, 2));
    log(formatObject(metric, [
      ["Metric key", (k) => k.id],
      ["Key", (k) => k.key],
      ["Name", (k) => k.displayName],
      ["Status", (k) => k.status],
    ]));
    log(`\nThe key is live on standing + reward config. Ingest events with metric_key '${metric.key}'; payout stays built-ins-only in v1.`);
    return;
  }
  if (subcommand === "list") {
    const page = await client.metricKeys.list(listParams(flags, { status: flags.status || undefined, limit: flags.limit ?? 100 }));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    return log(formatTable(page.data, METRIC_KEY_COLUMNS));
  }
  if (subcommand === "get") {
    const id = requireId(flags, "npx @boomin/cli metric get <mkey_id|x:key>");
    const metric = await client.metricKeys.retrieve(id);
    if (flags.json) return log(JSON.stringify(metric, null, 2));
    return log(formatObject(metric, [
      ["Metric key", (k) => k.id],
      ["Key", (k) => k.key],
      ["Builtin", (k) => (k.builtin ? "yes" : "no")],
      ["Name", (k) => k.displayName],
      ["Status", (k) => k.status],
      ["Description", (k) => k.description],
    ]));
  }
  if (subcommand === "archive") {
    const id = requireId(flags, "npx @boomin/cli metric archive <mkey_id|x:key>");
    const metric = await client.metricKeys.archive(id);
    if (flags.json) return log(JSON.stringify(metric, null, 2));
    return log(`Archived '${metric.key ?? id}'. Keys are never recycled — history stays; reactivate with: npx @boomin/cli metric update ${metric.id ?? id} --status active`);
  }
  if (subcommand === "update") {
    const id = requireId(flags, "npx @boomin/cli metric update <mkey_id|x:key> [--status active]");
    const metric = await client.metricKeys.update(id, {
      ...(flags.displayName ? { displayName: String(flags.displayName) } : {}),
      ...(flags.description !== undefined ? { description: flags.description === "null" ? null : String(flags.description) } : {}),
      ...(flags.status ? { status: String(flags.status) } : {}),
      ...(flags.metadata ? { metadata: parseJsonFlag(flags.metadata, "--metadata") } : {}),
    });
    if (flags.json) return log(JSON.stringify(metric, null, 2));
    return log(`'${metric.key}' → ${metric.status}.`);
  }
  throw new Error(`Unknown metric subcommand: ${subcommand}. Use register|list|get|update|archive.`);
}

// ── standing test ─────────────────────────────────────────────────────────────

/** `--assert key=value` (repeatable) → the simulate.assertions record.
 *  Values: true | false | number | null (null = simulate absence/revocation). */
export function parseSimulatedAssertions(entries) {
  const assertions = {};
  for (const raw of entries ?? []) {
    const eq = String(raw).indexOf("=");
    if (eq <= 0) throw new Error(`--assert takes key=value (e.g. --assert advisor_verified=true). Got: ${raw}`);
    const key = String(raw).slice(0, eq).trim();
    const value = String(raw).slice(eq + 1).trim();
    assertions[key] = value === "null" ? null : assertionValue(value);
  }
  return assertions;
}

export function standingTestParams(flags) {
  const params = {};
  if (flags.enrollment) params.enrollment = String(flags.enrollment);
  const simulate = {};
  const assertions = parseSimulatedAssertions(flags.asserts);
  if (Object.keys(assertions).length) simulate.assertions = assertions;
  if (flags.operatingType !== undefined) {
    simulate.operatingType = flags.operatingType === "null" || flags.operatingType === null ? null : String(flags.operatingType);
  }
  if (Object.keys(simulate).length) params.simulate = simulate;
  return params;
}

export async function standingCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand === "test") {
    const program = flags.program ?? flags._?.[0];
    if (!program) throw new Error("Usage: npx @boomin/cli standing test --program prog_… [--enrollment enr_…] [--assert key=value …] [--operating-type key]");
    const params = standingTestParams(flags);
    if (params.simulate && !params.enrollment) {
      throw new Error("--assert/--operating-type simulate ONE member's standing — add --enrollment enr_…");
    }
    const preview = await client.programs.standingPreview(String(program), params);
    if (flags.json) return log(JSON.stringify(preview, null, 2));
    if (!params.enrollment) {
      log(formatObject(preview, [
        ["Program", (p) => p.program],
        ["Enrollments", (p) => p.counts?.enrollments],
        ["Requirements", (p) => p.counts?.requirements],
        ["Tiers", (p) => p.counts?.tiers],
        ["By status", (p) => (p.counts?.byStatus ? JSON.stringify(p.counts.byStatus) : undefined)],
      ]));
      log("\nTarget one member for pass/fail detail: --enrollment enr_…");
      return;
    }
    const result = preview.enrollment ?? {};
    const verdict = result.status === "qualified" ? "PASS" : `FAIL (${result.status})`;
    log(`${verdict}${result.status === result.storedStatus ? "" : `  [stored: ${result.storedStatus}]`}${params.simulate ? "  [simulated]" : ""}`);
    log("");
    log(formatObject(result, [
      ["Enrollment", (r) => r.enrollment],
      ["Partner", (r) => r.partner],
      ["Operating as", (r) => r.operatingType ?? "(untyped)"],
      ["Tier", (r) => (r.tier ? `${r.tier.name} (rank ${r.tier.rank})` : undefined)],
      ["Score", (r) => r.score],
    ]));
    const describe = (entries) => (entries ?? []).map((m) => m.metricKey ?? m.requirement).join(", ") || "(none)";
    log(`\n  Met:    ${describe(result.met)}`);
    log(`  Failed: ${describe(result.failed)}`);
    if (Array.isArray(result.assertions) && result.assertions.length) {
      log("\n  Assertions seen by this evaluation:");
      for (const claim of result.assertions) {
        log(`    ${claim.key} = ${claim.value}${claim.simulated ? "  (simulated)" : ""}${claim.expiresAt ? `  expires ${claim.expiresAt}` : ""}`);
      }
    }
    return;
  }
  throw new Error(`Unknown standing subcommand: ${subcommand}. Use test.`);
}

// ── enrollment extensions (set-type, overrides) ───────────────────────────────

export async function enrollmentSetType(flags, ctx) {
  const { client, log } = ctx;
  const id = requireId(flags, "npx @boomin/cli enrollment set-type <enr_id> --type advisor  (or --clear)");
  if (!flags.type && !flags.clear) throw new Error("Pass --type <key> to set the capacity, or --clear to untype.");
  const enrollment = await client.enrollments.update(id, { operatingType: flags.clear ? null : String(flags.type) });
  if (flags.json) return log(JSON.stringify(enrollment, null, 2));
  return log(formatObject(enrollment, [
    ["Enrollment", (e) => e.id],
    ["Operating as", (e) => e.operatingType ?? "(untyped)"],
    ["Qualification", (e) => e.qualificationStatus],
  ]));
}

/** Build the PATCH-mode override body (`overrides set` / `disable`). */
export function overridePatchParams(flags, { disabled = false } = {}) {
  if (!flags.requirement) throw new Error("--requirement <uuid> names the program requirement to patch.");
  return {
    requirement: String(flags.requirement),
    ...(disabled ? { disabled: true } : {}),
    ...(flags.threshold !== undefined ? { threshold: numberFlag(flags.threshold, "--threshold") } : {}),
    ...(flags.operator ? { operator: String(flags.operator) } : {}),
    ...(flags.windowDays !== undefined ? { windowDays: numberFlag(flags.windowDays, "--window-days") } : {}),
    ...(flags.failurePolicy ? { failurePolicy: String(flags.failurePolicy) } : {}),
  };
}

/** Build the ADD-mode override body (`overrides add`). */
export function overrideAddParams(flags) {
  if (!flags.metricKey) throw new Error("--metric-key is required for an added requirement.");
  if (!flags.scope) throw new Error("--scope is required (program_entry|program_maintenance|tier).");
  return {
    metricKey: String(flags.metricKey),
    scope: String(flags.scope),
    ...(flags.scopeId ? { scopeId: String(flags.scopeId) } : {}),
    ...(flags.operator ? { operator: String(flags.operator) } : {}),
    ...(flags.threshold !== undefined ? { threshold: numberFlag(flags.threshold, "--threshold") } : {}),
    ...(flags.windowDays !== undefined ? { windowDays: numberFlag(flags.windowDays, "--window-days") } : {}),
    ...(flags.failurePolicy ? { failurePolicy: String(flags.failurePolicy) } : {}),
    ...(flags.required !== undefined ? { required: booleanFlag(flags.required) } : {}),
    ...(flags.weight !== undefined ? { weight: numberFlag(flags.weight, "--weight") } : {}),
  };
}

const OVERRIDE_COLUMNS = [
  { header: "ID", value: (o) => o.id },
  { header: "MODE", value: (o) => (o.requirement ? (o.disabled ? "disabled" : "patch") : "added") },
  { header: "REQUIREMENT", value: (o) => o.requirement ?? "" },
  { header: "METRIC", value: (o) => o.metricKey ?? "" },
  { header: "STATUS", value: (o) => o.status },
];

export async function enrollmentOverrides(subcommand, flags, ctx) {
  const { client, log } = ctx;
  const enrollmentId = flags._?.[1] ?? flags.enrollment;
  if (!enrollmentId) throw new Error("Usage: npx @boomin/cli enrollment overrides <list|set|add|disable|clear> <enr_id> [...]");
  const id = String(enrollmentId);
  if (subcommand === "list") {
    const page = await client.enrollments.requirementOverrides.list(id, listParams(flags));
    if (flags.json) return log(JSON.stringify(page, null, 2));
    return log(formatTable(page.data, OVERRIDE_COLUMNS));
  }
  if (subcommand === "set" || subcommand === "disable") {
    const override = await client.enrollments.requirementOverrides.create(id, overridePatchParams(flags, { disabled: subcommand === "disable" }));
    if (flags.json) return log(JSON.stringify(override, null, 2));
    return log(`Override ${override.id} ${subcommand === "disable" ? "suppresses" : "patches"} requirement ${override.requirement} (re-evaluation queued).`);
  }
  if (subcommand === "add") {
    const override = await client.enrollments.requirementOverrides.create(id, overrideAddParams(flags));
    if (flags.json) return log(JSON.stringify(override, null, 2));
    return log(`Override ${override.id} adds '${override.metricKey}' for this enrollment only (re-evaluation queued).`);
  }
  if (subcommand === "clear") {
    if (!flags.override) throw new Error("--override ovr_… names the override to archive (see: enrollment overrides list).");
    const result = await client.enrollments.requirementOverrides.del(id, String(flags.override));
    if (flags.json) return log(JSON.stringify(result, null, 2));
    return log(`Archived override ${flags.override} (the inherited requirement applies again).`);
  }
  throw new Error(`Unknown overrides subcommand: ${subcommand}. Use list|set|add|disable|clear.`);
}

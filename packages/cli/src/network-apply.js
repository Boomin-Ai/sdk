/**
 * `boomin network apply <file>` — declarative relationship-structure
 * restructuring (plan Phase 7, folded in by founder decision 2026-08-16).
 *
 * One JSON (or YAML, when the optional `yaml` package is installed) file
 * declares a program's DESIRED relationship structure — program settings,
 * operating types, metric keys, tiers, requirements (with type scoping and
 * failure_policy) — and the CLI diffs it against live state through the same
 * v1 APIs the imperative commands use, then applies creates / updates /
 * archives. `--dry-run` prints the diff and exits.
 *
 * Doctrine:
 * - NEVER deletes. Rows absent from the file are ARCHIVED — key
 *   non-recyclability holds; history stays readable.
 * - Matching is by STABLE KEY: operating types and metric keys by `key`,
 *   tiers by `name`, requirements by (metric_key, scope, operating_type) or
 *   an explicit `id`.
 * - Vocabulary ≠ capability is enforced by the API itself: a file naming an
 *   unregistered metric fails ITS row with the API's precise reason — the
 *   diff fails, the rail never sees it. Money rules (`payout_rules` /
 *   `reward_rules`) are NOT applied by this version and fail the diff
 *   loudly rather than being silently skipped.
 * - Applies SEQUENTIALLY, vocabulary before policy (metric keys and
 *   operating types land before the requirements that name them; archives
 *   land last). Each policy change re-evaluates standing server-side, so a
 *   sequential apply keeps that fan-out bounded and ordered.
 */

import fs from "node:fs/promises";

// ── File loading ──────────────────────────────────────────────────────────────

export async function loadNetworkFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  if (/\.ya?ml$/i.test(filePath)) {
    let yaml;
    try {
      yaml = await import("yaml");
    } catch {
      throw new Error("YAML files need the optional 'yaml' package: npm install yaml — or use JSON.");
    }
    return yaml.parse(text);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message}`);
  }
}

// ── Normalization (the file speaks the wire's snake_case; camel tolerated) ────

const pick = (row, ...names) => {
  for (const name of names) {
    if (row?.[name] !== undefined) return row[name];
  }
  return undefined;
};

export function normalizeNetworkFile(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The network file must be an object.");
  for (const unsupported of ["payout_rules", "payoutRules", "reward_rules", "rewardRules"]) {
    if (raw[unsupported] !== undefined) {
      throw new Error(
        `'${unsupported}' is not applied by this CLI version — money rules are excluded from declarative apply in v1 `
        + "(economics are immutable and the payout surface is built-ins-only). Remove the section, or configure money rules "
        + "with the imperative commands (npx @boomin/cli payout rule create …).",
      );
    }
  }
  const program = pick(raw, "program", "program_id", "programId");
  if (!program) throw new Error("The network file needs a `program` (prog_… id).");
  return {
    program: String(program),
    settings: pick(raw, "settings") ?? null,
    operatingTypes: (pick(raw, "operating_types", "operatingTypes") ?? []).map((row) => ({
      key: String(pick(row, "key") ?? ""),
      name: pick(row, "name") === undefined ? undefined : String(pick(row, "name")),
    })),
    metricKeys: (pick(raw, "metric_keys", "metricKeys") ?? []).map((row) => ({
      key: String(pick(row, "key") ?? ""),
      displayName: pick(row, "display_name", "displayName") === undefined ? undefined : String(pick(row, "display_name", "displayName")),
      description: pick(row, "description") === undefined ? undefined : pick(row, "description"),
    })),
    tiers: (pick(raw, "tiers") ?? []).map((row) => ({
      name: String(pick(row, "name") ?? ""),
      rank: pick(row, "rank"),
    })),
    requirements: (pick(raw, "requirements") ?? []).map((row) => ({
      id: pick(row, "id"),
      metricKey: pick(row, "metric_key", "metricKey") === undefined ? undefined : String(pick(row, "metric_key", "metricKey")),
      scope: pick(row, "scope") === undefined ? undefined : String(pick(row, "scope")),
      scopeId: pick(row, "scope_id", "scopeId") === undefined ? undefined : String(pick(row, "scope_id", "scopeId")),
      operatingType: pick(row, "operating_type", "operatingType") === undefined ? null : pick(row, "operating_type", "operatingType"),
      operator: pick(row, "operator") === undefined ? undefined : String(pick(row, "operator")),
      threshold: pick(row, "threshold"),
      windowDays: pick(row, "window_days", "windowDays"),
      failurePolicy: pick(row, "failure_policy", "failurePolicy"),
      weight: pick(row, "weight"),
      required: pick(row, "required"),
    })),
  };
}

// ── Diff ──────────────────────────────────────────────────────────────────────

/** One planned change. `detail` is human-readable; `run(client)` applies it. */
function change(kind, resource, label, detail, run) {
  return { kind, resource, label, detail, run };
}

const norm = (v) => (v === undefined || v === null || v === "" ? null : v);

function diffFields(live, desired, fields) {
  const changes = [];
  for (const [field, liveValue, desiredValue] of fields) {
    if (desiredValue === undefined) continue; // absent from the file = inherit
    if (norm(liveValue) !== norm(desiredValue)) changes.push(`${field}: ${JSON.stringify(liveValue ?? null)} → ${JSON.stringify(desiredValue)}`);
  }
  return changes;
}

/**
 * Compute the plan. Reads live state through the client; returns
 * `{ plan, notes }` where plan is ordered ready-to-run changes.
 */
export async function planNetworkApply(client, file) {
  const desired = normalizeNetworkFile(file);
  const plan = [];
  const notes = [];

  const [program, liveTypesPage, liveMetricsPage, liveRequirementsPage, liveTiersPage] = await Promise.all([
    client.programs.retrieve(desired.program),
    client.operatingTypes.list({ limit: 100 }),
    client.metricKeys.list({ limit: 100 }),
    client.programs.requirements.list(desired.program, { limit: 100 }),
    client.programs.tiers.list(desired.program, { limit: 100 }),
  ]);
  const liveTypes = liveTypesPage.data ?? [];
  const liveMetrics = (liveMetricsPage.data ?? []).filter((k) => !k.builtin);
  const liveRequirements = liveRequirementsPage.data ?? [];
  const liveTiers = liveTiersPage.data ?? [];

  // 1 · Vocabulary FIRST — the requirements below may name it.
  const typeByKey = new Map(liveTypes.map((t) => [t.key, t]));
  for (const row of desired.operatingTypes) {
    if (!row.key) throw new Error("Every operating_types row needs a key.");
    const live = typeByKey.get(row.key);
    if (!live) {
      plan.push(change("create", "operating_type", row.key, `name ${JSON.stringify(row.name ?? row.key)}`, (c) =>
        c.operatingTypes.create({ key: row.key, name: row.name ?? row.key })));
      continue;
    }
    if (live.status === "archived") {
      plan.push(change("update", "operating_type", row.key, "reactivate (archived → active)", (c) =>
        c.operatingTypes.update(live.id, { status: "active", ...(row.name ? { name: row.name } : {}) })));
      continue;
    }
    const delta = diffFields(live, row, [["name", live.name, row.name]]);
    if (delta.length) {
      plan.push(change("update", "operating_type", row.key, delta.join(", "), (c) =>
        c.operatingTypes.update(live.id, { name: row.name })));
    }
  }
  const desiredTypeKeys = new Set(desired.operatingTypes.map((r) => r.key));
  for (const live of liveTypes) {
    if (live.status === "active" && desired.operatingTypes.length && !desiredTypeKeys.has(live.key)) {
      plan.push(change("archive", "operating_type", live.key, "absent from file (never deleted — archived)", (c) =>
        c.operatingTypes.archive(live.id)));
    }
  }

  const metricByKey = new Map(liveMetrics.map((k) => [k.key, k]));
  for (const row of desired.metricKeys) {
    if (!row.key) throw new Error("Every metric_keys row needs a key.");
    const live = metricByKey.get(row.key);
    if (!live) {
      plan.push(change("create", "metric_key", row.key, `display_name ${JSON.stringify(row.displayName ?? row.key.replace(/^x:/, ""))}`, (c) =>
        c.metricKeys.create({ key: row.key, ...(row.displayName ? { displayName: row.displayName } : {}), ...(row.description !== undefined ? { description: row.description } : {}) })));
      continue;
    }
    if (live.status === "archived") {
      plan.push(change("update", "metric_key", row.key, "reactivate (archived → active)", (c) =>
        c.metricKeys.update(live.id, { status: "active" })));
      continue;
    }
    const delta = diffFields(live, row, [
      ["display_name", live.displayName, row.displayName],
      ["description", live.description, row.description],
    ]);
    if (delta.length) {
      plan.push(change("update", "metric_key", row.key, delta.join(", "), (c) =>
        c.metricKeys.update(live.id, {
          ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
          ...(row.description !== undefined ? { description: row.description } : {}),
        })));
    }
  }
  const desiredMetricKeys = new Set(desired.metricKeys.map((r) => r.key));
  for (const live of liveMetrics) {
    if (live.status === "active" && desired.metricKeys.length && !desiredMetricKeys.has(live.key)) {
      plan.push(change("archive", "metric_key", live.key, "absent from file (never deleted — archived)", (c) =>
        c.metricKeys.archive(live.id)));
    }
  }

  // 2 · Program settings.
  if (desired.settings) {
    const delta = diffFields(program, desired.settings, [
      ["name", program.name, desired.settings.name],
      ["status", program.status, desired.settings.status],
      ["visibility", program.visibility, desired.settings.visibility],
    ]);
    if (delta.length) {
      plan.push(change("update", "program", program.id, delta.join(", "), (c) => c.programs.update(program.id, {
        ...(desired.settings.name !== undefined ? { name: desired.settings.name } : {}),
        ...(desired.settings.status !== undefined ? { status: desired.settings.status } : {}),
        ...(desired.settings.visibility !== undefined ? { visibility: desired.settings.visibility } : {}),
      })));
    }
  }

  // 3 · Tiers (matched by name).
  const tierByName = new Map(liveTiers.map((t) => [t.name, t]));
  for (const row of desired.tiers) {
    if (!row.name) throw new Error("Every tiers row needs a name.");
    const live = tierByName.get(row.name);
    if (!live) {
      plan.push(change("create", "tier", row.name, `rank ${row.rank ?? 0}`, (c) =>
        c.programs.tiers.create(desired.program, { name: row.name, rank: row.rank ?? 0 })));
      continue;
    }
    const delta = diffFields(live, row, [["rank", live.rank, row.rank]]);
    if (delta.length) {
      plan.push(change("update", "tier", row.name, delta.join(", "), (c) =>
        c.programs.tiers.update(desired.program, live.id, { rank: row.rank })));
    }
  }
  const desiredTierNames = new Set(desired.tiers.map((r) => r.name));
  for (const live of liveTiers) {
    if (desired.tiers.length && !desiredTierNames.has(live.name) && live.status !== "archived") {
      plan.push(change("archive", "tier", live.name, "absent from file (never deleted — archived)", (c) =>
        c.programs.tiers.del(desired.program, live.id)));
    }
  }

  // 4 · Requirements — matched by explicit id, else (metric_key, scope,
  //     operating_type). Live rows carry otype_ ids; the file speaks keys.
  const typeIdByKey = new Map(liveTypes.map((t) => [t.key, t.id]));
  const typeKeyById = new Map(liveTypes.map((t) => [t.id, t.key]));
  const requirementIdentity = (metricKey, scope, operatingTypeKey) => `${metricKey}\u0000${scope}\u0000${operatingTypeKey ?? ""}`;
  const liveByIdentity = new Map();
  for (const live of liveRequirements) {
    if (live.status === "archived") continue;
    liveByIdentity.set(requirementIdentity(live.metricKey, live.scope, typeKeyById.get(live.operatingType) ?? null), live);
  }
  const liveById = new Map(liveRequirements.map((r) => [r.id, r]));
  const matchedIds = new Set();

  for (const row of desired.requirements) {
    if (!row.id && (!row.metricKey || !row.scope)) {
      throw new Error("Every requirements row needs metric_key + scope (or an explicit id).");
    }
    const typeKey = row.operatingType == null ? null : String(row.operatingType);
    if (typeKey && !typeIdByKey.has(typeKey) && !desiredTypeKeys.has(typeKey)) {
      throw new Error(`Requirement '${row.metricKey}' names operating_type '${typeKey}', which is neither live nor declared in the file.`);
    }
    const live = row.id ? liveById.get(row.id) : liveByIdentity.get(requirementIdentity(row.metricKey, row.scope, typeKey));
    if (row.id && !live) throw new Error(`Requirement id '${row.id}' does not exist on this program.`);
    const label = `${row.metricKey ?? live?.metricKey}${typeKey ? ` @${typeKey}` : ""}`;
    if (!live) {
      plan.push(change("create", "requirement", label, `${row.scope}${row.operator ? ` ${row.operator}` : ""}${row.threshold != null ? ` ${row.threshold}` : ""}${row.failurePolicy ? `, ${row.failurePolicy}` : ""}`, (c) =>
        c.programs.requirements.create(desired.program, {
          metricKey: row.metricKey,
          scope: row.scope,
          ...(row.scopeId !== undefined ? { scopeId: row.scopeId } : {}),
          ...(typeKey !== null ? { operatingType: typeKey } : {}),
          ...(row.operator !== undefined ? { operator: row.operator } : {}),
          ...(row.threshold !== undefined ? { threshold: row.threshold } : {}),
          ...(row.windowDays !== undefined ? { windowDays: row.windowDays } : {}),
          ...(row.failurePolicy !== undefined ? { failurePolicy: row.failurePolicy } : {}),
          ...(row.weight !== undefined ? { weight: row.weight } : {}),
          ...(row.required !== undefined ? { required: row.required } : {}),
        })));
      continue;
    }
    matchedIds.add(live.id);
    const delta = diffFields(live, row, [
      ["operator", live.operator, row.operator],
      ["threshold", live.threshold, row.threshold],
      ["window_days", live.windowDays, row.windowDays],
      ["failure_policy", live.failurePolicy, row.failurePolicy],
      ["weight", live.weight, row.weight],
      ["required", live.required, row.required],
    ]);
    if (delta.length) {
      plan.push(change("update", "requirement", label, delta.join(", "), (c) =>
        c.programs.requirements.update(desired.program, live.id, {
          ...(row.operator !== undefined ? { operator: row.operator } : {}),
          ...(row.threshold !== undefined ? { threshold: row.threshold } : {}),
          ...(row.windowDays !== undefined ? { windowDays: row.windowDays } : {}),
          ...(row.failurePolicy !== undefined ? { failurePolicy: row.failurePolicy } : {}),
          ...(row.weight !== undefined ? { weight: row.weight } : {}),
          ...(row.required !== undefined ? { required: row.required } : {}),
        })));
    }
  }
  // Archives LAST — a requirement referencing a type stays historical.
  for (const live of liveRequirements) {
    if (live.status === "archived" || matchedIds.has(live.id)) continue;
    if (!desired.requirements.length) continue;
    const label = `${live.metricKey}${live.operatingType ? ` @${typeKeyById.get(live.operatingType) ?? live.operatingType}` : ""}`;
    plan.push(change("archive", "requirement", label, "absent from file (never deleted — archived)", (c) =>
      c.programs.requirements.update(desired.program, live.id, { status: "archived" })));
  }

  if (!desired.operatingTypes.length) notes.push("No operating_types section — live types untouched.");
  if (!desired.metricKeys.length) notes.push("No metric_keys section — live tenant metrics untouched.");
  if (!desired.tiers.length) notes.push("No tiers section — live tiers untouched.");
  if (!desired.requirements.length) notes.push("No requirements section — live requirements untouched.");

  return { plan, notes, program };
}

const MARKS = { create: "+", update: "~", archive: "-" };

export function renderPlan(plan, notes, log) {
  if (!plan.length) {
    log("No changes — live state already matches the file.");
  } else {
    for (const step of plan) log(`  ${MARKS[step.kind]} ${step.resource} ${step.label}  (${step.detail})`);
  }
  for (const note of notes) log(`  · ${note}`);
}

export async function networkCommand(subcommand, flags, ctx) {
  const { client, log } = ctx;
  if (subcommand !== "apply") {
    throw new Error(`Unknown network subcommand: ${subcommand}. Use apply.`);
  }
  const filePath = flags._?.[0] ?? flags.file;
  if (!filePath) throw new Error("Usage: npx @boomin/cli network apply <file.json> [--dry-run]");
  const file = await loadNetworkFile(String(filePath));
  const { plan, notes, program } = await planNetworkApply(client, file);
  log(`Plan for ${program.name ?? program.id} (${program.id}):`);
  renderPlan(plan, notes, log);
  if (flags.dryRun) {
    log("\nDry run — nothing applied.");
    return;
  }
  if (!plan.length) return;
  log("");
  let applied = 0;
  for (const step of plan) {
    // Sequential on purpose: each policy change re-evaluates standing
    // server-side; ordered application keeps that fan-out bounded.
    try {
      await step.run(client);
      applied += 1;
      log(`  ✓ ${MARKS[step.kind]} ${step.resource} ${step.label}`);
    } catch (error) {
      log(`  ✗ ${MARKS[step.kind]} ${step.resource} ${step.label} — ${error.message}`);
      throw new Error(`Apply stopped at step ${applied + 1}/${plan.length} (${step.resource} ${step.label}): ${error.message}\nEverything before this step is applied; re-running apply is safe — the diff re-computes from live state.`);
    }
  }
  log(`\nApplied ${applied} change${applied === 1 ? "" : "s"}. Standing re-evaluations run server-side per change.`);
}

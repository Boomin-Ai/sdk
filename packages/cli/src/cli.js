#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ApiError } from "./errors.js";
import { isV1Group, runV1Command } from "./v1.js";

const DEFAULT_APP_API_BASE = "https://api.boomin.ai/v1/app";
const DEFAULT_PLATFORM_API_BASE = "https://api.boomin.ai/v1/platform";
const DEFAULT_CONNECT_API_BASE = "https://api.boomin.ai/v1/connect";
const DEFAULT_WEB_BASE = "https://boomin.ai";
const CONFIG_DIR = path.join(os.homedir(), ".boomin");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const ENV_KEYS = ["VITE_BOOMIN_PUBLIC_KEY", "VITE_BOOMIN_PROGRAM_ID", "VITE_BOOMIN_API_BASE"];
const BOOMIN_SKILL_NAME = "boomin-referral-installer";
const BOOMIN_SKILLS_REPO = "https://github.com/Boomin-Ai/boomin-skills.git";

const PLATFORM_SCOPES = [
  { scope: "org:read", category: "setup", description: "Read current organization context." },
  { scope: "connect_config:read", category: "setup", description: "Read Creator Connect developer setup." },
  { scope: "connect_config:write", category: "setup", description: "Update Creator Connect allowed origins and setup." },
  { scope: "handoff:read", category: "setup", description: "Read the program handoff signing config (without the secret)." },
  { scope: "handoff:write", category: "setup", description: "Provision or rotate the program handoff signing secret." },
  { scope: "programs:read", category: "programs", description: "Read creator programs." },
  { scope: "programs:create", category: "programs", description: "Create creator programs." },
  { scope: "programs:update", category: "programs", description: "Update creator programs." },
  { scope: "programs:delete", category: "programs", description: "Archive creator programs." },
  { scope: "program_members:read", category: "programs", description: "Read program members." },
  { scope: "program_members:approve", category: "programs", description: "Approve or reject program members." },
  { scope: "program_resources:read", category: "programs", description: "Read program resources." },
  { scope: "program_resources:write", category: "programs", description: "Create or update program resources." },
  { scope: "program_requirements:read", category: "programs", description: "Read program qualification requirements." },
  { scope: "program_requirements:write", category: "programs", description: "Create or update program qualification requirements." },
  { scope: "program_tiers:read", category: "programs", description: "Read program tier ladders." },
  { scope: "program_tiers:write", category: "programs", description: "Create or update program tier ladders." },
  { scope: "campaigns:read", category: "programs", description: "Read campaigns." },
  { scope: "campaigns:write", category: "programs", description: "Create or update campaigns." },
  { scope: "benefits:read", category: "programs", description: "Read benefits and entitlements." },
  { scope: "benefits:write", category: "programs", description: "Create or update benefits." },
  { scope: "webhooks:read", category: "programs", description: "Read webhook sources, endpoints, and deliveries." },
  { scope: "webhooks:write", category: "programs", description: "Create or update webhook configuration." },
  { scope: "series:read", category: "content", description: "Read series. Internally maps to productions." },
  { scope: "series:create", category: "content", description: "Create series. Internally maps to productions." },
  { scope: "series:update", category: "content", description: "Update series. Internally maps to productions." },
  { scope: "series:delete", category: "content", description: "Archive or delete series. Internally maps to productions." },
  { scope: "units:read", category: "content", description: "Read units." },
  { scope: "units:create", category: "content", description: "Create units." },
  { scope: "units:update", category: "content", description: "Update units." },
  { scope: "units:delete", category: "content", description: "Delete draft units." },
  { scope: "units:publish", category: "content", description: "Publish units to connected channels." },
  { scope: "pages:read", category: "ui_assets", description: "Read pages." },
  { scope: "pages:write", category: "ui_assets", description: "Create or update pages." },
  { scope: "pages:delete", category: "ui_assets", description: "Delete pages." },
  { scope: "canvas:read", category: "ui_assets", description: "Read canvases." },
  { scope: "canvas:write", category: "ui_assets", description: "Create or update canvases." },
  { scope: "canvas:delete", category: "ui_assets", description: "Delete canvases." },
  { scope: "files:read", category: "ui_assets", description: "Read files and folders." },
  { scope: "files:write", category: "ui_assets", description: "Upload, register, or move files and folders." },
  { scope: "files:delete", category: "ui_assets", description: "Delete files and folders." },
  { scope: "agents:read", category: "automation_data", description: "Read agents." },
  { scope: "agents:write", category: "automation_data", description: "Create or update agents." },
  { scope: "agents:run", category: "automation_data", description: "Run agents or read runs." },
  { scope: "workflows:read", category: "automation_data", description: "Read workflows." },
  { scope: "workflows:write", category: "automation_data", description: "Create or update workflows." },
  { scope: "workflows:run", category: "automation_data", description: "Trigger workflows or read runs." },
  { scope: "contacts:read", category: "automation_data", description: "Read contacts." },
  { scope: "segments:read", category: "automation_data", description: "Read segments." },
  { scope: "segments:write", category: "automation_data", description: "Create or update segments." },
  { scope: "events:read", category: "automation_data", description: "Read events." },
  { scope: "events:write", category: "automation_data", description: "Record safe platform events." },
  { scope: "commerce:read", category: "commerce", description: "Read commerce products, offers, and invoices." },
  { scope: "commerce:write", category: "commerce", description: "Create or update safe commerce resources. Excludes billing and payouts." },
];

const MCP_SKILL_PACKS = {
  referral_installer: {
    label: "Referral Program Installer",
    scopes: ["org:read", "connect_config:read", "handoff:write", "events:write"],
  },
  program_operator: {
    label: "Program Operator",
    scopes: [
      "org:read",
      "programs:read",
      "programs:update",
      "connect_config:read",
      "connect_config:write",
      "program_requirements:read",
      "program_requirements:write",
      "program_tiers:read",
      "program_tiers:write",
    ],
  },
};

// ── Platform API v1 scopes (DISTRIBUTION_CORE §4) ─────────────────────────────
// Issue/validate alongside the legacy scope registry above. Deliberately NOT
// part of PLATFORM_SCOPES: `platform smoke --all-scopes` executes each legacy
// scope through /scopes_exec, which does not cover the v1 REST tree.
const PLATFORM_V1_SCOPES = [
  { scope: "distributions:read", category: "platform_v1", description: "Read distributions." },
  { scope: "distributions:write", category: "platform_v1", description: "Create, update, validate, pause, resume, or cancel distributions." },
  { scope: "distributions:launch", category: "platform_v1", description: "Launch distributions (distinct from distributions:write)." },
  { scope: "deployments:read", category: "platform_v1", description: "Read deployments and their observed state." },
  { scope: "enrollments:read", category: "platform_v1", description: "Read program enrollments." },
  { scope: "enrollments:write", category: "platform_v1", description: "Invite, approve, reject, pause, or resume enrollments." },
  { scope: "partnerships:read", category: "platform_v1", description: "Read durable partnerships." },
  { scope: "partnerships:write", category: "platform_v1", description: "Pause, resume, end, or update partnerships." },
  { scope: "connections:read", category: "platform_v1", description: "Read provider connections and grants." },
  { scope: "connections:write", category: "platform_v1", description: "Revoke provider connections." },
  { scope: "performance:read", category: "platform_v1", description: "Read performance summaries." },
  { scope: "performance:write", category: "platform_v1", description: "Ingest business performance events." },
  { scope: "operations:read", category: "platform_v1", description: "Read operations (default-granted; the progress surface for every mutation)." },
  { scope: "payouts:read", category: "platform_v1", description: "Read payouts, batches, and connect status." },
  { scope: "payouts:write", category: "platform_v1", description: "Run payout computation, build batches, export, confirm, and cancel." },
  // CONFIGURATION is scoped apart from money movement on purpose: a rail's
  // column mapping decides which field of a payout row lands in the recipient
  // column of a file a bank ingests. `payouts:write` moves money the brand
  // already owes; it must not also redirect where that money lands.
  { scope: "payout_rules:read", category: "platform_v1", description: "Read payout rules (how a partner earns)." },
  { scope: "payout_rules:write", category: "platform_v1", description: "Create, update, or archive payout rules." },
  { scope: "payout_rails:read", category: "platform_v1", description: "Read payout rails and their delivery config." },
  { scope: "payout_rails:write", category: "platform_v1", description: "Configure payout rails (where money physically lands)." },
  { scope: "partners:read", category: "platform_v1", description: "Read partner identities." },
  { scope: "handoff:read", category: "platform_v1", description: "Read program handoff configs (v1 tree)." },
];

function parseArgs(argv) {
  const out = { _: [], origins: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const [rawKey, rawValue] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const takesValue = [
      "apiBase",
      "platformApiBase",
      "webBase",
      "connectApiBase",
      "origin",
      "timeout",
      "pollInterval",
      "orgId",
      "orgName",
      "brandId",
      "brandName",
      "programId",
      "programName",
      "name",
      "scopes",
      "token",
      "tokenId",
      "idempotencyKey",
      "type",
      "caption",
      "productionId",
      "framework",
      "auth",
      "route",
      "page",
      "joinRoute",
      "statusRoute",
      "redirectRoute",
      "destinationUrl",
      "issuer",
      "audience",
      "signingSecret",
      "pack",
      "packs",
      "scope",
      "serverName",
      "mcpUrl",
      "claudeCommand",
      "target",
      "source",
      // Platform v1 command groups (CLI 0.3.0)
      "programs",
      "objective",
      "description",
      "spec",
      "subjects",
      "budget",
      "budgetMode",
      "budgetAsset",
      "budgetTotal",
      "email",
      "partner",
      "referralCode",
      "program",
      "status",
      "approvalStatus",
      "limit",
      "startingAfter",
      "periodStart",
      "periodEnd",
      "out",
      "url",
      "events",
      "metadata",
      "brand",
      "distribution",
      "deployment",
      // Payout configuration (CLI 0.4.0). `--wallet-funded` and `--default`
      // are deliberately absent: they are bare booleans (`--default=false`
      // still works, since an `=` value is read before this list is consulted).
      "rail",
      "config",
      "format",
      "columns",
      "scope",
      "scopeType",
      "collection",
      "unit",
      "member",
      "metricKey",
      "rateBps",
      "perUnitMinor",
      "threshold",
      "bonusMinor",
      "windowKey",
      "windowDays",
      "currency",
      "externalBatchRef",
      "results",
    ].includes(key);
    const value = rawValue ?? (takesValue ? argv[++index] : true);
    if (key === "origin") out.origins.push(String(value));
    else out[key] = value;
  }
  return out;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function appApiBase(flags = {}) {
  return stripTrailingSlash(flags.apiBase || process.env.BOOMIN_API_BASE || DEFAULT_APP_API_BASE);
}

function platformApiBase(flags = {}) {
  return stripTrailingSlash(flags.platformApiBase || process.env.BOOMIN_PLATFORM_API_BASE || DEFAULT_PLATFORM_API_BASE);
}

function webBase(flags = {}) {
  return stripTrailingSlash(flags.webBase || process.env.BOOMIN_WEB_BASE_URL || DEFAULT_WEB_BASE);
}

function connectApiBase(flags = {}) {
  return stripTrailingSlash(flags.connectApiBase || process.env.BOOMIN_CONNECT_API_BASE || DEFAULT_CONNECT_API_BASE);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const values = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
    }
    return { exists: true, path: filePath, values };
  } catch {
    return { exists: false, path: filePath, values: {} };
  }
}

async function loadConfig() {
  const config = await readJson(CONFIG_PATH, {});
  if (process.env.BOOMIN_AUTH_TOKEN) config.authToken = process.env.BOOMIN_AUTH_TOKEN;
  if (process.env.BOOMIN_PLATFORM_TOKEN) config.platformToken = process.env.BOOMIN_PLATFORM_TOKEN;
  return config;
}

async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

async function clearConfig() {
  await fs.rm(CONFIG_PATH, { force: true });
}

function parseApiError(data, fallbackMessage, status) {
  const raw = data?.message || data?.error || fallbackMessage || "Request failed";
  const message = String(raw);
  const missingScope = message.startsWith("missing_scope:") ? message.slice("missing_scope:".length) : null;
  return {
    message,
    code: missingScope ? "missing_scope" : message,
    requiredScope: missingScope,
    suggestedCommand: missingScope ? `npx @boomin/cli scopes explain ${missingScope}` : undefined,
    status,
  };
}

async function request(apiBase, route, options = {}) {
  const url = new URL(`${apiBase}${route}`);
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.platformToken ? { Authorization: `Bearer ${options.platformToken}` } : {}),
    ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
  };
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const parsed = parseApiError(data, text || response.statusText, response.status);
    throw new ApiError(parsed.message, { ...parsed, response: data });
  }
  return data;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  );
}

function redactSecrets(value) {
  return String(value || "").replace(/sk_boomin_live_[A-Za-z0-9_-]+/g, "sk_boomin_live_...");
}

function apiRootFromAppBase(value) {
  const url = new URL(appApiBase({ apiBase: value }));
  url.pathname = url.pathname.replace(/\/v1\/app\/?$/, "") || "/";
  url.search = "";
  url.hash = "";
  return stripTrailingSlash(url.toString());
}

function printHelp(topic = []) {
  const [first, second] = topic;
  if (first === "doctor") {
    console.log(`Boomin CLI - doctor

Usage:
  npx @boomin/cli doctor
  npx @boomin/cli doctor --json
  npx @boomin/cli doctor --strict
  npx @boomin/cli doctor --origin http://localhost:5173

Checks:
  Runtime, Boomin API health, saved login, .env.local, Connect config,
  admin config, optional signed handoff config, and optional platform token.

Flags:
  --strict            Treat warnings and skipped optional checks as failures.
  --origin <url>      Require an allowed origin. Can be repeated.
  --json              Print machine-readable output for agents.
`);
    return;
  }
  if (first === "token" && second === "create") {
    console.log(`Boomin CLI - token create

Usage:
  npx @boomin/cli token create --name "Agent" --scopes org:read,units:read,units:create

Flags:
  --name <text>       Token label shown in Boomin.
  --scopes <csv>      Comma-separated platform scopes.
  --save              Store the created secret locally for smoke commands.
  --json              Print machine-readable output.

Notes:
  The secret is shown once. Store it in a server secret manager or env var.
`);
    return;
  }
  if (first === "token") {
    console.log(`Boomin CLI - token commands

Usage:
  npx @boomin/cli token create --name "Agent" --scopes org:read,units:read
  npx @boomin/cli token list
  npx @boomin/cli token revoke <token_id>
  npx @boomin/cli token rotate <token_id>

Flags:
  --json              Print machine-readable output.
  --save              On create/rotate, save the new secret locally.

See also:
  npx @boomin/cli scopes
  npx @boomin/cli platform smoke --read-only
`);
    return;
  }
  if (first === "scopes") {
    console.log(`Boomin CLI - scopes

Usage:
  npx @boomin/cli scopes
  npx @boomin/cli scopes --json
  npx @boomin/cli scopes explain units:create

Scope shape:
  resource:action

Example:
  npx @boomin/cli token create --name "Unit Agent" --scopes org:read,units:read,units:create,units:delete
`);
    return;
  }
  if (first === "platform" && second === "smoke") {
    console.log(`Boomin CLI - platform smoke

Usage:
  npx @boomin/cli platform smoke --read-only --token sk_boomin_live_...
  npx @boomin/cli platform smoke --write --cleanup --token sk_boomin_live_...
  npx @boomin/cli platform smoke --all-scopes --cleanup

Flags:
  --read-only         Check token identity and safe reads.
  --write            Create a disposable draft unit.
  --all-scopes        Create a temporary all-scope token and execute every V1 scope.
  --cleanup          Delete the disposable unit after write smoke.
  --token <secret>   Platform token. Defaults to BOOMIN_PLATFORM_TOKEN or saved config.
  --json             Print machine-readable output.
`);
    return;
  }
  if (first === "platform") {
    console.log(`Boomin CLI - platform commands

Usage:
  npx @boomin/cli platform smoke --read-only
  npx @boomin/cli platform smoke --write --cleanup
  npx @boomin/cli platform smoke --all-scopes --cleanup

Use platform tokens for agents and server-side automation. Do not put sk_boomin_live_* tokens in browser code.
`);
    return;
  }
  if (first === "handoff" && second === "init") {
    console.log(`Boomin CLI - handoff init

Usage:
  npx @boomin/cli handoff init --framework next --auth custom
  npx @boomin/cli handoff init --framework next --auth clerk --write
  npx @boomin/cli handoff init --framework next --auth supabase --route app/api/boomin/creator/join/route.js

Flags:
  --framework next    Generate a Next.js route handler. Other frameworks are coming later.
  --auth custom       custom, clerk, or supabase.
  --route <path>      Route file to write when --write is passed.
  --write             Write the route file instead of printing it.
  --yes               Overwrite an existing generated route without prompting.
  --json              Print machine-readable output.
`);
    return;
  }
  if (first === "handoff" && (second === "provision" || second === "rotate")) {
    console.log(`Boomin CLI - handoff provision

Usage:
  npx @boomin/cli handoff provision
  npx @boomin/cli handoff provision --issuer your-app.com
  npx @boomin/cli handoff provision --rotate

What it does:
  Mints (or rotates) the program's HMAC handoff signing secret and saves it to
  .env.local as BOOMIN_HANDOFF_SIGNING_SECRET / BOOMIN_HANDOFF_ISSUER, alongside
  BOOMIN_CONNECT_PROGRAM_ID / BOOMIN_CONNECT_PUBLIC_KEY. The secret is shown once.

Flags:
  --issuer <id>       Handoff token issuer. Defaults to your-app.com (and to any
                      existing BOOMIN_HANDOFF_ISSUER in .env.local).
  --audience <id>     Handoff token audience. Defaults to boomin.ai.
  --program-id <id>   Program to provision. Defaults to the id in .env.local / config.
  --rotate            Mint a new secret even if one already exists (invalidates the old one).
  --dry-run           Print the secret without writing .env.local.
  --json              Print machine-readable output.

Notes:
  Requires login (npx @boomin/cli login) as an admin of the program.
  Run after init; then doctor's handoff_config check should pass.
`);
    return;
  }
  if (first === "handoff") {
    console.log(`Boomin CLI - handoff commands

Usage:
  npx @boomin/cli handoff provision                 Mint the handoff signing secret and write env.
  npx @boomin/cli handoff provision --rotate        Rotate the signing secret.
  npx @boomin/cli handoff init --framework next     Print or write a signed-handoff route template.

See also:
  npx @boomin/cli referral init --framework next --auth custom --write
  npx @boomin/cli doctor
`);
    return;
  }
  if (first === "referral" && second === "init") {
    console.log(`Boomin CLI - referral init

Usage:
  npx @boomin/cli referral init --framework next --auth custom
  npx @boomin/cli referral init --framework next --auth clerk --write
  npx @boomin/cli referral init --framework next --auth supabase --write --yes

Generated files:
  app/api/boomin/partner/join/route.js
  app/api/boomin/partner/status/route.js
  app/r/[code]/route.js
  app/partner/page.jsx

With --write it also wires the referral runtime:
  - writes BOOMIN_REFERRAL_DESTINATION_URL to .env.local (defaults to your app's primary origin)
  - sets program metadata referralBaseUrl to "<primary origin>/r" so referral
    links use your app's /r route instead of the boomin.ai/r/ fallback
    (an already-set referralBaseUrl is kept unless --origin is passed)

Flags:
  --framework next        Generate Next.js App Router files.
  --auth custom           custom, clerk, or supabase.
  --write                 Write files instead of printing a preview.
  --yes                   Overwrite existing generated files.
  --origin <url>          Primary app origin for referralBaseUrl (repeatable; first wins).
  --destination-url <url> Where /r/[code] redirects (BOOMIN_REFERRAL_DESTINATION_URL).
  --program-id <id>       Program to configure (defaults to .env.local / saved config).
  --json                  Print machine-readable output.
`);
    return;
  }
  if (first === "referral") {
    console.log(`Boomin CLI - referral-first scaffolding

Usage:
  npx @boomin/cli referral init --framework next --auth custom

This generates a signed handoff join route, current-user partner standing API, referral redirect tracker, and a starter partner page.
`);
    return;
  }
  if (first === "mcp") {
    console.log(`Boomin CLI - MCP

Usage:
  npx @boomin/cli mcp install
  npx @boomin/cli mcp install --pack program_operator

Wires the hosted Boomin MCP into Claude Code with a scoped static bearer token at user scope.

Environment:
  BOOMIN_PLATFORM_TOKEN       Optional sk_boomin_live_* token for scoped API tools.
  BOOMIN_MCP_SKILL_PACKS      referral_installer or referral_installer,program_operator.

Hosted:
  claude mcp add --transport http boomin https://mcp.boomin.ai/mcp

Remote MCP OAuth:
  https://mcp.boomin.ai/.well-known/oauth-authorization-server
  https://mcp.boomin.ai/authorize
`);
    return;
  }
  if (first === "skill") {
    console.log(`Boomin CLI - skills

Usage:
  npx @boomin/cli skill install
  npx @boomin/cli skill install --target claude
  npx @boomin/cli skill install --target codex
  npx @boomin/cli skill install --source C:\\path\\to\\boomin-skills --yes

Installs the Boomin referral installer skill for Claude Code and/or Codex.

Flags:
  --target all|claude|codex  Install target. Defaults to all.
  --source <path-or-git-url> Skill repo source. Defaults to ${BOOMIN_SKILLS_REPO}
  --yes                     Replace an existing installed skill.
  --json                    Print machine-readable output.
`);
    return;
  }
  if (first === "handoff") {
    console.log(`Boomin CLI - signed handoff

Usage:
  npx @boomin/cli handoff init --framework next --auth custom

Signed handoff lets your logged-in app user click one button while your server signs their identity into Boomin Partner Connect.
`);
    return;
  }
  if (first === "distribution") {
    console.log(`Boomin CLI - distributions (Platform v1)

Usage:
  npx @boomin/cli distribution create --name "Launch" --objective acquisition --programs prog_...
  npx @boomin/cli distribution list [--status draft|ready|launching|active|paused|...]
  npx @boomin/cli distribution get <dist_id>
  npx @boomin/cli distribution validate <dist_id>
  npx @boomin/cli distribution launch <dist_id> [--no-wait]
  npx @boomin/cli distribution pause <dist_id> [--no-wait]
  npx @boomin/cli distribution resume <dist_id> [--no-wait]
  npx @boomin/cli distribution cancel <dist_id> [--no-wait]

Create flags:
  --name <text>            Distribution name (required).
  --objective <text>       awareness|acquisition|launch|conversion|retention|event_promotion|custom.
  --programs <csv>         Program ids supplying eligible enrollments (prog_...).
  --description <text>     Optional description.
  --spec <json>            Deployment plan spec as a JSON string.
  --budget <json>          {"mode":"funded","asset":"credit","total":10000} (minor units), or:
  --budget-mode <mode>     none|metered|funded  (+ --budget-asset usd|credit, --budget-total <minor>)

Launch/pause/resume/cancel are async (202 + operation). The CLI polls the
operation to a terminal status by default; --no-wait returns immediately.
  --timeout <seconds>      Operation wait budget (default 120).
  --poll-interval <secs>   Poll interval (default 2).

Auth: --token sk_boomin_live_... or BOOMIN_PLATFORM_TOKEN (needs distributions:*).
`);
    return;
  }
  if (first === "enrollment") {
    console.log(`Boomin CLI - enrollments (Platform v1, program-scoped)

Usage:
  npx @boomin/cli enrollment invite --program prog_... --email partner@example.com [--name "Ada"]
  npx @boomin/cli enrollment invite --program prog_... --partner ptnr_...
  npx @boomin/cli enrollment approve <enr_id>
  npx @boomin/cli enrollment reject <enr_id>
  npx @boomin/cli enrollment list [--program prog_...] [--status active|paused|archived] [--approval-status pending|approved|rejected]
  npx @boomin/cli enrollment get <enr_id>

Invite creates the enrollment (payload carries the program) and the durable
partnership when none exists. Approve/reject only move approval_status;
rejection is not terminal (re-invite resets it to pending).
`);
    return;
  }
  if (first === "partnership") {
    console.log(`Boomin CLI - partnerships (Platform v1)

Usage:
  npx @boomin/cli partnership list [--status pending|active|paused|ended]
  npx @boomin/cli partnership get <pship_id>
  npx @boomin/cli partnership pause <pship_id>
  npx @boomin/cli partnership resume <pship_id>
  npx @boomin/cli partnership end <pship_id>

Pause stops this partner's own links on the channels they run on — it never
pauses a shared channel. Enrollments and links are preserved (attribution
continues). End is the explicit terminal verb.
`);
    return;
  }
  if (first === "connection") {
    console.log(`Boomin CLI - connections (Platform v1)

Usage:
  npx @boomin/cli connection list
  npx @boomin/cli connection get <conn_id>
  npx @boomin/cli connection revoke <conn_id>
`);
    return;
  }
  if (first === "payout") {
    console.log(`Boomin CLI - payouts (Platform v1)

Usage:
  npx @boomin/cli payout list [--status pending|awaiting_account|processing|paid|failed] [--period-start YYYY-MM-DD --period-end YYYY-MM-DD]
  npx @boomin/cli payout run --period-start YYYY-MM-DD --period-end YYYY-MM-DD
  npx @boomin/cli payout export [--out payouts.csv] [--period-start YYYY-MM-DD --period-end YYYY-MM-DD] [--no-wait]
  npx @boomin/cli payout connect

Configuration — how a partner EARNS (scope: payout_rules:read|write):
  npx @boomin/cli payout rules list [--program prog_...] [--status active|paused|archived] [--type revenue_split|cpa|threshold_bonus]
  npx @boomin/cli payout rules create --name "Rev share" --type revenue_split --program prog_... --rate-bps 2000
  npx @boomin/cli payout rules create --name "Registration CPA" --type cpa --program prog_... --metric-key event_registration --per-unit-minor 500
  npx @boomin/cli payout rules show <prule_id>
  npx @boomin/cli payout rules update <prule_id> [--name "..."] [--status active|paused|archived]
  npx @boomin/cli payout rules archive <prule_id>

Configuration — how money LEAVES (scope: payout_rails:read|write):
  npx @boomin/cli payout rails list
  npx @boomin/cli payout rails create --rail csv_batch --format paypal_payouts_csv [--default] [--wallet-funded] [--columns '[{"key":"email","header":"Email Address"}]']
  npx @boomin/cli payout rails show <prail_id>
  npx @boomin/cli payout rails update <prail_id> [--config '{...}'] [--status active|disabled] [--default]

Disbursement runs (scope: payouts:read|write):
  npx @boomin/cli payout batches list
  npx @boomin/cli payout batches show <pbatch_id>
  npx @boomin/cli payout batches create [--rail csv_batch] [--period-start YYYY-MM-DD --period-end YYYY-MM-DD]
  npx @boomin/cli payout batches export <pbatch_id> [--out payouts.csv] [--no-wait]
  npx @boomin/cli payout batches confirm <pbatch_id> [--external-batch-ref PAYPAL-2026-08] [--results '[{"item":"pbi_1","status":"paid"}]'] [--no-wait]
  npx @boomin/cli payout batches cancel <pbatch_id>

run recomputes the period's payout rows and prints its outcome plus the
counters; it EXITS NON-ZERO when the brand has no active rule and no active
content split (payout_rules_required), because a configuration error must fail
a script rather than look like a month with nothing owed.

export is build + export in one call. The export itself is an Operation, so the
command polls it to a terminal status and then reads the batch for the
presigned download_url (re-minted on every read); --out writes that file, and a
failed operation exits non-zero rather than leaving an empty path behind.

A rule's economics are frozen once it exists — update takes --name/--status
only. To change money: create a replacement rule, then archive the old one.
`);
    return;
  }
  if (first === "webhook") {
    console.log(`Boomin CLI - webhook endpoints (Platform v1)

Usage:
  npx @boomin/cli webhook create --url https://your-app.com/webhooks/boomin [--events distribution.live,payout.settled] [--description "Prod"]
  npx @boomin/cli webhook list
  npx @boomin/cli webhook rotate-secret <we_id>
  npx @boomin/cli webhook delete <we_id>

The signing secret is revealed once on create and rotate-secret. Empty
--events subscribes the endpoint to all public event types.
`);
    return;
  }
  if (first === "events") {
    console.log(`Boomin CLI - events (Platform v1 operational feed)

Usage:
  npx @boomin/cli events list --type distribution.live
  npx @boomin/cli events list [--limit 50] [--starting-after <seq-or-evt_id>]

The operational domain-event feed OUT (events:read) — deliberately distinct
from performance ingestion. Ordered by seq; page with --starting-after.
`);
    return;
  }
  console.log(`Boomin CLI

Usage:
  npx @boomin/cli init [--yes] [--dry-run] [--list]
  npx @boomin/cli login [--no-open]
  npx @boomin/cli doctor [--json]
  npx @boomin/cli status [--json]
  npx @boomin/cli logout
  npx @boomin/cli scopes [--json]
  npx @boomin/cli scopes explain <scope>
  npx @boomin/cli token create --name "Agent" --scopes org:read,units:read
  npx @boomin/cli token list
  npx @boomin/cli token revoke <token_id>
  npx @boomin/cli token rotate <token_id>
  npx @boomin/cli platform smoke --read-only
  npx @boomin/cli platform smoke --write --cleanup
  npx @boomin/cli platform smoke --all-scopes --cleanup
  npx @boomin/cli handoff init --framework next --auth custom
  npx @boomin/cli referral init --framework next --auth custom
  npx @boomin/cli mcp install
  npx @boomin/cli skill install

Platform v1 (distribution infrastructure — see \`help <group>\`):
  npx @boomin/cli distribution create|list|get|validate|launch|pause|resume|cancel
  npx @boomin/cli enrollment invite|approve|reject|list|get
  npx @boomin/cli partnership list|get|pause|resume|end
  npx @boomin/cli connection list|get|revoke
  npx @boomin/cli payout list|run|export|connect
  npx @boomin/cli payout rules list|create|show|update|archive
  npx @boomin/cli payout rails list|create|show|update
  npx @boomin/cli payout batches list|show|create|export|confirm|cancel
  npx @boomin/cli webhook create|list|delete|rotate-secret
  npx @boomin/cli events list --type <event.type>

Global flags:
  -h, --help                Show help for a command.
  --json                    Print machine-readable output where supported.
  --api-base <url>          Boomin app API base.
  --platform-api-base <url> Boomin Platform API base.
  --web-base <url>          Browser login base URL.
  --connect-api-base <url>  Creator Connect API base.

Setup flags:
  --origin <url>            Add an allowed origin. Can be repeated.
  --program-id <id>         Use an existing creator program.
  --program-name <name>     Select or create a creator program by name.
  --list                    List the program on Boomin Connect discover (default: private).
  --org-id <id>             Switch to an existing organization.
  --org-name <name>         Select or create an organization by name.
  --yes                     Accept defaults for non-interactive setup.
  --dry-run                 Print intended changes without writing files.

Examples:
  npx @boomin/cli init
  npx @boomin/cli doctor --json
  npx @boomin/cli scopes explain units:create
  npx @boomin/cli token create --name "Unit Agent" --scopes org:read,units:read,units:create,units:delete
  npx @boomin/cli handoff init --framework next --auth clerk
  npx @boomin/cli referral init --framework next --auth clerk --write
  npx @boomin/cli mcp install
  npx @boomin/cli skill install
`);
}

function openUrl(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveExecutable(command), args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      stdio: options.stdio || ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else {
        const displayArgs = options.displayArgs || args;
        reject(new Error(`${command} ${displayArgs.join(" ")} failed with exit ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}

function resolveExecutable(command) {
  if (process.platform !== "win32") return command;
  if (/[\\/]/.test(command) || /\.[a-z0-9]+$/i.test(command)) return command;
  if (command === "git") return "git.exe";
  return `${command}.cmd`;
}

async function getMe(apiBase, token) {
  return request(apiBase, "/auth/me", { token });
}

async function ensureLogin(flags = {}) {
  const apiBase = appApiBase(flags);
  const config = await loadConfig();
  if (config.authToken) {
    try {
      await getMe(apiBase, config.authToken);
      return { token: config.authToken, config };
    } catch {
      if (process.env.BOOMIN_AUTH_TOKEN) throw new Error("BOOMIN_AUTH_TOKEN is invalid.");
    }
  }
  return login(flags);
}

async function login(flags = {}) {
  const apiBase = appApiBase(flags);
  const base = webBase(flags);
  const session = await request(apiBase, "/cli/sessions", {
    method: "POST",
    body: {
      metadata: {
        source: "boomin_cli",
        cwd: process.cwd(),
        platform: process.platform,
      },
    },
  });

  const sessionId = session.sessionId || session.session_id;
  const pollToken = session.pollToken || session.poll_token;
  const userCode = session.userCode || session.user_code;
  const verificationUrl = `${base}/cli/login?code=${encodeURIComponent(userCode)}`;

  if (flags.json) printJson({ verificationUrl, userCode, sessionId, status: "pending" });
  else console.log(`Approve Boomin CLI login: ${verificationUrl}`);

  if (!flags.noOpen) {
    try {
      openUrl(verificationUrl);
    } catch {
      if (!flags.json) console.log("Could not open a browser automatically. Open the URL above.");
    }
  }

  const timeoutSeconds = Number(flags.timeout || 600);
  const pollIntervalMs = Number(flags.pollInterval || 2) * 1000;
  const started = Date.now();

  while (Date.now() - started < timeoutSeconds * 1000) {
    const statusResponse = await request(apiBase, `/cli/sessions/${encodeURIComponent(sessionId)}`, {
      params: { poll_token: pollToken },
    });
    if (statusResponse.status === "approved") {
      const claimed = await request(apiBase, `/cli/sessions/${encodeURIComponent(sessionId)}/claim`, {
        method: "POST",
        body: { poll_token: pollToken },
      });
      const nextConfig = {
        ...(await loadConfig()),
        apiBase,
        webBase: base,
        authToken: claimed.auth_token,
        loggedInAt: new Date().toISOString(),
      };
      await saveConfig(nextConfig);
      if (flags.json) printJson({ status: "approved" });
      else console.log("Boomin CLI login approved.");
      return { token: claimed.auth_token, config: nextConfig };
    }
    if (statusResponse.status === "expired" || statusResponse.status === "claimed") {
      throw new Error(`CLI login session is ${statusResponse.status}. Start again with npx @boomin/cli login.`);
    }
    if (!flags.json) process.stdout.write(".");
    await sleep(pollIntervalMs);
  }

  throw new Error("Timed out waiting for browser approval.");
}

async function status(flags = {}) {
  const apiBase = appApiBase(flags);
  const config = await loadConfig();
  if (!config.authToken) {
    const result = { loggedIn: false, message: "Not logged in. Run: npx @boomin/cli login" };
    if (flags.json) printJson(result);
    else console.log(result.message);
    return;
  }
  const me = await getMe(apiBase, config.authToken);
  const result = {
    loggedIn: true,
    email: me.user?.email || "unknown",
    org: me.org || null,
    defaultProgramId: config.defaultProgramId || null,
    hasSavedPlatformToken: Boolean(config.platformToken),
  };
  if (flags.json) printJson(result);
  else {
    console.log(`Logged in as ${result.email}`);
    console.log(`Active org: ${result.org?.name || "unknown"} (${result.org?.slug || result.org?.id || "unknown"})`);
    if (result.defaultProgramId) console.log(`Default program: ${result.defaultProgramId}`);
    if (result.hasSavedPlatformToken) console.log("Saved platform token: yes");
  }
}

function isInteractive(flags) {
  return Boolean(input.isTTY && output.isTTY && !flags.yes);
}

async function promptChoice(label, items, render, rl) {
  console.log(label);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${render(item)}`));
  const answer = await rl.question("Choose a number: ");
  const index = Number(answer.trim()) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error("Invalid selection.");
  return items[index];
}

async function selectOrg(apiBase, token, flags, rl) {
  const me = await getMe(apiBase, token);
  const list = await request(apiBase, "/orgs", { token });
  const orgs = (Array.isArray(list.orgs) ? list.orgs : []).map((item) => item.org || item);

  if (flags.orgId) {
    const selected = orgs.find((item) => String(item.id) === String(flags.orgId));
    if (!selected) throw new Error(`You do not belong to org ${flags.orgId}.`);
    return selected;
  }

  if (flags.orgName) {
    const selected = orgs.find((item) => String(item.name || "").toLowerCase() === String(flags.orgName).toLowerCase());
    if (selected) return selected;
    const created = await request(apiBase, "/orgs", { method: "POST", token, body: { name: flags.orgName, brandName: flags.brandName } });
    return created.org;
  }

  const current = orgs[0] || me.orgs?.[0] || me.org;
  if (!isInteractive(flags)) {
    if (current) return current;
    const defaultOrgName = flags.orgName || "My Organization";
    const created = await request(apiBase, "/orgs", {
      method: "POST",
      token,
      body: { name: defaultOrgName, brandName: flags.brandName || defaultOrgName },
    });
    return created.org;
  }

  const choices = [...orgs.map((org) => ({ type: "existing", org })), { type: "create" }];
  const choice = await promptChoice("Choose a Boomin organization:", choices, (item) => (item.type === "create" ? "Create a new organization" : item.org.name), rl);
  if (choice.type === "create") {
    const name = await rl.question("Organization name: ");
    const created = await request(apiBase, "/orgs", { method: "POST", token, body: { name: name.trim() } });
    return created.org;
  }
  return choice.org;
}

async function selectBrand(apiBase, token, org, flags, rl) {
  const brandsResponse = await request(apiBase, "/brands", { token });
  const brands = Array.isArray(brandsResponse.brands)
    ? brandsResponse.brands.filter((brand) => String(brand.orgId || brand.org_id) === String(org.id))
    : [];

  if (flags.brandId) {
    const selected = brands.find((brand) => String(brand.id) === String(flags.brandId));
    if (!selected) throw new Error(`Brand ${flags.brandId} was not found in ${org.name}.`);
    return selected;
  }

  if (flags.brandName) {
    const selected = brands.find((brand) => String(brand.name || "").toLowerCase() === String(flags.brandName).toLowerCase());
    if (selected) return selected;
    const created = await request(apiBase, "/brands", { method: "POST", token, body: { orgId: org.id, name: flags.brandName } });
    return created.brand;
  }

  if (!isInteractive(flags) && brands.length > 0) return brands[0];

  if (isInteractive(flags) && brands.length > 0) {
    const choices = [...brands.map((brand) => ({ type: "existing", brand })), { type: "create" }];
    const choice = await promptChoice("Choose a Boomin brand:", choices, (item) => (item.type === "create" ? "Create a new brand" : item.brand.name), rl);
    if (choice.type === "existing") return choice.brand;
  }

  const defaultName = org.name || "Demo Brand";
  const brandName = isInteractive(flags) ? (await rl.question(`Brand name (${defaultName}): `)).trim() || defaultName : defaultName;
  const created = await request(apiBase, "/brands", { method: "POST", token, body: { orgId: org.id, name: brandName } });
  return created.brand;
}

async function selectProgram(apiBase, token, org, brand, flags, rl) {
  const programsResponse = await request(apiBase, `/brands/${encodeURIComponent(brand.id)}/programs`, { token });
  const programs = Array.isArray(programsResponse.programs) ? programsResponse.programs : [];

  if (flags.programId) {
    const selected = programs.find((program) => String(program.id) === String(flags.programId));
    if (!selected) throw new Error(`Program ${flags.programId} was not found in ${brand.name}.`);
    return ensureProgramListing(apiBase, token, selected, flags);
  }

  if (flags.programName) {
    const selected = programs.find((program) => String(program.name || "").toLowerCase() === String(flags.programName).toLowerCase());
    if (selected) return ensureProgramListing(apiBase, token, selected, flags);
    const created = await request(apiBase, `/brands/${encodeURIComponent(brand.id)}/programs`, {
      method: "POST",
      token,
      body: { name: flags.programName, type: "performance", description: "Partner Connect program", visibility: await resolveProgramVisibility(flags, rl) },
    });
    return created.program;
  }

  if (!isInteractive(flags) && programs.length > 0) return ensureProgramListing(apiBase, token, programs[0], flags);

  if (isInteractive(flags) && programs.length > 0) {
    const choices = [...programs.map((program) => ({ type: "existing", program })), { type: "create" }];
    const choice = await promptChoice("Choose a partner program:", choices, (item) => (item.type === "create" ? "Create a new partner program" : item.program.name), rl);
    if (choice.type === "existing") return ensureProgramListing(apiBase, token, choice.program, flags);
  }

  const defaultName = `${brand.name || org.name || "Boomin"} Partner Program`;
  const programName = isInteractive(flags) ? (await rl.question(`Program name (${defaultName}): `)).trim() || defaultName : defaultName;
  const created = await request(apiBase, `/brands/${encodeURIComponent(brand.id)}/programs`, {
    method: "POST",
    token,
    body: { name: programName, type: "performance", description: "Partner Connect program", visibility: await resolveProgramVisibility(flags, rl) },
  });
  return created.program;
}

// Connect/Discover listing. Default is PRIVATE: only --list (or an explicit
// interactive yes at creation time) opts a program into the public feed.
async function resolveProgramVisibility(flags, rl) {
  if (flags.list) return "listed";
  if (!rl) return "private";
  const answer = (await rl.question("List this campaign on Boomin Connect discover? (y/N): ")).trim().toLowerCase();
  return answer === "y" || answer === "yes" ? "listed" : "private";
}

// --list on an EXISTING program flips it to listed via the update path.
// Without the flag we never touch an existing program's visibility here —
// the interactive prompt only runs when a program is being created.
async function ensureProgramListing(apiBase, token, program, flags) {
  if (!flags.list || program.visibility === "listed") return program;
  const updated = await request(apiBase, `/programs/${encodeURIComponent(program.id)}`, {
    method: "PATCH",
    token,
    body: { visibility: "listed" },
  });
  return updated.program || program;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [];
}

async function detectOrigins(flags) {
  const origins = new Set(["http://localhost:5173", "http://localhost:4173"]);
  for (const origin of flags.origins || []) origins.add(origin);
  const pkg = await readJson(path.join(process.cwd(), "package.json"), null);
  const scripts = pkg?.scripts ? Object.values(pkg.scripts).map(String) : [];
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (scripts.some((script) => script.includes("vite"))) {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:4173");
  }
  if (deps.next || scripts.some((script) => /(^|[^a-z])next($|[^a-z])/.test(script))) {
    origins.add("http://localhost:3000");
  }
  return [...origins];
}

/**
 * The app's primary origin: an explicit --origin wins, then the Next.js dev
 * origin when the project is a Next app, then the first detected origin.
 */
async function primaryAppOrigin(flags) {
  if (flags.origins && flags.origins.length) return stripTrailingSlash(flags.origins[0]);
  const origins = await detectOrigins(flags);
  const nextOrigin = origins.find((origin) => origin.endsWith(":3000"));
  return stripTrailingSlash(nextOrigin || origins[0]);
}

async function upsertEnvLocal(values, dryRun) {
  const envPath = path.join(process.cwd(), ".env.local");
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf8");
  } catch {
    content = "";
  }

  const lines = content.split(/\r?\n/).filter((line, index, array) => index < array.length - 1 || line.length > 0);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !ENV_KEYS.includes(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });
  for (const key of ENV_KEYS) {
    if (!seen.has(key)) nextLines.push(`${key}=${values[key]}`);
  }
  const nextContent = `${nextLines.join("\n")}\n`;
  if (!dryRun) await fs.writeFile(envPath, nextContent);
  return { envPath, content: nextContent };
}

async function upsertEnvFile(updates, options = {}) {
  const envPath = path.join(process.cwd(), ".env.local");
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf8");
  } catch {
    content = "";
  }
  const lines = content.length ? content.split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const keys = Object.keys(updates);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && keys.includes(match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });
  for (const key of keys) {
    if (!seen.has(key)) nextLines.push(`${key}=${updates[key]}`);
  }
  const nextContent = `${nextLines.join("\n")}\n`;
  if (!options.dryRun) await fs.writeFile(envPath, nextContent);
  return { envPath, content: nextContent };
}

async function detectFramework() {
  const pkg = await readJson(path.join(process.cwd(), "package.json"), null);
  if (!pkg) return "unknown";
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts ? Object.values(pkg.scripts).map(String) : [];
  if (deps.next || scripts.some((script) => /(^|[^a-z])next($|[^a-z])/.test(script))) return "next";
  if (deps.vite || scripts.some((script) => script.includes("vite"))) return "vite";
  return "unknown";
}

function printReactSnippet(framework = "vite") {
  if (framework === "next") {
    console.log(`
Next.js next steps:

  npx @boomin/cli referral init --framework next --auth custom --write
  npx @boomin/cli handoff provision
  npx @boomin/cli doctor

The scaffolded route handlers read process.env.BOOMIN_CONNECT_* and
process.env.BOOMIN_HANDOFF_* from .env.local (written above). For a browser
component, use NEXT_PUBLIC_BOOMIN_* values instead.
`);
    return;
  }
  console.log(`
React example:

import Boomin from "@boomin/connect";

Boomin.init({
  publicKey: import.meta.env.VITE_BOOMIN_PUBLIC_KEY,
  programId: import.meta.env.VITE_BOOMIN_PROGRAM_ID,
  apiBase: import.meta.env.VITE_BOOMIN_API_BASE,
  redirectUri: window.location.origin + window.location.pathname,
});

await Boomin.connectInstagram({ requireCreator: true });
`);
}

function countChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary.total += 1;
      summary[check.status] = (summary[check.status] || 0) + 1;
      return summary;
    },
    { total: 0, pass: 0, warn: 0, fail: 0, skip: 0 },
  );
}

function doctorCheck(checks, status, id, label, message, options = {}) {
  const check = removeEmpty({
    id,
    label,
    status,
    message,
    fix: options.fix,
    details: options.details,
  });
  checks.push(check);
  return check;
}

function envValue(envFile, key) {
  return envFile.values[key] || process.env[key] || "";
}

function valuesIncludeAll(values, expected) {
  const set = new Set(Array.isArray(values) ? values.map(String) : []);
  return expected.filter((value) => !set.has(String(value)));
}

function formatDoctorStatus(status) {
  return status.toUpperCase().padEnd(4);
}

function printDoctorResult(result) {
  console.log("Boomin Doctor");
  console.log("");
  for (const check of result.checks) {
    console.log(`${formatDoctorStatus(check.status)} ${check.label}: ${check.message}`);
    if (check.fix) console.log(`     fix: ${check.fix}`);
  }
  if (result.nextSteps.length) {
    console.log("");
    console.log("Next steps:");
    for (const step of result.nextSteps) console.log(`- ${step}`);
  }
  console.log("");
  console.log(`Summary: ${result.summary.pass} pass, ${result.summary.warn} warn, ${result.summary.fail} fail, ${result.summary.skip} skip`);
}

function skillTargets() {
  return [
    {
      id: "claude",
      name: "Claude Code",
      skillsDir: path.join(os.homedir(), ".claude", "skills"),
      skillPath: path.join(os.homedir(), ".claude", "skills", BOOMIN_SKILL_NAME),
    },
    {
      id: "codex",
      name: "Codex",
      skillsDir: path.join(os.homedir(), ".codex", "skills"),
      skillPath: path.join(os.homedir(), ".codex", "skills", BOOMIN_SKILL_NAME),
    },
  ];
}

function normalizeSkillTargets(flags = {}) {
  const raw = String(flags.target || "all").toLowerCase();
  const requested = raw === "all" ? ["claude", "codex"] : raw.split(",").map((item) => item.trim()).filter(Boolean);
  const valid = new Set(["claude", "codex"]);
  const invalid = requested.filter((item) => !valid.has(item));
  if (invalid.length) throw new Error(`Invalid skill install target: ${invalid.join(", ")}. Use all, claude, or codex.`);
  return [...new Set(requested)];
}

async function getSkillInstallStatus() {
  const targets = [];
  for (const target of skillTargets()) {
    const skillFile = path.join(target.skillPath, "SKILL.md");
    const exists = await fs.stat(skillFile).then((stat) => stat.isFile()).catch(() => false);
    targets.push({
      id: target.id,
      name: target.name,
      installed: exists,
      path: target.skillPath,
    });
  }
  return { skill: BOOMIN_SKILL_NAME, targets };
}

async function findSkillSource(source) {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) return null;
  const direct = path.join(source, "SKILL.md");
  const nested = path.join(source, BOOMIN_SKILL_NAME, "SKILL.md");
  if (await fs.stat(direct).then((item) => item.isFile()).catch(() => false)) return source;
  if (await fs.stat(nested).then((item) => item.isFile()).catch(() => false)) return path.join(source, BOOMIN_SKILL_NAME);
  return null;
}

async function prepareSkillSource(flags = {}) {
  const source = flags.source || BOOMIN_SKILLS_REPO;
  const localSource = await findSkillSource(path.resolve(process.cwd(), source)).catch(() => null);
  if (localSource) return { sourcePath: localSource, cleanup: async () => {}, source };

  if (/^[a-z]+:\/\//i.test(source) || source.endsWith(".git")) {
    const tempRoot = path.join(os.tmpdir(), `boomin-skills-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await runCli("git", ["clone", "--depth", "1", source, tempRoot], {
      displayArgs: ["clone", "--depth", "1", source, "<temp>"],
    });
    const sourcePath = await findSkillSource(tempRoot);
    if (!sourcePath) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      throw new Error(`Could not find ${BOOMIN_SKILL_NAME} in ${source}.`);
    }
    return { sourcePath, cleanup: async () => fs.rm(tempRoot, { recursive: true, force: true }), source };
  }

  throw new Error(`Skill source was not found: ${source}`);
}

async function installSkill(flags = {}) {
  const targetIds = normalizeSkillTargets(flags);
  const targets = skillTargets().filter((target) => targetIds.includes(target.id));

  if (flags.dryRun) {
    const result = {
      ok: true,
      dryRun: true,
      skill: BOOMIN_SKILL_NAME,
      source: flags.source || BOOMIN_SKILLS_REPO,
      targets: targets.map((target) => ({ id: target.id, name: target.name, path: target.skillPath })),
    };
    if (flags.json) printJson(result);
    else {
      console.log("Boomin skill install dry run.");
      for (const target of result.targets) console.log(`- ${target.name}: ${target.path}`);
    }
    return result;
  }

  const prepared = await prepareSkillSource(flags);
  const installed = [];
  try {
    for (const target of targets) {
      const exists = await fs.stat(target.skillPath).then(() => true).catch(() => false);
      if (exists && !flags.yes) {
        throw new Error(`${target.name} already has ${BOOMIN_SKILL_NAME}. Re-run with --yes to replace it.`);
      }
      await fs.mkdir(target.skillsDir, { recursive: true });
      await fs.rm(target.skillPath, { recursive: true, force: true });
      await fs.cp(prepared.sourcePath, target.skillPath, { recursive: true });
      installed.push({ id: target.id, name: target.name, path: target.skillPath });
    }
  } finally {
    await prepared.cleanup();
  }

  const result = {
    ok: true,
    skill: BOOMIN_SKILL_NAME,
    source: prepared.source,
    installed,
    nextStep: "Restart Claude Code or Codex so the new skill metadata is loaded.",
  };

  if (flags.json) printJson(result);
  else {
    console.log(`Installed ${BOOMIN_SKILL_NAME}.`);
    for (const target of installed) console.log(`- ${target.name}: ${target.path}`);
    console.log("Restart Claude Code or Codex so the skill loads.");
  }
  return result;
}

async function doctor(flags = {}) {
  const checks = [];
  const nextSteps = [];
  const apiBase = appApiBase(flags);
  const executeApiBase = platformApiBase(flags);
  const config = await loadConfig();
  const envPath = path.join(process.cwd(), ".env.local");
  const envFile = await readEnvFile(envPath);
  const detectedOrigins = await detectOrigins(flags);

  const pkg = await readJson(path.join(process.cwd(), "package.json"), null);
  if (typeof fetch === "function" && pkg !== null) {
    doctorCheck(checks, "pass", "runtime", "Runtime", `Node ${process.version}; package.json readable.`);
  } else if (typeof fetch !== "function") {
    doctorCheck(checks, "fail", "runtime", "Runtime", "This Node runtime does not provide global fetch.", { fix: "Use Node 18 or newer." });
  } else {
    doctorCheck(checks, "warn", "runtime", "Runtime", "No package.json was found in this directory.", { fix: "Run doctor from your app project root." });
  }

  try {
    const health = await request(apiRootFromAppBase(apiBase), "/health");
    const missingEnv = Object.entries(health.env || {}).filter(([, ok]) => !ok).map(([key]) => key);
    if (health.ok && missingEnv.length === 0) {
      doctorCheck(checks, "pass", "api_health", "API health", "Boomin API is reachable and configured.");
    } else if (health.ok) {
      doctorCheck(checks, "warn", "api_health", "API health", `Boomin API is reachable, but reports missing env: ${missingEnv.join(", ")}.`);
    } else {
      doctorCheck(checks, "fail", "api_health", "API health", "Boomin API returned an unhealthy response.");
    }
  } catch (error) {
    doctorCheck(checks, "fail", "api_health", "API health", error.message, { fix: "Check --api-base or try again when api.boomin.ai is reachable." });
  }

  let me = null;
  const authToken = config.authToken || process.env.BOOMIN_AUTH_TOKEN;
  if (!authToken) {
    doctorCheck(checks, "fail", "auth", "Auth", "No saved Boomin login was found.", { fix: "npx @boomin/cli login" });
    nextSteps.push("Log in with `npx @boomin/cli login`.");
  } else {
    try {
      me = await getMe(apiBase, authToken);
      doctorCheck(checks, "pass", "auth", "Auth", `Logged in as ${me.user?.email || "unknown"}.`, {
        details: { orgCount: Array.isArray(me.orgs) ? me.orgs.length : undefined, brandCount: Array.isArray(me.brands) ? me.brands.length : undefined },
      });
    } catch (error) {
      doctorCheck(checks, "fail", "auth", "Auth", "Saved Boomin login is invalid or expired.", { fix: "npx @boomin/cli login", details: { error: error.message } });
      nextSteps.push("Refresh local auth with `npx @boomin/cli login`.");
    }
  }

  const requiredEnv = ["VITE_BOOMIN_PUBLIC_KEY", "VITE_BOOMIN_PROGRAM_ID", "VITE_BOOMIN_API_BASE"];
  const missingEnvKeys = requiredEnv.filter((key) => !envFile.values[key]);
  if (!envFile.exists) {
    doctorCheck(checks, "fail", "project_env", "Project env", ".env.local was not found.", { fix: "npx @boomin/cli init" });
    nextSteps.push("Create project config with `npx @boomin/cli init`.");
  } else if (missingEnvKeys.length) {
    doctorCheck(checks, "fail", "project_env", "Project env", `.env.local is missing: ${missingEnvKeys.join(", ")}.`, { fix: "npx @boomin/cli init" });
  } else {
    doctorCheck(checks, "pass", "project_env", "Project env", ".env.local contains Boomin browser config.", {
      details: { envPath },
    });
  }

  const publicKey = envValue(envFile, "VITE_BOOMIN_PUBLIC_KEY") || config.defaultPublicKey;
  const programId = envValue(envFile, "VITE_BOOMIN_PROGRAM_ID") || config.defaultProgramId;
  const connectBase = stripTrailingSlash(envValue(envFile, "VITE_BOOMIN_API_BASE") || connectApiBase(flags));
  let publicConnectConfig = null;
  if (!publicKey || !programId) {
    doctorCheck(checks, "skip", "connect_config", "Connect config", "Public key or program id is missing.", { fix: "npx @boomin/cli init" });
  } else {
    try {
      const url = new URL(`${connectBase}/config`);
      url.searchParams.set("publicKey", publicKey);
      url.searchParams.set("programId", programId);
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(data.message || response.statusText, { status: response.status, code: data.code || data.error, response: data });
      publicConnectConfig = data;
      doctorCheck(checks, "pass", "connect_config", "Connect config", `${data.brandName || "Brand"} / ${data.programName || programId} resolved.`, {
        details: { requiredChannels: data.requiredChannels || [], oauth: data.oauth || {} },
      });
    } catch (error) {
      doctorCheck(checks, "fail", "connect_config", "Connect config", error.message, { fix: "Confirm VITE_BOOMIN_PUBLIC_KEY and VITE_BOOMIN_PROGRAM_ID, then run `npx @boomin/cli init`." });
    }
  }

  let adminConnectConfig = null;
  if (!me || !authToken || !programId) {
    doctorCheck(checks, "skip", "admin_config", "Admin config", "Skipped because login or program id is missing.", { fix: "npx @boomin/cli login && npx @boomin/cli init" });
  } else {
    try {
      const response = await request(apiBase, `/programs/${encodeURIComponent(programId)}/connect-config`, { token: authToken });
      adminConnectConfig = response.config;
      const allowedOriginMissing = valuesIncludeAll(adminConnectConfig.allowed_origins || adminConnectConfig.allowedOrigins, detectedOrigins);
      const allowedRedirectMissing = valuesIncludeAll(adminConnectConfig.allowed_redirect_origins || adminConnectConfig.allowedRedirectOrigins, detectedOrigins);
      if (allowedOriginMissing.length || allowedRedirectMissing.length) {
        doctorCheck(checks, "warn", "admin_config", "Admin config", "Connect config is missing one or more local origins.", {
          fix: `npx @boomin/cli init ${detectedOrigins.map((origin) => `--origin ${origin}`).join(" ")}`,
          details: { missingAllowedOrigins: allowedOriginMissing, missingRedirectOrigins: allowedRedirectMissing },
        });
      } else {
        doctorCheck(checks, "pass", "admin_config", "Admin config", "Allowed origins and redirect origins include this project.");
      }
    } catch (error) {
      doctorCheck(checks, "fail", "admin_config", "Admin config", error.message, { fix: "Make sure your logged-in user is an org or brand admin for this program." });
    }
  }

  const handoffSecret = envValue(envFile, "BOOMIN_HANDOFF_SIGNING_SECRET");
  const handoffIssuer = envValue(envFile, "BOOMIN_HANDOFF_ISSUER");
  let handoffReady = false;
  if (!handoffSecret && !handoffIssuer) {
    doctorCheck(checks, "skip", "handoff_config", "Handoff config", "No handoff env vars found; signed handoff is optional.", { fix: "npx @boomin/cli handoff provision" });
  } else if (!authToken || !programId) {
    doctorCheck(checks, "skip", "handoff_config", "Handoff config", "Skipped because login or program id is missing.", { fix: "npx @boomin/cli login" });
  } else {
    try {
      const route = handoffIssuer
        ? `/programs/${encodeURIComponent(programId)}/handoff-config?issuer=${encodeURIComponent(handoffIssuer)}`
        : `/programs/${encodeURIComponent(programId)}/handoff-config`;
      const response = await request(apiBase, route, { token: authToken });
      const handoffConfig = response.config || (Array.isArray(response.configs) ? response.configs[0] : null);
      if (!handoffConfig) {
        doctorCheck(checks, "fail", "handoff_config", "Handoff config", "No matching handoff config was found.", { fix: "npx @boomin/cli handoff provision" });
      } else if (handoffSecret && handoffConfig.secretPrefix && !handoffSecret.startsWith(handoffConfig.secretPrefix)) {
        doctorCheck(checks, "fail", "handoff_config", "Handoff config", "Local handoff signing secret does not match the active Boomin config.", { fix: "npx @boomin/cli handoff provision --rotate" });
      } else {
        doctorCheck(checks, "pass", "handoff_config", "Handoff config", `Active handoff config found for issuer ${handoffConfig.issuer || handoffIssuer || "unknown"}.`);
        handoffReady = true;
      }
    } catch (error) {
      doctorCheck(checks, "fail", "handoff_config", "Handoff config", error.message, { fix: "npx @boomin/cli handoff provision" });
    }
  }

  const referralRoutes = [
    "app/api/boomin/partner/join/route.js",
    "app/api/boomin/partner/status/route.js",
    "app/r/[code]/route.js",
    "app/partner/page.jsx",
  ];
  const missingReferralRoutes = [];
  for (const route of referralRoutes) {
    const exists = await fs.stat(path.join(process.cwd(), route)).then(() => true).catch(() => false);
    if (!exists) missingReferralRoutes.push(route);
  }
  const referralBaseUrl = adminConnectConfig?.metadata?.referralBaseUrl || adminConnectConfig?.metadata?.referral_base_url;
  const referralDestination = envValue(envFile, "BOOMIN_REFERRAL_DESTINATION_URL");
  if (!handoffReady) {
    doctorCheck(checks, "skip", "referral_readiness", "Referral readiness", "Skipped until signed handoff is configured.", { fix: "npx @boomin/cli handoff provision, then npx @boomin/cli referral init --framework next --auth custom --write" });
  } else if (missingReferralRoutes.length || !referralBaseUrl || !referralDestination) {
    const missing = [
      ...missingReferralRoutes,
      !referralBaseUrl ? "program metadata referralBaseUrl" : null,
      !referralDestination ? "BOOMIN_REFERRAL_DESTINATION_URL" : null,
    ].filter(Boolean);
    doctorCheck(checks, "warn", "referral_readiness", "Referral readiness", `Referral-first setup is incomplete: ${missing.join(", ")}.`, {
      fix: "npx @boomin/cli referral init --framework next --auth custom --write",
    });
  } else {
    doctorCheck(checks, "pass", "referral_readiness", "Referral readiness", "Referral page, redirect route, handoff, and destination URL are configured.");
  }

  const skillStatus = await getSkillInstallStatus();
  const missingSkillTargets = skillStatus.targets.filter((target) => !target.installed);
  if (missingSkillTargets.length === 0) {
    doctorCheck(checks, "pass", "agent_skill", "Agent skill", "Boomin skill is installed for Claude Code and Codex.", {
      details: { targets: skillStatus.targets },
    });
  } else if (missingSkillTargets.length === skillStatus.targets.length) {
    doctorCheck(checks, "warn", "agent_skill", "Agent skill", "Boomin skill is not installed for Claude Code or Codex.", {
      fix: "npx @boomin/cli skill install",
      details: { targets: skillStatus.targets },
    });
    nextSteps.push("Install the Boomin agent skill with `npx @boomin/cli skill install`.");
  } else {
    doctorCheck(checks, "warn", "agent_skill", "Agent skill", `Boomin skill is missing for: ${missingSkillTargets.map((target) => target.name).join(", ")}.`, {
      fix: `npx @boomin/cli skill install --target ${missingSkillTargets.map((target) => target.id).join(",")}`,
      details: { targets: skillStatus.targets },
    });
  }

  const platformToken = config.platformToken || process.env.BOOMIN_PLATFORM_TOKEN;
  let platformScopes = null;
  if (!platformToken) {
    doctorCheck(checks, "warn", "platform_token", "Platform token", "No platform token configured; server/agent Platform API smoke is skipped.", {
      fix: "npx @boomin/cli token create --name \"Agent\" --scopes org:read,units:read --save",
    });
  } else {
    try {
      const smoke = await request(executeApiBase, "/smoke", {
        method: "POST",
        platformToken,
        body: { token: platformToken },
      });
      platformScopes = Array.isArray(smoke.scopes) ? smoke.scopes.map(String) : [];
      doctorCheck(checks, "pass", "platform_token", "Platform token", "Read-only platform smoke succeeded.", {
        details: { org: smoke.org, scopes: smoke.scopes },
      });
    } catch (error) {
      const isMissingPlatformApi = error instanceof ApiError && error.status === 404;
      doctorCheck(checks, "fail", "platform_token", "Platform token", isMissingPlatformApi ? "Platform API smoke endpoint is not reachable." : error.message, {
        fix: isMissingPlatformApi
          ? "Check --platform-api-base or verify the Platform API is deployed."
          : "Create a fresh token with `npx @boomin/cli token create --name \"Agent\" --scopes org:read,units:read --save`.",
      });
    }
  }

  // ── Platform v1 surface (CLI 0.3.0) ─────────────────────────────────────────
  const v1Get = async (route) => {
    const response = await fetch(`${executeApiBase}${route}`, {
      headers: { Authorization: `Bearer ${platformToken}`, Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
  const v1ErrorCode = (result) => result?.data?.error?.code || null;

  // v1 reachability: an unauthenticated probe must answer with the typed
  // auth-first envelope (401 {error:{code:'platform_token_required'}}).
  try {
    const probe = await fetch(`${executeApiBase}/distributions`);
    const probeBody = await probe.json().catch(() => null);
    if (probe.status === 401 && probeBody?.error?.code === "platform_token_required") {
      doctorCheck(checks, "pass", "platform_v1", "Platform v1 API", "v1 REST tree is reachable (auth-first envelope confirmed).");
    } else if (probe.ok) {
      doctorCheck(checks, "pass", "platform_v1", "Platform v1 API", "v1 REST tree is reachable.");
    } else {
      doctorCheck(checks, "fail", "platform_v1", "Platform v1 API", `Unexpected v1 response: HTTP ${probe.status}.`, {
        fix: "Check --platform-api-base or verify the v1 Platform API is deployed.",
        details: { status: probe.status, body: probeBody },
      });
    }
  } catch (error) {
    doctorCheck(checks, "fail", "platform_v1", "Platform v1 API", error.message, {
      fix: "Check --platform-api-base or try again when the Platform API is reachable.",
    });
  }

  // Launch readiness: token must carry the distribution scopes
  // (operations:read is default-granted server-side).
  if (!platformScopes) {
    doctorCheck(checks, "skip", "launch_readiness", "Launch readiness", "Skipped because no valid platform token is configured.", {
      fix: "npx @boomin/cli token create --name \"Launcher\" --scopes org:read,distributions:read,distributions:write,distributions:launch --save",
    });
  } else {
    const requiredLaunchScopes = ["distributions:read", "distributions:write", "distributions:launch"];
    const missingLaunchScopes = requiredLaunchScopes.filter((scope) => !platformScopes.includes(scope));
    if (missingLaunchScopes.length === 0) {
      doctorCheck(checks, "pass", "launch_readiness", "Launch readiness", "Token can create, validate, and launch distributions.");
    } else {
      doctorCheck(checks, "warn", "launch_readiness", "Launch readiness", `Token is missing: ${missingLaunchScopes.join(", ")}.`, {
        fix: `npx @boomin/cli token create --name "Launcher" --scopes org:read,${requiredLaunchScopes.join(",")} --save`,
        details: { missing: missingLaunchScopes },
      });
    }
  }

  // Webhook endpoint presence: launches emit domain events nobody hears
  // without at least one enabled endpoint.
  if (!platformToken) {
    doctorCheck(checks, "skip", "webhook_endpoints", "Webhook endpoints", "Skipped because no platform token is configured.");
  } else {
    const endpoints = await v1Get("/webhook_endpoints?limit=1").catch((error) => ({ status: 0, data: null, error }));
    if (endpoints.status === 200 && Array.isArray(endpoints.data?.data)) {
      if (endpoints.data.data.length > 0) {
        doctorCheck(checks, "pass", "webhook_endpoints", "Webhook endpoints", "At least one webhook endpoint is configured.");
      } else {
        doctorCheck(checks, "warn", "webhook_endpoints", "Webhook endpoints", "No webhook endpoints are configured; platform events will not be delivered.", {
          fix: "npx @boomin/cli webhook create --url https://your-app.com/webhooks/boomin",
        });
      }
    } else if (v1ErrorCode(endpoints) === "missing_scope") {
      doctorCheck(checks, "skip", "webhook_endpoints", "Webhook endpoints", "Token lacks webhooks:read; endpoint presence not checked.", {
        fix: "Add webhooks:read,webhooks:write to the token scopes.",
      });
    } else {
      doctorCheck(checks, "fail", "webhook_endpoints", "Webhook endpoints", `Could not list webhook endpoints (HTTP ${endpoints.status}${v1ErrorCode(endpoints) ? `, ${v1ErrorCode(endpoints)}` : ""}).`);
    }
  }

  // Wallet / billing readiness: payout rails + Stripe Connect rollup — can
  // value actually leave the platform once distributions perform?
  if (!platformToken) {
    doctorCheck(checks, "skip", "billing_readiness", "Wallet/billing readiness", "Skipped because no platform token is configured.");
  } else {
    const connect = await v1Get("/payouts/connect_status").catch((error) => ({ status: 0, data: null, error }));
    if (connect.status === 200 && connect.data) {
      const rails = Array.isArray(connect.data.rails) ? connect.data.rails : [];
      const stripeConfigured = Boolean(connect.data.stripe?.configured);
      if (rails.length > 0 || stripeConfigured) {
        doctorCheck(checks, "pass", "billing_readiness", "Wallet/billing readiness", `Disbursement ready: ${rails.length} payout rail(s)${stripeConfigured ? ", Stripe configured" : ""}.`, {
          details: { rails: rails.length, stripeConfigured, partnerAccounts: connect.data.stripe?.partner_accounts },
        });
      } else {
        doctorCheck(checks, "warn", "billing_readiness", "Wallet/billing readiness", "No payout rails configured and Stripe is not configured; partner payouts cannot disburse.", {
          fix: "Configure a payout rail (csv_batch or stripe_connect) in the Boomin console, or run `npx @boomin/cli payout connect` to inspect.",
        });
      }
    } else if (v1ErrorCode(connect) === "missing_scope") {
      doctorCheck(checks, "skip", "billing_readiness", "Wallet/billing readiness", "Token lacks payouts:read; disbursement readiness not checked.", {
        fix: "Add payouts:read to the token scopes.",
      });
    } else {
      doctorCheck(checks, "fail", "billing_readiness", "Wallet/billing readiness", `Could not read payout connect status (HTTP ${connect.status}${v1ErrorCode(connect) ? `, ${v1ErrorCode(connect)}` : ""}).`);
    }
  }

  const summary = countChecks(checks);
  const strict = Boolean(flags.strict);
  const ok = summary.fail === 0 && (!strict || (summary.warn === 0 && summary.skip === 0));
  const result = { ok, strict, summary, checks, nextSteps: [...new Set(nextSteps)] };
  if (flags.json) printJson(result);
  else printDoctorResult(result);
  if (!ok) process.exitCode = 1;
  return result;
}

async function init(flags = {}) {
  const apiBase = appApiBase(flags);
  const { token } = await ensureLogin(flags);
  const rl = isInteractive(flags) ? createInterface({ input, output }) : null;
  try {
    const org = await selectOrg(apiBase, token, flags, rl);
    const brand = await selectBrand(apiBase, token, org, flags, rl);
    const program = await selectProgram(apiBase, token, org, brand, flags, rl);
    const currentConfigResponse = await request(apiBase, `/programs/${encodeURIComponent(program.id)}/connect-config`, {
      token,
    });
    const currentConfig = currentConfigResponse.config || {};
    const origins = await detectOrigins(flags);
    const allowedOrigins = [...new Set([...toArray(currentConfig.allowed_origins || currentConfig.allowedOrigins), ...origins])];
    const allowedRedirectOrigins = [...new Set([...toArray(currentConfig.allowed_redirect_origins || currentConfig.allowedRedirectOrigins), ...origins])];

    const updatePayload = {
      allowedOrigins,
      allowedRedirectOrigins,
      brandName: currentConfig.brand_name || currentConfig.brandName || brand.name || org.name || program.name,
      defaultApprovalStatus: currentConfig.default_approval_status || currentConfig.defaultApprovalStatus || "pending",
    };

    const config = flags.dryRun
      ? { ...currentConfig, ...updatePayload, public_key: currentConfig.public_key }
      : (await request(apiBase, `/programs/${encodeURIComponent(program.id)}/connect-config`, { method: "POST", token, body: updatePayload })).config;

    const publicKeyValue = config.public_key || config.publicKey;
    const envValues = {
      // Browser SDK (Vite / React) vars.
      VITE_BOOMIN_PUBLIC_KEY: publicKeyValue,
      VITE_BOOMIN_PROGRAM_ID: program.id,
      VITE_BOOMIN_API_BASE: connectApiBase(flags),
      // Server vars the scaffolded Next.js referral routes read.
      BOOMIN_CONNECT_PUBLIC_KEY: publicKeyValue,
      BOOMIN_CONNECT_PROGRAM_ID: program.id,
    };
    const envResult = await upsertEnvFile(envValues, { dryRun: flags.dryRun });
    const savedConfig = {
      ...(await loadConfig()),
      apiBase,
      connectApiBase: connectApiBase(flags),
      defaultOrgId: org.id,
      defaultBrandId: brand.id,
      defaultProgramId: program.id,
      defaultPublicKey: config.public_key || config.publicKey,
      updatedAt: new Date().toISOString(),
    };
    if (!flags.dryRun) await saveConfig(savedConfig);

    if (flags.json) {
      printJson({
        dryRun: Boolean(flags.dryRun),
        org,
        brand,
        program,
        publicKey: config.public_key || config.publicKey,
        envPath: envResult.envPath,
        allowedOrigins,
      });
    } else {
      console.log(flags.dryRun ? "Dry run complete. No local files were written." : "Boomin Partner Connect is configured.");
      console.log(`Org: ${org.name}`);
      console.log(`Brand: ${brand.name}`);
      console.log(`Program: ${program.name}`);
      console.log(`Listed on Connect discover: ${program.visibility === "listed" ? "yes" : "no (private)"}`);
      console.log(`Public key: ${config.public_key || config.publicKey}`);
      console.log(`Wrote: ${envResult.envPath}`);
      console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
      printReactSnippet(await detectFramework());
    }
  } finally {
    rl?.close();
  }
}

function parseScopes(value) {
  return String(value || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function allKnownScopes() {
  return [...PLATFORM_SCOPES, ...PLATFORM_V1_SCOPES];
}

function validateLocalScopes(scopes) {
  const allowed = new Set(allKnownScopes().map((item) => item.scope));
  return scopes.filter((scope) => !allowed.has(scope));
}

function normalizeMcpPacks(flags = {}) {
  const raw = flags.packs || flags.pack || "referral_installer";
  const packs = String(raw)
    .split(",")
    .map((pack) => pack.trim())
    .filter(Boolean);
  const normalized = packs.includes("program_operator")
    ? ["referral_installer", "program_operator"]
    : packs.length
      ? packs
      : ["referral_installer"];
  const unique = [...new Set(normalized)];
  const invalid = unique.filter((pack) => !MCP_SKILL_PACKS[pack]);
  if (invalid.length) throw new Error(`Invalid MCP skill pack: ${invalid.join(", ")}. Use referral_installer or program_operator.`);
  return unique;
}

function scopesForMcpPacks(packs) {
  return [...new Set(packs.flatMap((pack) => MCP_SKILL_PACKS[pack].scopes))];
}

async function printScopes(flags = {}) {
  const scopeName = flags._[0] === "explain" ? flags._[1] : null;
  if (scopeName) {
    const found = allKnownScopes().find((item) => item.scope === scopeName);
    if (!found) throw new Error(`Unknown scope: ${scopeName}`);
    if (flags.json) printJson(found);
    else {
      console.log(`${found.scope}`);
      console.log(`Category: ${found.category}`);
      console.log(found.description);
    }
    return;
  }
  if (flags.json) {
    printJson({ scopes: allKnownScopes() });
    return;
  }
  const groups = new Map();
  for (const item of allKnownScopes()) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  for (const [category, items] of groups.entries()) {
    console.log(`\n${category}`);
    for (const item of items) console.log(`  ${item.scope.padEnd(28)} ${item.description}`);
  }
  console.log("");
}

async function tokenCommand(subcommand, flags = {}) {
  const apiBase = appApiBase(flags);
  const { token } = await ensureLogin(flags);
  const config = await loadConfig();

  if (subcommand === "create") {
    const name = flags.name || "Boomin Platform Token";
    const scopes = parseScopes(flags.scopes || "org:read");
    const invalid = validateLocalScopes(scopes);
    if (invalid.length) throw new Error(`Invalid scopes: ${invalid.join(", ")}`);
    const created = await request(apiBase, "/platform/tokens/create", {
      method: "POST",
      token,
      body: { name, scopes },
    });
    if (flags.save) {
      await saveConfig({ ...config, platformToken: created.secret, updatedAt: new Date().toISOString() });
    }
    if (flags.json) printJson({ ...created, saved: Boolean(flags.save) });
    else {
      console.log("Platform token created. Copy the secret now; it will not be shown again.");
      console.log(`Token ID: ${created.token.id}`);
      console.log(`Prefix: ${created.token.token_prefix}`);
      console.log(`Scopes: ${created.token.scopes.join(", ")}`);
      console.log(`Secret: ${created.secret}`);
      if (flags.save) console.log("Saved locally for platform smoke commands.");
    }
    return;
  }

  if (subcommand === "list") {
    const listed = await request(apiBase, "/platform/tokens", { token });
    if (flags.json) printJson(listed);
    else {
      const tokens = listed.tokens || [];
      if (!tokens.length) {
        console.log("No platform tokens found.");
        return;
      }
      for (const item of tokens) {
        console.log(`${item.id}  ${item.status}  ${item.name}  ${item.token_prefix}  scopes=${(item.scopes || []).join(",")}`);
      }
    }
    return;
  }

  if (subcommand === "revoke") {
    const tokenId = flags.tokenId || flags._[0];
    if (!tokenId) throw new Error("Token id is required. Usage: npx @boomin/cli token revoke <token_id>");
    const revoked = await request(apiBase, "/platform/tokens/revoke", {
      method: "POST",
      token,
      body: { token_id: tokenId },
    });
    if (flags.json) printJson(revoked);
    else console.log(`Revoked platform token ${tokenId}.`);
    return;
  }

  if (subcommand === "rotate") {
    const tokenId = flags.tokenId || flags._[0];
    if (!tokenId) throw new Error("Token id is required. Usage: npx @boomin/cli token rotate <token_id>");
    const rotated = await request(apiBase, "/platform/tokens/rotate", {
      method: "POST",
      token,
      body: { token_id: tokenId },
    });
    if (flags.save) {
      await saveConfig({ ...config, platformToken: rotated.secret, updatedAt: new Date().toISOString() });
    }
    if (flags.json) printJson({ ...rotated, saved: Boolean(flags.save) });
    else {
      console.log(`Rotated platform token ${tokenId}. Copy the new secret now; it will not be shown again.`);
      console.log(`New token ID: ${rotated.token.id}`);
      console.log(`Secret: ${rotated.secret}`);
      if (flags.save) console.log("Saved locally for platform smoke commands.");
    }
    return;
  }

  printHelp(["token"]);
}

async function resolvePlatformToken(flags = {}) {
  const config = await loadConfig();
  const token = flags.token || config.platformToken || process.env.BOOMIN_PLATFORM_TOKEN;
  if (!token) {
    throw new Error("Platform token required. Pass --token sk_boomin_live_... or set BOOMIN_PLATFORM_TOKEN.");
  }
  return token;
}

function actionFromScope(scope) {
  const parts = String(scope || "").split(":");
  return parts[parts.length - 1] || "";
}

function familyFromScope(scope) {
  const parts = String(scope || "").split(":");
  parts.pop();
  return parts.join(":");
}

function findScope(scope) {
  return PLATFORM_SCOPES.find((item) => item.scope === scope);
}

async function createTemporaryPlatformToken(apiBase, flags, scopes) {
  const { token } = await ensureLogin(flags);
  return request(apiBase, "/platform/tokens/create", {
    method: "POST",
    token,
    body: {
      name: `boomin all-scope smoke ${new Date().toISOString()}`,
      scopes,
    },
  });
}

async function revokeTemporaryPlatformToken(apiBase, flags, tokenId) {
  if (!tokenId) return;
  try {
    const { token } = await ensureLogin(flags);
    await request(apiBase, "/platform/tokens/revoke", {
      method: "POST",
      token,
      body: { token_id: tokenId },
    });
  } catch {
    // Best-effort cleanup. The smoke result still reports the token id.
  }
}

async function executePlatformScope(apiBase, platformToken, scope, options = {}) {
  const body = {
    token: platformToken,
    scope,
    idempotency_key: options.idempotencyKey,
    object_id: options.objectId,
    data: options.data || {},
  };
  return request(apiBase, "/scopes_exec", {
    method: "POST",
    platformToken,
    idempotencyKey: options.idempotencyKey,
    body: removeEmpty(body),
  });
}

async function platformAllScopesSmoke(flags = {}) {
  const apiBase = appApiBase(flags);
  const executeApiBase = platformApiBase(flags);
  const allScopes = PLATFORM_SCOPES.map((item) => item.scope);
  let platformToken = flags.token || process.env.BOOMIN_PLATFORM_TOKEN || null;
  let temporaryTokenId = null;
  const steps = [];
  const createdObjects = [];

  if (!platformToken) {
    const created = await createTemporaryPlatformToken(apiBase, flags, allScopes);
    platformToken = created.secret;
    temporaryTokenId = created.token?.id;
    steps.push({ name: "platform/tokens/create", ok: true, token_id: temporaryTokenId, scopes: allScopes.length });
  }

  try {
    for (const item of PLATFORM_SCOPES) {
      const idempotencyKey = `boomin-all-scope-${item.scope.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`;
      const result = await executePlatformScope(executeApiBase, platformToken, item.scope, {
        idempotencyKey,
        data: { smoke: true, source: "boomin_cli", scope: item.scope },
      });
      const objectId = result.object?.id || null;
      steps.push({
        name: `platform/scopes_exec:${item.scope}`,
        ok: Boolean(result.ok),
        scope: item.scope,
        mode: result.mode,
        object_id: objectId,
      });
      if (objectId && actionFromScope(item.scope) === "create") {
        createdObjects.push({ scope: item.scope, family: familyFromScope(item.scope), objectId });
      }
    }

    if (flags.cleanup) {
      for (const created of createdObjects) {
        const deleteScope = `${created.family}:delete`;
        if (!findScope(deleteScope)) {
          steps.push({
            name: `platform/scopes/cleanup:${created.scope}`,
            ok: false,
            skipped: true,
            reason: `No delete scope exists for ${created.family}.`,
            object_id: created.objectId,
          });
          continue;
        }
        const cleaned = await executePlatformScope(executeApiBase, platformToken, deleteScope, {
          objectId: created.objectId,
          data: { smoke_cleanup: true, source: "boomin_cli", created_scope: created.scope },
        });
        steps.push({
          name: `platform/scopes/cleanup:${deleteScope}`,
          ok: Boolean(cleaned.ok),
          scope: deleteScope,
          object_id: created.objectId,
        });
      }
    }
  } finally {
    if (temporaryTokenId) {
      await revokeTemporaryPlatformToken(apiBase, flags, temporaryTokenId);
      steps.push({ name: "platform/tokens/revoke", ok: true, token_id: temporaryTokenId });
    }
  }

  const result = {
    ok: steps.every((step) => step.ok || step.skipped),
    scope_count: allScopes.length,
    temporary_token_id: temporaryTokenId,
    steps,
  };
  if (flags.json) printJson(result);
  else {
    console.log(`Boomin all-scope platform smoke complete. ${allScopes.length} scopes checked.`);
    for (const step of steps) {
      const status = step.ok ? "ok" : step.skipped ? "skipped" : "failed";
      console.log(`- ${step.name}: ${status}`);
    }
  }
}

async function platformSmoke(flags = {}) {
  const apiBase = appApiBase(flags);
  const executeApiBase = platformApiBase(flags);
  if (flags.allScopes) {
    await platformAllScopesSmoke(flags);
    return;
  }

  const platformToken = await resolvePlatformToken(flags);
  const steps = [];

  const smoke = await request(executeApiBase, "/smoke", {
    method: "POST",
    platformToken,
    body: { token: platformToken },
  });
  steps.push({ name: "platform/smoke", ok: true, org: smoke.org, scopes: smoke.scopes });

  if (flags.readOnly || !flags.write) {
    try {
      const units = await request(executeApiBase, "/units/list", {
        method: "POST",
        platformToken,
        body: { token: platformToken, page: 1, per_page: 1 },
      });
      steps.push({ name: "platform/units/list", ok: true, count: Array.isArray(units.units) ? units.units.length : 0 });
    } catch (error) {
      if (error instanceof ApiError && error.requiredScope === "units:read") {
        steps.push({ name: "platform/units/list", ok: false, skipped: true, reason: "missing units:read" });
      } else {
        throw error;
      }
    }
  }

  if (flags.write) {
    const idempotencyKey = flags.idempotencyKey || `boomin-smoke-${Date.now()}`;
    const created = await request(executeApiBase, "/units/create", {
      method: "POST",
      platformToken,
      idempotencyKey,
      body: {
        token: platformToken,
        idempotency_key: idempotencyKey,
        type: flags.type || "short-video",
        caption: flags.caption || "Disposable unit created by Boomin platform smoke.",
        production_id: flags.productionId || "",
      },
    });
    const unitId = created.unit?.id;
    steps.push({ name: "platform/units/create", ok: true, unit_id: unitId, idempotency_key: idempotencyKey });

    if (flags.cleanup && unitId) {
      await request(executeApiBase, "/units/delete", {
        method: "POST",
        platformToken,
        body: { token: platformToken, unit_id: unitId },
      });
      steps.push({ name: "platform/units/delete", ok: true, unit_id: unitId });
    } else if (unitId) {
      steps.push({ name: "cleanup", ok: false, skipped: true, unit_id: unitId, reason: "Pass --cleanup to delete disposable smoke unit." });
    }
  }

  const result = { ok: steps.every((step) => step.ok || step.skipped), steps };
  if (flags.json) printJson(result);
  else {
    console.log("Boomin platform smoke complete.");
    for (const step of steps) {
      const status = step.ok ? "ok" : step.skipped ? "skipped" : "failed";
      console.log(`- ${step.name}: ${status}`);
    }
  }
}

async function platformCommand(subcommand, flags = {}) {
  if (subcommand === "smoke") {
    await platformSmoke(flags);
    return;
  }
  printHelp(["platform"]);
}

async function handoffCommand(subcommand, flags = {}) {
  if (subcommand === "provision" || subcommand === "rotate") {
    return handoffProvision({ ...flags, rotate: flags.rotate || subcommand === "rotate" });
  }
  if (subcommand !== "init") {
    printHelp(["handoff"]);
    return;
  }
  const framework = String(flags.framework || "next").toLowerCase();
  const auth = String(flags.auth || "custom").toLowerCase();
  if (framework !== "next") throw new Error("Only --framework next is supported in this MVP.");
  if (!["custom", "clerk", "supabase"].includes(auth)) {
    throw new Error("--auth must be one of: custom, clerk, supabase.");
  }

  const routePath = flags.route || "app/api/boomin/creator/join/route.js";
  const source = nextHandoffRouteTemplate(auth);
  if (flags.json) {
    printJson({ command: "handoff init", framework, auth, route: routePath, source });
    return;
  }

  if (!flags.write) {
    console.log(source);
    return;
  }

  const absolutePath = path.resolve(process.cwd(), routePath);
  const existing = await fs.stat(absolutePath).catch(() => null);
  if (existing && !flags.yes) {
    throw new Error(`${routePath} already exists. Re-run with --yes to overwrite.`);
  }
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, source);
  console.log(`Wrote ${routePath}`);
}

async function handoffProvision(flags = {}) {
  const apiBase = appApiBase(flags);
  const { token } = await ensureLogin(flags);
  const config = await loadConfig();
  const envFile = await readEnvFile(path.join(process.cwd(), ".env.local"));
  const programId = flags.programId
    || envFile.values.BOOMIN_CONNECT_PROGRAM_ID
    || envFile.values.VITE_BOOMIN_PROGRAM_ID
    || config.defaultProgramId;
  if (!programId) {
    throw new Error("Could not determine a program id. Pass --program-id, or run `npx @boomin/cli init` first.");
  }
  const issuer = flags.issuer || envFile.values.BOOMIN_HANDOFF_ISSUER || "your-app.com";
  const rotate = Boolean(flags.rotate);
  const route = rotate
    ? `/programs/${encodeURIComponent(programId)}/handoff-config/rotate`
    : `/programs/${encodeURIComponent(programId)}/handoff-config`;
  const body = removeEmpty({
    issuer,
    audience: flags.audience,
    signingSecret: flags.signingSecret,
  });

  const response = await request(apiBase, route, { method: "POST", token, body });
  const handoffConfig = response.config || null;
  const signingSecret = response.signingSecret || null;
  const resolvedIssuer = handoffConfig?.issuer || issuer;

  let envResult = null;
  if (signingSecret) {
    const updates = {
      BOOMIN_HANDOFF_SIGNING_SECRET: signingSecret,
      BOOMIN_HANDOFF_ISSUER: resolvedIssuer,
      BOOMIN_CONNECT_PROGRAM_ID: programId,
    };
    const publicKey = envFile.values.BOOMIN_CONNECT_PUBLIC_KEY
      || envFile.values.VITE_BOOMIN_PUBLIC_KEY
      || config.defaultPublicKey;
    if (publicKey) updates.BOOMIN_CONNECT_PUBLIC_KEY = publicKey;
    envResult = await upsertEnvFile(updates, { dryRun: flags.dryRun });
  }

  if (flags.json) {
    printJson({
      ok: true,
      rotated: rotate,
      programId,
      issuer: resolvedIssuer,
      config: handoffConfig,
      signingSecret: signingSecret || undefined,
      secretRevealed: Boolean(signingSecret),
      envPath: envResult?.envPath,
      dryRun: Boolean(flags.dryRun),
    });
    return;
  }

  if (signingSecret) {
    console.log(`Handoff config ${rotate ? "rotated" : "provisioned"} for issuer ${resolvedIssuer}.`);
    console.log("");
    console.log("Signing secret (shown once — copy it now):");
    console.log(`  ${signingSecret}`);
    console.log("");
    if (flags.dryRun) {
      console.log("Dry run: .env.local was not modified.");
    } else {
      console.log(`Saved BOOMIN_HANDOFF_SIGNING_SECRET, BOOMIN_HANDOFF_ISSUER, and BOOMIN_CONNECT_* to ${envResult.envPath}.`);
      console.log("Set the same values in your production server environment.");
    }
    console.log("");
    console.log("Next: npx @boomin/cli doctor   (handoff_config should now pass)");
  } else {
    console.log(`A handoff config already exists for issuer ${resolvedIssuer}; its signing secret stays hidden.`);
    console.log("To mint a fresh secret (this invalidates the previous one), run:");
    console.log("  npx @boomin/cli handoff provision --rotate");
  }
}

/**
 * Make the scaffolded referral routes actually serve referral links:
 * - write BOOMIN_REFERRAL_DESTINATION_URL into .env.local (the app/r/[code]
 *   redirect route reads it), defaulting to the app's primary origin;
 * - set the program's connect-config metadata referralBaseUrl to
 *   "<primary origin>/r" so standing responses return links on the app's
 *   own domain instead of the boomin.ai/r/ fallback.
 *
 * Best-effort: never fails the scaffold. An existing referralBaseUrl (e.g. a
 * production domain) is left alone unless an explicit --origin is passed.
 */
async function configureReferralRuntime(flags = {}) {
  const summary = { referralBaseUrl: null, referralBaseUrlAction: "skipped", destinationUrl: null, envPath: null, warnings: [] };
  const origin = await primaryAppOrigin(flags);
  const desiredBaseUrl = `${origin}/r`;

  const envFile = await readEnvFile(path.join(process.cwd(), ".env.local"));
  const existingDestination = envFile.values.BOOMIN_REFERRAL_DESTINATION_URL;
  const destinationUrl = flags.destinationUrl
    ? stripTrailingSlash(String(flags.destinationUrl))
    : existingDestination || origin;
  const envResult = await upsertEnvFile({ BOOMIN_REFERRAL_DESTINATION_URL: destinationUrl }, { dryRun: flags.dryRun });
  summary.destinationUrl = destinationUrl;
  summary.envPath = envResult.envPath;

  try {
    const config = await loadConfig();
    const programId = flags.programId
      || envFile.values.BOOMIN_CONNECT_PROGRAM_ID
      || envFile.values.VITE_BOOMIN_PROGRAM_ID
      || config.defaultProgramId;
    if (!programId) {
      throw new Error("no program id found — run `npx @boomin/cli init` first");
    }
    if (!config.authToken) {
      throw new Error("no saved Boomin login — run `npx @boomin/cli login` first");
    }
    const apiBase = appApiBase(flags);
    const token = config.authToken;
    const current = await request(apiBase, `/programs/${encodeURIComponent(programId)}/connect-config`, { token });
    const metadata = current.config?.metadata || {};
    const existingBaseUrl = metadata.referralBaseUrl || metadata.referral_base_url;
    if (existingBaseUrl && !(flags.origins && flags.origins.length)) {
      summary.referralBaseUrl = existingBaseUrl;
      summary.referralBaseUrlAction = "kept";
    } else if (flags.dryRun) {
      summary.referralBaseUrl = desiredBaseUrl;
      summary.referralBaseUrlAction = "dry_run";
    } else {
      await request(apiBase, `/programs/${encodeURIComponent(programId)}/connect-config`, {
        method: "POST",
        token,
        body: { metadata: { referralBaseUrl: desiredBaseUrl } },
      });
      summary.referralBaseUrl = desiredBaseUrl;
      summary.referralBaseUrlAction = "set";
    }
  } catch (error) {
    summary.warnings.push(
      `Could not set program metadata referralBaseUrl (${error.message}). ` +
      "Referral links will fall back to boomin.ai/r/ until it is set — re-run `npx @boomin/cli referral init --write` after `npx @boomin/cli login`.",
    );
  }
  return summary;
}

async function referralCommand(subcommand, flags = {}) {
  if (subcommand !== "init") {
    printHelp(["referral"]);
    return;
  }
  const framework = String(flags.framework || "next").toLowerCase();
  const auth = String(flags.auth || "custom").toLowerCase();
  if (framework !== "next") throw new Error("Only --framework next is supported in this MVP.");
  if (!["custom", "clerk", "supabase"].includes(auth)) {
    throw new Error("--auth must be one of: custom, clerk, supabase.");
  }

  const files = {
    [flags.joinRoute || "app/api/boomin/partner/join/route.js"]: nextReferralJoinRouteTemplate(auth),
    [flags.statusRoute || "app/api/boomin/partner/status/route.js"]: nextReferralStatusRouteTemplate(auth),
    [flags.redirectRoute || "app/r/[code]/route.js"]: nextReferralRedirectRouteTemplate(),
    [flags.page || "app/partner/page.jsx"]: nextReferralPageTemplate(),
  };

  if (flags.json) {
    printJson({ command: "referral init", framework, auth, files });
    return;
  }

  if (!flags.write) {
    for (const [filePath, source] of Object.entries(files)) {
      console.log(`\n// ${filePath}\n${source}`);
    }
    return;
  }

  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = path.resolve(process.cwd(), filePath);
    const existing = await fs.stat(absolutePath).catch(() => null);
    if (existing && !flags.yes) {
      throw new Error(`${filePath} already exists. Re-run with --yes to overwrite.`);
    }
  }

  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = path.resolve(process.cwd(), filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, source);
    console.log(`Wrote ${filePath}`);
  }

  const runtime = await configureReferralRuntime(flags);
  console.log(`Wrote BOOMIN_REFERRAL_DESTINATION_URL=${runtime.destinationUrl} to ${runtime.envPath}`);
  if (runtime.referralBaseUrlAction === "set") {
    console.log(`Program metadata referralBaseUrl set to ${runtime.referralBaseUrl} — referral links now use your app's /r route.`);
  } else if (runtime.referralBaseUrlAction === "kept") {
    console.log(`Program metadata referralBaseUrl already set (${runtime.referralBaseUrl}); left unchanged. Pass --origin <url> to replace it.`);
  }
  for (const warning of runtime.warnings) console.log(`Warning: ${warning}`);
  console.log("Next: npx @boomin/cli doctor   (referral_readiness should now pass)");
}

async function skillCommand(subcommand, flags = {}) {
  if (subcommand !== "install") {
    printHelp(["skill"]);
    return;
  }
  await installSkill(flags);
}

async function mcpCommand(flags = {}) {
  const subcommand = flags._.shift();

  if (subcommand === "install") {
    await mcpInstall(flags);
    return;
  }

  throw new Error("Local stdio MCP is not shipped. Use `npx @boomin/cli mcp install` to wire the hosted Boomin MCP (https://mcp.boomin.ai/mcp) into Claude Code.");
}

async function mcpInstall(flags = {}) {
  const apiBase = appApiBase(flags);
  const packs = normalizeMcpPacks(flags);
  const scopes = parseScopes(flags.scopes).length ? parseScopes(flags.scopes) : scopesForMcpPacks(packs);
  const invalid = validateLocalScopes(scopes);
  if (invalid.length) throw new Error(`Invalid scopes: ${invalid.join(", ")}`);

  const serverName = flags.serverName || "boomin";
  const mcpUrl = flags.mcpUrl || "https://mcp.boomin.ai/mcp";
  const scope = flags.scope || "user";
  const claudeCommand = flags.claudeCommand || (process.platform === "win32" ? "claude.exe" : "claude");

  if (flags.dryRun) {
    const result = {
      ok: true,
      dryRun: true,
      serverName,
      mcpUrl,
      scope,
      packs,
      scopes,
      command: `${claudeCommand} mcp add ${serverName} --transport http ${mcpUrl} --header "Authorization: Bearer sk_boomin_live_..." -s ${scope}`,
      nextStep: "Run without --dry-run, then restart Claude Code.",
    };
    if (flags.json) printJson(result);
    else {
      console.log("Boomin MCP install dry run.");
      console.log(`Server: ${serverName}`);
      console.log(`Scope: ${scope}`);
      console.log(`Packs: ${packs.join(", ")}`);
      console.log(`Scopes: ${scopes.join(", ")}`);
      console.log("Run without --dry-run to create a scoped token and write Claude Code MCP config.");
    }
    return;
  }

  const { token: authToken } = await ensureLogin(flags);
  const tokenName = flags.name || `Claude Code MCP (${packs.join(",")})`;
  const created = await request(apiBase, "/platform/tokens/create", {
    method: "POST",
    token: authToken,
    body: {
      name: tokenName,
      scopes,
      ...(flags.orgId ? { orgId: flags.orgId } : {}),
    },
  });

  const args = [
    "mcp",
    "add",
    serverName,
    "--transport",
    "http",
    mcpUrl,
    "--header",
    `Authorization: Bearer ${created.secret}`,
    "-s",
    scope,
  ];

  let addResult;
  try {
    const displayArgs = args.map((item) => String(item).startsWith("Authorization: Bearer ") ? "Authorization: Bearer sk_boomin_live_..." : item);
    addResult = await runCli(claudeCommand, args, { displayArgs });
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      try {
        await runCli(claudeCommand, ["mcp", "remove", serverName, "-s", scope]);
        const displayArgs = args.map((item) => String(item).startsWith("Authorization: Bearer ") ? "Authorization: Bearer sk_boomin_live_..." : item);
        addResult = await runCli(claudeCommand, args, { displayArgs });
      } catch (retryError) {
        await request(apiBase, "/platform/tokens/revoke", {
          method: "POST",
          token: authToken,
          body: { token_id: created.token?.id },
        }).catch(() => null);
        throw new Error(`Created the MCP token, but could not replace existing '${serverName}' Claude MCP config. The token was revoked. ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    } else {
      await request(apiBase, "/platform/tokens/revoke", {
        method: "POST",
        token: authToken,
        body: { token_id: created.token?.id },
      }).catch(() => null);
      throw new Error(`Created the MCP token, but could not run '${claudeCommand} mcp add'. The token was revoked. Install Claude Code or pass --claude-command. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!addResult) {
    await request(apiBase, "/platform/tokens/revoke", {
      method: "POST",
      token: authToken,
      body: { token_id: created.token?.id },
    }).catch(() => null);
    throw new Error("Created the MCP token, but Claude MCP install did not return a result. The token was revoked.");
  }

  let listResult = null;
  try {
    listResult = await runCli(claudeCommand, ["mcp", "list"]);
  } catch {
    // Some Claude versions do not expose list in the same environment. The add command is the source of truth.
  }

  const result = {
    ok: true,
    serverName,
    mcpUrl,
    scope,
    packs,
    scopes,
    token: {
      id: created.token?.id,
      prefix: created.token?.token_prefix || created.token?.prefix,
      status: created.token?.status,
    },
    claude: {
      addStdout: redactSecrets(addResult.stdout?.trim() || ""),
      addStderr: redactSecrets(addResult.stderr?.trim() || ""),
      listOutput: listResult?.stdout ? redactSecrets(listResult.stdout.trim()) : null,
    },
    nextStep: "Restart Claude Code so it reloads MCP config, then ask it to use Boomin.",
  };

  if (flags.json) printJson(result);
  else {
    console.log("Boomin MCP installed for Claude Code.");
    console.log(`Server: ${serverName}`);
    console.log(`Scope: ${scope}`);
    console.log(`Packs: ${packs.join(", ")}`);
    console.log(`Token prefix: ${result.token.prefix}`);
    console.log("");
    console.log("Restart Claude Code so it reloads MCP config, then ask it to use Boomin.");
  }
}

function nextHandoffRouteTemplate(auth) {
  const currentUserSnippet = {
    custom: `async function getCurrentUser(request) {
  // Replace this with your app's server-side session lookup.
  // Return null when the visitor is not signed in.
  const user = await yourAuthGetCurrentUser(request);
  if (!user) return null;
  return {
    externalUserId: user.id,
    email: user.email,
    name: user.name || user.email,
    metadata: { source: "custom" },
  };
}`,
    clerk: `import { currentUser } from "@clerk/nextjs/server";

async function getCurrentUser() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!user || !email) return null;
  return {
    externalUserId: user.id,
    email,
    name: user.fullName || email,
    metadata: { source: "clerk" },
  };
}`,
    supabase: `import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const email = user?.email;
  if (!user || !email) return null;
  return {
    externalUserId: user.id,
    email,
    name: user.user_metadata?.name || email,
    metadata: { source: "supabase" },
  };
}`,
  }[auth];

  return `import { createBoominCreatorJoinHandler } from "@boomin/server/next";
${auth === "custom" ? "" : "\n"}${currentUserSnippet}

export const GET = createBoominCreatorJoinHandler({
  publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
  programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
  redirectUri: process.env.BOOMIN_CONNECT_REDIRECT_URI,
  signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
  issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
  loginUrl: "/login",
  getCurrentUser,
});
`; 
}

function nextReferralAuthSnippet(auth) {
  return {
    custom: `async function getCurrentUser(request) {
  // Replace this with your app's server-side session lookup.
  // Return null when the visitor is not signed in.
  const user = await yourAuthGetCurrentUser(request);
  if (!user) return null;
  return {
    externalUserId: user.id,
    email: user.email,
    name: user.name || user.email,
    metadata: { source: "custom" },
  };
}`,
    clerk: `import { currentUser } from "@clerk/nextjs/server";

async function getCurrentUser() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!user || !email) return null;
  return {
    externalUserId: user.id,
    email,
    name: user.fullName || email,
    metadata: { source: "clerk" },
  };
}`,
    supabase: `import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const email = user?.email;
  if (!user || !email) return null;
  return {
    externalUserId: user.id,
    email,
    name: user.user_metadata?.name || email,
    metadata: { source: "supabase" },
  };
}`,
  }[auth];
}

function nextReferralJoinRouteTemplate(auth) {
  return `import { createBoominCreatorJoinHandler } from "@boomin/server/next";
${auth === "custom" ? "" : "\n"}${nextReferralAuthSnippet(auth)}

export const GET = createBoominCreatorJoinHandler({
  publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
  programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
  redirectUri: process.env.BOOMIN_CONNECT_REDIRECT_URI || new URL("/partner", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString(),
  signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
  issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
  loginUrl: "/login",
  getCurrentUser,
});
`;
}

function nextReferralStatusRouteTemplate(auth) {
  return `import { getPartnerStanding } from "@boomin/server";
${auth === "custom" ? "" : "\n"}${nextReferralAuthSnippet(auth)}

export async function GET(request) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return Response.json({ success: false, code: "unauthorized", message: "Sign in required." }, { status: 401 });
  }

  const standing = await getPartnerStanding({
    publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
    programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
    issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
    signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
    externalUserId: currentUser.externalUserId,
  });

  return Response.json({
    success: true,
    partner: standing.partners?.[0] || null,
    totals: standing.totals,
    requiredChannels: standing.requiredChannels || [],
  });
}
`;
}

function nextReferralRedirectRouteTemplate() {
  return `import { recordReferralClick } from "@boomin/server";

export async function GET(request, { params }) {
  const routeParams = await params;
  const code = routeParams.code;
  try {
    await recordReferralClick({
      publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
      programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
      issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
      signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
      partnerRef: code,
      eventId: \`link_click:\${code}:\${crypto.randomUUID()}\`,
      metadata: {
        sourceUrl: request.url,
        userAgent: request.headers.get("user-agent"),
        referrer: request.headers.get("referer"),
      },
    });
  } catch (error) {
    console.warn("Boomin referral click tracking failed", error);
  }

  const destination = new URL(process.env.BOOMIN_REFERRAL_DESTINATION_URL || "/", request.url);
  destination.searchParams.set("ref", code);
  return Response.redirect(destination.toString(), 302);
}
`;
}

function nextReferralPageTemplate() {
  return `"use client";

import { useEffect, useMemo, useState } from "react";

export default function PartnerPage() {
  const [state, setState] = useState("loading");
  const [partner, setPartner] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/boomin/partner/status", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not load partner status.");
      setPartner(data.partner);
      setState("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load partner status.");
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const referral = partner?.referral || {
    code: partner?.referralCode,
    url: partner?.referralLink,
    active: Boolean(partner?.referralLink),
  };
  const metrics = partner?.metrics || {};
  const needsInstagram = Array.isArray(partner?.missingChannels) && partner.missingChannels.includes("instagram");

  return (
    <main style={{ minHeight: "100vh", padding: 32, fontFamily: "Inter, system-ui, sans-serif", background: "#071019", color: "#f8fafc" }}>
      <section style={{ maxWidth: 880, margin: "0 auto" }}>
        <p style={{ color: "#22d3ee", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Partner Program</p>
        <h1 style={{ marginTop: 8, fontSize: 40, lineHeight: 1.05 }}>Your referral link and partner standing</h1>
        <p style={{ marginTop: 12, color: "#94a3b8", maxWidth: 640 }}>
          Share your link, track your progress, and connect optional channels when the program asks for them.
        </p>

        {state === "error" && <StatusBox tone="error">{error}</StatusBox>}

        {!partner && state !== "loading" ? (
          <a href="/api/boomin/partner/join" style={buttonStyle}>Join partner program</a>
        ) : null}

        {partner ? (
          <>
            <div style={{ marginTop: 24, padding: 20, border: "1px solid rgba(34,211,238,.2)", borderRadius: 12, background: "rgba(15,23,42,.75)" }}>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>Referral link</p>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <input value={referral.url || ""} readOnly style={{ flex: "1 1 360px", minWidth: 0, padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(148,163,184,.25)", background: "#020617", color: "#e2e8f0" }} />
                <button type="button" onClick={() => navigator.clipboard.writeText(referral.url || "")} style={buttonStyle}>Copy</button>
              </div>
              <p style={{ marginTop: 10, color: "#64748b", fontSize: 12 }}>Code: {referral.code || "Not created yet"}</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
              <Metric label="Clicks" value={metrics.linkClicks || 0} />
              <Metric label="Signups" value={metrics.signups || 0} />
              <Metric label="Sales" value={metrics.sales || 0} />
              <Metric label="GMV" value={formatMoney(metrics.gmvCents || 0)} />
              <Metric label="Usage" value={metrics.productUsage || 0} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 16 }}>
              <StatusBox>Approval: {partner.approvalStatus || partner.member?.approvalStatus || "pending"}</StatusBox>
              <StatusBox>Qualification: {partner.qualificationStatus || partner.qualification?.status || "pending"}</StatusBox>
              <StatusBox>Program status: {partner.status || "joined"}</StatusBox>
            </div>

            {needsInstagram ? (
              <a href="/api/boomin/partner/join" style={{ ...buttonStyle, marginTop: 18 }}>Connect Instagram</a>
            ) : null}
          </>
        ) : state === "loading" ? (
          <StatusBox>Loading partner standing...</StatusBox>
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ padding: 16, border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.55)" }}>
      <p style={{ margin: 0, color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</p>
      <p style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 800 }}>{value}</p>
    </div>
  );
}

function StatusBox({ children, tone }) {
  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: tone === "error" ? "1px solid rgba(248,113,113,.35)" : "1px solid rgba(148,163,184,.18)", background: tone === "error" ? "rgba(127,29,29,.25)" : "rgba(15,23,42,.55)", color: tone === "error" ? "#fecaca" : "#dbeafe" }}>
      {children}
    </div>
  );
}

function formatMoney(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "0 16px",
  borderRadius: 8,
  border: "1px solid rgba(34,211,238,.35)",
  background: "#06b6d4",
  color: "#001018",
  textDecoration: "none",
  fontWeight: 800,
};
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const rest = argv.slice(command === "help" ? 1 : 1);
  const flags = parseArgs(rest);

  if (command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "help") {
    printHelp(flags._);
    return;
  }

  if (flags.help) {
    const sub = flags._[0];
    printHelp([command, sub].filter(Boolean));
    return;
  }

  if (command === "login") await login(flags);
  else if (command === "init") await init(flags);
  else if (command === "doctor") await doctor(flags);
  else if (command === "status") await status(flags);
  else if (command === "logout") {
    await clearConfig();
    if (flags.json) printJson({ loggedOut: true });
    else console.log("Logged out of Boomin CLI.");
  } else if (command === "scopes") {
    await printScopes(flags);
  } else if (command === "token") {
    const subcommand = flags._.shift();
    if (!subcommand) printHelp(["token"]);
    else await tokenCommand(subcommand, flags);
  } else if (command === "platform") {
    const subcommand = flags._.shift();
    if (!subcommand) printHelp(["platform"]);
    else await platformCommand(subcommand, flags);
  } else if (command === "handoff") {
    const subcommand = flags._.shift();
    if (!subcommand) printHelp(["handoff"]);
    else await handoffCommand(subcommand, flags);
  } else if (command === "referral") {
    const subcommand = flags._.shift();
    if (!subcommand) printHelp(["referral"]);
    else await referralCommand(subcommand, flags);
  } else if (command === "skill") {
    const subcommand = flags._.shift();
    if (!subcommand) printHelp(["skill"]);
    else await skillCommand(subcommand, flags);
  } else if (command === "mcp") {
    await mcpCommand(flags);
  } else if (isV1Group(command)) {
    const subcommand = flags._.shift();
    if (!subcommand) {
      printHelp([command]);
      return;
    }
    const token = await resolvePlatformToken(flags);
    await runV1Command(command, subcommand, flags, {
      token,
      platformApiBase: platformApiBase(flags),
    });
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.json) {
    printJson({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof ApiError ? error.code : "error",
        status: error instanceof ApiError ? error.status : undefined,
        required_scope: error instanceof ApiError ? error.requiredScope : undefined,
        suggested_command: error instanceof ApiError ? error.suggestedCommand : undefined,
      },
    });
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof ApiError && error.suggestedCommand) console.error(`Try: ${error.suggestedCommand}`);
  }
  process.exitCode = 1;
});

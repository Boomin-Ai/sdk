const DEFAULT_API_BASE = "https://api.boomin.ai";
const DEFAULT_CONNECT_API_BASE = "https://api.boomin.ai/v1/connect";
const DEFAULT_PLATFORM_API_BASE = "https://api.boomin.ai/v1/platform";
const MCP_PROTOCOL_VERSION = "2025-06-18";

export const SKILL_PACKS = {
  referral_installer: {
    label: "Referral Program Installer",
    description: "Diagnose setup, scaffold referral-first app routes, verify install, read standing, and record test events.",
    scopes: ["org:read", "connect_config:read", "events:write"],
  },
  program_operator: {
    label: "Program Operator",
    description: "Update program settings, required channels, requirements, tiers, and run evaluations.",
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

const INSTALLER_TOOLS = [
  "boomin.doctor",
  "boomin.detect_project",
  "boomin.get_connect_config",
  "boomin.scaffold_referral_first",
  "boomin.verify_referral_install",
  "boomin.get_partner_standing",
  "boomin.record_test_event",
];

const OPERATOR_TOOLS = [
  "boomin.get_program",
  "boomin.update_program",
  "boomin.update_required_channels",
  "boomin.update_referral_settings",
  "boomin.list_program_requirements",
  "boomin.create_program_requirement",
  "boomin.update_program_requirement",
  "boomin.delete_program_requirement",
  "boomin.list_program_tiers",
  "boomin.create_program_tier",
  "boomin.update_program_tier",
  "boomin.evaluate_program",
  "boomin.preview_qualification",
];

const TOOL_DEFINITIONS = [
  tool("boomin.doctor", "Run a read-only Boomin MCP health check.", {
    type: "object",
    properties: {
      publicKey: { type: "string" },
      programId: { type: "string" },
    },
  }),
  tool("boomin.detect_project", "Detect the local framework, package manager, and Boomin generated routes.", {
    type: "object",
    properties: {
      cwd: { type: "string" },
    },
  }),
  tool("boomin.get_connect_config", "Read a public Partner Connect config by public key.", {
    type: "object",
    properties: {
      publicKey: { type: "string" },
    },
    required: ["publicKey"],
  }),
  tool("boomin.scaffold_referral_first", "Generate or write Next.js referral-first routes and starter partner UI.", {
    type: "object",
    properties: {
      framework: { type: "string", enum: ["next"], default: "next" },
      auth: { type: "string", enum: ["custom", "clerk", "supabase"], default: "custom" },
      write: { type: "boolean", default: false },
      cwd: { type: "string" },
      page: { type: "string" },
      joinRoute: { type: "string" },
      statusRoute: { type: "string" },
      redirectRoute: { type: "string" },
    },
  }),
  tool("boomin.verify_referral_install", "Verify referral-first generated routes exist in the local app.", {
    type: "object",
    properties: {
      cwd: { type: "string" },
      page: { type: "string" },
      joinRoute: { type: "string" },
      statusRoute: { type: "string" },
      redirectRoute: { type: "string" },
    },
  }),
  tool("boomin.get_partner_standing", "Read signed Partner Connect standing for one external user or a program.", {
    type: "object",
    properties: {
      publicKey: { type: "string" },
      programId: { type: "string" },
      issuer: { type: "string" },
      signingSecret: { type: "string" },
      externalUserId: { type: "string" },
    },
    required: ["publicKey", "programId", "issuer"],
  }),
  tool("boomin.record_test_event", "Record one idempotent test metric event for a partner.", {
    type: "object",
    properties: {
      publicKey: { type: "string" },
      programId: { type: "string" },
      issuer: { type: "string" },
      signingSecret: { type: "string" },
      partnerRef: { type: "string" },
      metricKey: { type: "string", default: "link_clicks" },
      amount: { type: "number", default: 1 },
      eventId: { type: "string" },
    },
    required: ["publicKey", "issuer", "partnerRef"],
  }),
  tool("boomin.get_program", "Read a program, brand, and Connect config through a scoped platform token.", programRefSchema()),
  tool("boomin.update_program", "Update basic program fields. Supports dryRun.", {
    type: "object",
    properties: {
      token: { type: "string" },
      programId: { type: "string" },
      publicKey: { type: "string" },
      dryRun: { type: "boolean", default: true },
      name: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "archived"] },
    },
  }),
  tool("boomin.update_required_channels", "Update the program required channel list, for example [] or ['instagram']. Supports dryRun.", {
    type: "object",
    properties: {
      token: { type: "string" },
      programId: { type: "string" },
      publicKey: { type: "string" },
      requiredChannels: { type: "array", items: { type: "string" } },
      dryRun: { type: "boolean", default: true },
    },
    required: ["requiredChannels"],
  }),
  tool("boomin.update_referral_settings", "Update referral base URL metadata on the Connect config. Supports dryRun.", {
    type: "object",
    properties: {
      token: { type: "string" },
      programId: { type: "string" },
      publicKey: { type: "string" },
      referralBaseUrl: { type: "string" },
      dryRun: { type: "boolean", default: true },
    },
    required: ["referralBaseUrl"],
  }),
  tool("boomin.list_program_requirements", "List program requirements.", programRefSchema()),
  tool("boomin.create_program_requirement", "Create a program requirement. Supports dryRun.", requirementSchema()),
  tool("boomin.update_program_requirement", "Update a program requirement. Supports dryRun.", requirementSchema({ update: true })),
  tool("boomin.delete_program_requirement", "Archive a program requirement. Supports dryRun.", {
    type: "object",
    properties: { ...programRefSchema().properties, requirementId: { type: "string" }, dryRun: { type: "boolean", default: true } },
    required: ["requirementId"],
  }),
  tool("boomin.list_program_tiers", "List program tiers.", programRefSchema()),
  tool("boomin.create_program_tier", "Create a program tier. Supports dryRun.", tierSchema()),
  tool("boomin.update_program_tier", "Update a program tier. Supports dryRun.", tierSchema({ update: true })),
  tool("boomin.evaluate_program", "Run or preview a program qualification evaluation.", {
    type: "object",
    properties: { ...programRefSchema().properties, dryRun: { type: "boolean", default: true } },
  }),
  tool("boomin.preview_qualification", "Preview a program evaluation without mutating state.", {
    type: "object",
    properties: { ...programRefSchema().properties },
  }),
];

export function createMcpContext(input = {}) {
  const env = input.env || {};
  const skillPacks = normalizeSkillPacks(input.skillPacks || env.BOOMIN_MCP_SKILL_PACKS);
  return {
    local: Boolean(input.local),
    cwd: input.cwd,
    apiBase: strip(input.apiBase || env.BOOMIN_API_BASE || DEFAULT_API_BASE),
    connectApiBase: strip(input.connectApiBase || env.BOOMIN_CONNECT_API_BASE || DEFAULT_CONNECT_API_BASE),
    platformApiBase: strip(input.platformApiBase || env.BOOMIN_PLATFORM_API_BASE || DEFAULT_PLATFORM_API_BASE),
    platformToken: input.platformToken || env.BOOMIN_PLATFORM_TOKEN,
    skillPacks,
    env,
  };
}

export async function handleMcpPayload(payload, contextInput = {}) {
  const context = createMcpContext(contextInput);
  if (Array.isArray(payload)) return Promise.all(payload.map((message) => handleJsonRpc(message, context)));
  return handleJsonRpc(payload, context);
}

export async function handleJsonRpc(message, context) {
  if (!message || typeof message !== "object") return jsonRpcError(null, -32600, "Invalid Request");
  if (message.method?.startsWith("notifications/")) return null;
  try {
    if (message.method === "initialize") {
      return jsonRpcResult(message.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "boomin", version: "0.1.0" },
      });
    }
    if (message.method === "ping") return jsonRpcResult(message.id, {});
    if (message.method === "tools/list") return jsonRpcResult(message.id, { tools: allowedTools(context) });
    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments || {}, context);
      return jsonRpcResult(message.id, mcpToolResult(result));
    }
    if (message.method === "resources/list") return jsonRpcResult(message.id, { resources: [] });
    return jsonRpcError(message.id, -32601, `Unknown MCP method: ${message.method}`);
  } catch (error) {
    return jsonRpcResult(message.id, mcpToolResult(errorPayload(error), true));
  }
}

export function allowedTools(context) {
  const allowed = new Set();
  if (context.skillPacks.includes("referral_installer")) INSTALLER_TOOLS.forEach((name) => allowed.add(name));
  if (context.skillPacks.includes("program_operator")) OPERATOR_TOOLS.forEach((name) => allowed.add(name));
  return TOOL_DEFINITIONS.filter((definition) => allowed.has(definition.name));
}

export async function callTool(name, args, contextInput = {}) {
  const context = contextInput.platformApiBase ? contextInput : createMcpContext(contextInput);
  if (!allowedTools(context).some((item) => item.name === name)) {
    throw toolError("mcp_tool_not_granted", `Tool ${name} is not granted. Re-authorize with the required skill pack.`, {
      reauthorizeUrl: "https://mcp.boomin.ai/authorize",
    });
  }

  switch (name) {
    case "boomin.doctor": return doctor(args, context);
    case "boomin.detect_project": return detectProject(args, context);
    case "boomin.get_connect_config": return getConnectConfig(args, context);
    case "boomin.scaffold_referral_first": return scaffoldReferralFirst(args, context);
    case "boomin.verify_referral_install": return verifyReferralInstall(args, context);
    case "boomin.get_partner_standing": return getPartnerStanding(args, context);
    case "boomin.record_test_event": return recordTestEvent(args, context);
    case "boomin.get_program": return platformPost("/programs/get", args, context, "programs:read");
    case "boomin.update_program": return platformPost("/programs/update", defaultDryRun(args), context, "programs:update");
    case "boomin.update_required_channels": return platformPost("/programs/connect-config/update", defaultDryRun(args), context, "connect_config:write");
    case "boomin.update_referral_settings": {
      const next = { ...defaultDryRun(args), metadata: { ...(args.metadata || {}), referralBaseUrl: args.referralBaseUrl } };
      return platformPost("/programs/connect-config/update", next, context, "connect_config:write");
    }
    case "boomin.list_program_requirements": return platformPost("/programs/requirements/list", args, context, "program_requirements:read");
    case "boomin.create_program_requirement": return platformPost("/programs/requirements/create", defaultDryRun(args), context, "program_requirements:write");
    case "boomin.update_program_requirement": return platformPost("/programs/requirements/update", defaultDryRun(args), context, "program_requirements:write");
    case "boomin.delete_program_requirement": return platformPost("/programs/requirements/delete", defaultDryRun(args), context, "program_requirements:write");
    case "boomin.list_program_tiers": return platformPost("/programs/tiers/list", args, context, "program_tiers:read");
    case "boomin.create_program_tier": return platformPost("/programs/tiers/create", defaultDryRun(args), context, "program_tiers:write");
    case "boomin.update_program_tier": return platformPost("/programs/tiers/update", defaultDryRun(args), context, "program_tiers:write");
    case "boomin.evaluate_program": return platformPost("/programs/evaluate", defaultDryRun(args), context, "programs:update");
    case "boomin.preview_qualification": return platformPost("/programs/evaluate", { ...args, dryRun: true }, context, "programs:update");
    default: throw toolError("mcp_tool_unknown", `Unknown tool: ${name}`);
  }
}

async function doctor(args, context) {
  const health = await getJson(`${context.apiBase}/health`).catch((error) => ({ ok: false, error: error.message }));
  const platform = context.platformToken
    ? await platformPost("/smoke", {}, context, "org:read").catch((error) => errorPayload(error))
    : { ok: false, skipped: true, message: "No BOOMIN_PLATFORM_TOKEN provided." };
  const config = args.publicKey
    ? await getConnectConfig({ publicKey: args.publicKey }, context).catch((error) => errorPayload(error))
    : { skipped: true, message: "No publicKey provided." };
  return {
    ok: Boolean(health.ok) && (!context.platformToken || platform.ok !== false),
    mcp: { skillPacks: context.skillPacks, local: context.local },
    api: health,
    platform,
    connectConfig: config,
    nextSteps: context.platformToken ? [] : ["Create a scoped token with `npx @boomin/cli token create --name MCP --scopes org:read,connect_config:read,events:write --save`."],
  };
}

async function detectProject(args, context) {
  if (!context.local) return { ok: false, code: "local_only", message: "Project detection is only available through local stdio MCP." };
  const cwd = args.cwd || context.cwd || ".";
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const packagePath = path.join(cwd, "package.json");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const files = referralFiles(args);
  const existing = {};
  for (const [key, file] of Object.entries(files)) {
    existing[key] = await exists(path.join(cwd, file), fs);
  }
  return {
    ok: true,
    cwd,
    packageName: pkg.name || null,
    framework: pkg.dependencies?.next || pkg.devDependencies?.next ? "next" : "unknown",
    boominDependencies: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).filter((name) => name.startsWith("@boomin/")),
    referralFiles: existing,
  };
}

async function getConnectConfig(args, context) {
  if (!args.publicKey) throw toolError("public_key_required", "publicKey is required.");
  return getJson(`${context.connectApiBase}/config?publicKey=${encodeURIComponent(args.publicKey)}`);
}

async function scaffoldReferralFirst(args, context) {
  const files = generateReferralFiles(args);
  if (!args.write) return { ok: true, dryRun: true, files };
  if (!context.local) {
    return { ok: false, code: "local_only", message: "Hosted MCP cannot write local app files. Use npx @boomin/mcp or npx @boomin/cli mcp.", files };
  }
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cwd = args.cwd || context.cwd || ".";
  const written = [];
  for (const file of files) {
    const target = path.join(cwd, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
    written.push(file.path);
  }
  return { ok: true, written };
}

async function verifyReferralInstall(args, context) {
  if (!context.local) return { ok: false, code: "local_only", message: "Install verification is only available through local stdio MCP." };
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cwd = args.cwd || context.cwd || ".";
  const files = referralFiles(args);
  const checks = [];
  for (const [name, file] of Object.entries(files)) {
    checks.push({ name, path: file, exists: await exists(path.join(cwd, file), fs) });
  }
  return { ok: checks.every((check) => check.exists), checks };
}

async function getPartnerStanding(args, context) {
  const publicKey = args.publicKey || context.env.BOOMIN_CONNECT_PUBLIC_KEY;
  const programId = args.programId || context.env.BOOMIN_CONNECT_PROGRAM_ID;
  const issuer = args.issuer || context.env.BOOMIN_HANDOFF_ISSUER;
  const signingSecret = args.signingSecret || context.env.BOOMIN_HANDOFF_SIGNING_SECRET;
  if (!publicKey || !programId || !issuer || !signingSecret) {
    throw toolError("standing_config_required", "publicKey, programId, issuer, and signingSecret are required.");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = removeEmpty({
    iss: issuer,
    aud: args.audience || "boomin.ai",
    iat: issuedAt,
    exp: issuedAt + 300,
    nonce: crypto.randomUUID(),
    publicKey,
    programId,
    externalUserId: args.externalUserId,
  });
  return postJson(`${context.connectApiBase}/standing`, {
    payload,
    signature: await signPayload(payload, signingSecret),
  });
}

async function recordTestEvent(args, context) {
  const publicKey = args.publicKey || context.env.BOOMIN_CONNECT_PUBLIC_KEY;
  const issuer = args.issuer || context.env.BOOMIN_HANDOFF_ISSUER;
  const signingSecret = args.signingSecret || context.env.BOOMIN_HANDOFF_SIGNING_SECRET;
  if (!publicKey || !issuer || !signingSecret || !args.partnerRef) {
    throw toolError("event_config_required", "publicKey, issuer, signingSecret, and partnerRef are required.");
  }
  const body = removeEmpty({
    event_id: args.eventId || `mcp_test:${args.metricKey || "link_clicks"}:${crypto.randomUUID()}`,
    event_type: args.metricKey || "link_clicks",
    publicKey,
    programId: args.programId || context.env.BOOMIN_CONNECT_PROGRAM_ID,
    partner_ref: args.partnerRef,
    metric_key: args.metricKey || "link_clicks",
    amount: args.amount ?? 1,
    occurred_at: new Date().toISOString(),
    metadata: { source: "boomin_mcp", ...(args.metadata || {}) },
  });
  return postJson(`${context.connectApiBase}/events`, body, {
    "X-Boomin-Issuer": issuer,
    "X-Boomin-Signature": await signPayload(body, signingSecret),
  });
}

async function platformPost(path, args, context, requiredScope) {
  const token = args.token || context.platformToken;
  if (!token) {
    throw toolError("platform_token_required", `This tool requires ${requiredScope}.`, {
      requiredScope,
      suggestedCommand: `npx @boomin/cli token create --name MCP --scopes org:read,${requiredScope} --save`,
    });
  }
  return postJson(`${context.platformApiBase}${path}`, { ...args, token: undefined }, { Authorization: `Bearer ${token}` });
}

function defaultDryRun(args) {
  return { ...args, dryRun: args.dryRun !== false };
}

function generateReferralFiles(args = {}) {
  const files = referralFiles(args);
  const auth = args.auth || "custom";
  const currentUser = currentUserSnippet(auth);
  return [
    { path: files.joinRoute, content: joinRoute(currentUser) },
    { path: files.statusRoute, content: statusRoute(currentUser) },
    { path: files.redirectRoute, content: redirectRoute() },
    { path: files.page, content: partnerPage() },
  ];
}

function referralFiles(args = {}) {
  return {
    joinRoute: args.joinRoute || "app/api/boomin/partner/join/route.js",
    statusRoute: args.statusRoute || "app/api/boomin/partner/status/route.js",
    redirectRoute: args.redirectRoute || "app/r/[code]/route.js",
    page: args.page || "app/partner/page.jsx",
  };
}

function currentUserSnippet(auth) {
  if (auth === "clerk") {
    return `import { currentUser } from "@clerk/nextjs/server";

async function getCurrentUser() {
  const user = await currentUser();
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress;
  return email ? { externalUserId: user.id, email, name: user.fullName || email, metadata: { source: "clerk" } } : null;
}`;
  }
  if (auth === "supabase") {
    return `import { createClient } from "@/utils/supabase/server";

async function getCurrentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  return { externalUserId: user.id, email: user.email, name: user.user_metadata?.name || user.email, metadata: { source: "supabase" } };
}`;
  }
  return `async function getCurrentUser(request) {
  // Replace this with your app's server-side session lookup.
  const user = await yourAuthGetCurrentUser(request);
  if (!user) return null;
  return { externalUserId: user.id, email: user.email, name: user.name || user.email, metadata: { source: "custom" } };
}`;
}

function joinRoute(currentUser) {
  return `import { createBoominCreatorJoinHandler } from "@boomin/server/next";
${currentUser}

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

function statusRoute(currentUser) {
  return `import { getPartnerStanding } from "@boomin/server";
${currentUser}

export async function GET(request) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) return Response.json({ success: false, code: "unauthorized", message: "Sign in required." }, { status: 401 });
  const standing = await getPartnerStanding({
    publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
    programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
    issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
    signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
    externalUserId: currentUser.externalUserId,
  });
  return Response.json({ success: true, partner: standing.partners?.[0] || null, totals: standing.totals });
}
`;
}

function redirectRoute() {
  return `import { recordReferralClick } from "@boomin/server";

export async function GET(request, { params }) {
  const { code } = await params;
  try {
    await recordReferralClick({
      publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
      programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
      issuer: process.env.BOOMIN_HANDOFF_ISSUER || "your-app.com",
      signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
      partnerRef: code,
      eventId: \`link_click:\${code}:\${crypto.randomUUID()}\`,
      metadata: { sourceUrl: request.url, referrer: request.headers.get("referer") },
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

function partnerPage() {
  return `"use client";

import { useEffect, useState } from "react";

export default function PartnerPage() {
  const [partner, setPartner] = useState(null);
  useEffect(() => {
    fetch("/api/boomin/partner/status", { credentials: "include" })
      .then((response) => response.json())
      .then((data) => setPartner(data.partner || null))
      .catch(() => setPartner(null));
  }, []);
  if (!partner) return <main><a href="/api/boomin/partner/join">Join partner program</a></main>;
  const referral = partner.referral || { code: partner.referralCode, url: partner.referralLink };
  const metrics = partner.metrics || {};
  return (
    <main>
      <h1>Your partner program</h1>
      <input readOnly value={referral.url || ""} />
      <button onClick={() => navigator.clipboard.writeText(referral.url || "")}>Copy</button>
      <p>Code: {referral.code}</p>
      <dl>
        <dt>Clicks</dt><dd>{metrics.linkClicks || 0}</dd>
        <dt>Signups</dt><dd>{metrics.signups || 0}</dd>
        <dt>Sales</dt><dd>{metrics.sales || 0}</dd>
        <dt>GMV</dt><dd>{metrics.gmvCents || 0}</dd>
      </dl>
    </main>
  );
}
`;
}

function tool(name, description, inputSchema) {
  return { name, description, inputSchema: inputSchema || { type: "object", properties: {} } };
}

function programRefSchema() {
  return {
    type: "object",
    properties: {
      token: { type: "string" },
      programId: { type: "string" },
      publicKey: { type: "string" },
    },
  };
}

function requirementSchema(options = {}) {
  const schema = {
    type: "object",
    properties: {
      ...programRefSchema().properties,
      requirementId: { type: "string" },
      scope: { type: "string", enum: ["program_entry", "program_maintenance", "tier", "campaign", "benefit", "invite"] },
      scopeId: { type: "string" },
      metricKey: { type: "string", enum: ["followers", "views", "post_count", "link_clicks", "referral_count", "gmv_cents", "sales_count", "product_usage_count", "channel_connected", "manual_approval"] },
      operator: { type: "string", enum: ["gte", "lte", "eq", "neq", "exists"] },
      threshold: { type: "number" },
      required: { type: "boolean" },
      dryRun: { type: "boolean", default: true },
    },
  };
  if (options.update) schema.required = ["requirementId"];
  return schema;
}

function tierSchema(options = {}) {
  const schema = {
    type: "object",
    properties: {
      ...programRefSchema().properties,
      tierId: { type: "string" },
      name: { type: "string" },
      rank: { type: "number" },
      status: { type: "string", enum: ["active", "paused", "archived"] },
      dryRun: { type: "boolean", default: true },
    },
  };
  schema.required = options.update ? ["tierId"] : ["name", "rank"];
  return schema;
}

function normalizeSkillPacks(value) {
  const raw = Array.isArray(value) ? value : String(value || "referral_installer").split(",");
  const normalized = raw.map((item) => item.trim()).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : ["referral_installer"];
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, data);
  return data;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, data);
  return data;
}

function apiError(response, data) {
  return toolError(data.code || "api_error", data.message || `Boomin API failed with ${response.status}`, {
    status: response.status,
    requiredScope: data.requiredScope,
    response: data,
  });
}

function toolError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function errorPayload(error) {
  return {
    ok: false,
    code: error.code || "tool_error",
    message: error.message || String(error),
    status: error.status,
    requiredScope: error.requiredScope,
    suggestedCommand: error.suggestedCommand,
    reauthorizeUrl: error.reauthorizeUrl,
  };
}

function mcpToolResult(data, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function exists(file, fs) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function signPayload(payload, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stableJson(payload)));
  return base64Url(new Uint8Array(signature));
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortObject(nested)]));
}

function removeEmpty(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function strip(value) {
  return String(value || "").replace(/\/+$/, "");
}

import { leadTrackingMigration } from "./postgres.js";

/** Shared, pure file generator used by CLI and hosted MCP installers. */
export function leadTrackingFiles(options = {}) {
  const authSnippet = options.authSnippet || `async function getCurrentUser() {
  // Connect your verified server-side session. Never trust a JSON customer ID.
  throw new Error("Wire getCurrentUser to the application's authentication provider.");
}`;
  const sql = leadTrackingMigration({ customerTable: options.customerTable, customerIdColumn: options.customerIdColumn });
  const redirectPath = options.redirectRoute || "app/r/[code]/route.js";
  if (redirectPath.startsWith("/") || redirectPath.split("/").includes("..") || !redirectPath.endsWith("/route.js")) {
    throw new Error("redirectRoute must be a relative route.js path inside the application.");
  }
  const redirectImport = "../".repeat(redirectPath.split("/").length - 1) + "lib/boomin-leads";
  return {
    "lib/boomin-lead-hooks.js": `// Configure these hooks before enabling tracking. Keep this module server-only.
// Adapt your existing pg/Neon/Drizzle client; return rows or { rows }.
export async function boominLeadQuery(text, params) {
  throw new Error("Wire boominLeadQuery to the application's PostgreSQL client.");
}

${authSnippet}

export async function getCurrentCustomer(request) {
  const user = await getCurrentUser(request);
  return user ? { customerId: user.externalUserId } : null;
}
`,
    "lib/boomin-leads.js": `import "server-only";
import { createLeadTracker } from "@boomin/sdk/leads";
import { createPostgresLeadStore } from "@boomin/sdk/leads/postgres";
import { boominLeadQuery } from "./boomin-lead-hooks";

export function getLeadRuntime() {
  const store = createPostgresLeadStore({ query: boominLeadQuery });
  const tracker = createLeadTracker({
    store,
    issuer: process.env.BOOMIN_HANDOFF_ISSUER,
    apiBase: process.env.BOOMIN_CONNECT_API_BASE,
    programs: [{ key: "primary", publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
      programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
      signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET }],
  });
  return { store, tracker };
}
`,
    "lib/boomin-attribution.js": `import { createAttribution } from "@boomin/sdk/attribution";

export const attribution = createAttribution();

// Call capture() on landing. Call this only after confirmed authentication,
// for BOTH OTP and OAuth flows. Retry failures; clear only after durable ACK.
export async function reportConfirmedSignup() {
  const response = await fetch("/api/boomin/leads/signup", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referralCode: attribution.get()?.referralCode }),
  });
  if (!response.ok) throw new Error("Signup attribution is pending. Retry after authentication.");
  attribution.clear();
}
`,
    "app/api/boomin/leads/signup/route.js": `import { createLeadSignupHandler } from "@boomin/sdk/leads/next";
import { getLeadRuntime } from "../../../../../lib/boomin-leads";
import { getCurrentCustomer } from "../../../../../lib/boomin-lead-hooks";

export async function POST(request) {
  const { tracker } = getLeadRuntime();
  return createLeadSignupHandler({ tracker, getCurrentCustomer,
    allowedOrigins: [new URL(process.env.NEXT_PUBLIC_APP_URL).origin] })(request);
}
`,
    [redirectPath]: `import { createReferralRedirectHandler } from "@boomin/sdk/leads/next";
import { getLeadRuntime } from "${redirectImport}";

export async function GET(request, context) {
  const { tracker } = getLeadRuntime();
  return createReferralRedirectHandler({ tracker,
    destinationUrl: process.env.BOOMIN_REFERRAL_DESTINATION_URL || process.env.NEXT_PUBLIC_APP_URL,
    onError: () => console.error("Referral click could not be persisted.") })(request, context);
}
`,
    "app/api/boomin/leads/deliver/route.js": `import { getLeadRuntime } from "../../../../../lib/boomin-leads";

// Schedule every five minutes. A dedicated server-side token protects the job.
export async function POST(request) {
  const token = process.env.BOOMIN_LEAD_CRON_TOKEN;
  if (!token || request.headers.get("authorization") !== \`Bearer \${token}\`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { tracker } = getLeadRuntime();
  return Response.json(await tracker.deliver());
}
`,
    "boomin/lead-tracking.sql": sql,
    "boomin/LEAD_SETUP.md": `# Complete lead tracking setup

Install @boomin/sdk >=1.0.0-beta.8 and @boomin/server >=0.3.0.

1. Wire lib/boomin-lead-hooks.js to the existing database and verified auth session.
2. Review and apply boomin/lead-tracking.sql to the brand's database.
${options.customerTable ? `   A trigger opens signup eligibility only for new rows in ${options.customerTable}. Existing rows stay closed.` : "   Choose the actual AUTH CUSTOMER table and regenerate with --customer-table <schema.table> --customer-id-column <column>, or call store.openSignup({customerId, createdAt}) from a verified new-account event inside its creation transaction. Never call it on login."}
3. Mount attribution.capture() on landing; call reportConfirmedSignup() after confirmed OTP/OAuth signup.
4. Set NEXT_PUBLIC_APP_URL, BOOMIN_REFERRAL_DESTINATION_URL and server-only BOOMIN_HANDOFF_ISSUER, BOOMIN_HANDOFF_SIGNING_SECRET, BOOMIN_CONNECT_PUBLIC_KEY, BOOMIN_CONNECT_PROGRAM_ID.
5. Set a random server-only BOOMIN_LEAD_CRON_TOKEN; schedule an authenticated POST to /api/boomin/leads/deliver every five minutes.
6. Expose store.deliveryStatus() through your existing ADMIN-authenticated UI, never publicly.
7. Verify first-touch, organic signup, returning-user dedupe, program routing and outage recovery before marking installation complete.

Delivery status tracks attribution, not payout eligibility. Define qualified leads in your own verified business logic; call tracker.recordQualifiedLead() with a stable event ID and a configured x: metric. Use a separate tablePrefix/store for each brand sharing a database. Browser capture is scoped to an origin and device.

Managed custom domains and Stripe purchase tracking are separate extensions.
`,
  };
}

# Lead tracking on the brand's existing domain

`@boomin/sdk/attribution` captures a creator referral in the browser.
`@boomin/sdk/leads` persists new-customer attribution and delivers signed click,
signup and custom qualified-lead events. The PostgreSQL adapter owns an outbox in
the brand's database. No DNS change is needed for `https://brand.com/r/alice`.

## Agent installation

```sh
npm install @boomin/sdk@1.0.0-beta.8 @boomin/server@^0.3.0
npx @boomin/cli@0.9.0 referral init --framework next --auth custom \
  --customer-table auth.users --customer-id-column id --write
```

Use the actual authenticated customer table and ID column, not a profile table
that returning users can create later. Preview with `--json`; existing generated
files require explicit `--yes` before overwrite. Clerk and Supabase auth are
supported; agents must adapt custom auth and the application's database client.
Hosted MCP's `boomin_scaffold_referral_first` generates the same lead files and
accepts `customerTable` and `customerIdColumn`.

Read the generated `boomin/LEAD_SETUP.md`. Files alone do not finish an install:
wire DB/auth hooks, apply the reviewed migration, mount landing capture, call the
signup endpoint after verified OTP and OAuth authentication, and schedule the
protected delivery endpoint every five minutes. Add delivery status to an
existing authenticated admin interface. Both CLI doctor and MCP verification
explicitly identify runtime checks they cannot prove from files.

## Framework-independent use

```js
// Browser module. Never import server configuration here.
import { createAttribution } from "@boomin/sdk/attribution";
const attribution = createAttribution();
attribution.capture();
// After confirmed authentication: send attribution.get()?.referralCode to your
// own authenticated signup endpoint. Clear only after its durable acknowledgment.
```

```js
// Server module: provide your existing pg, Neon, or transaction client.
import { createLeadTracker } from "@boomin/sdk/leads";
import { createPostgresLeadStore } from "@boomin/sdk/leads/postgres";
const store = createPostgresLeadStore({ query: (sql, params) => db.query(sql, params) });
const tracker = createLeadTracker({
  store, issuer: "brand.com",
  programs: [{ key: "creators", publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
    programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
    signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET }],
});
await tracker.recordSignup({ customerId: verifiedSession.user.id, referralCode });
await tracker.deliver(); // Scheduled server job; never a public unauthenticated endpoint.
```

Generate `leadTrackingMigration({customerTable, customerIdColumn})`, review it,
then apply it with the application's migration tooling. The new-account trigger
opens a 30-minute capture boundary atomically at account creation. Existing
accounts are never backfilled. Without a trigger, call `store.openSignup` only
from a verified account-creation event using its original creation timestamp,
inside that transaction; never reopen eligibility on login. IDs must match the
server session's customer ID. Organic capture consumes the boundary too.

Tracking tables and the trigger function use an explicit `storageSchema`
(default `public`); create another schema before selecting it. The trigger runs
with the migration owner's permissions and a fixed `pg_catalog` search path,
so restricted auth roles can insert accounts without direct access to tracking
tables. Review the function owner when applying the migration.

## Attribution and delivery contract

- First syntactically valid browser referral wins for 30 days. Later links do
  not overwrite it or extend its lifetime. Browser storage is per origin/device;
  blocked storage falls back to memory and preserves `ref` in the URL.
- The authenticated endpoint derives identity from the session, validates its
  allowed origin, and ignores client customer IDs/program selection. A successful
  response acknowledges durable capture or a closed/organic boundary, not a
  credited Boomin metric. Keep signup attribution pending on database failure.
- Server rosters select exactly one configured program. Unknown or ambiguous
  codes become `invalid`; failed roster reads remain `pending`. Customer
  attribution is saved before event delivery and cannot move to another program.
- Signup event IDs are stable (`signup:<issuer>:<customerId>`). Outbox leases and
  exponential retry make delivery **at least once**; Boomin's event-ID deduplication
  prevents repeat credit after an acknowledgment is lost. Random click IDs identify
  individual visits; retries of the same queued click retain the ID.
- A database outage can prevent click capture; redirect navigation still succeeds.
  This is not a claim that every browser or bot visit is a verified human lead.
- Use separate `tablePrefix` stores for different brands sharing a database.
  Configure all candidate programs for that brand; secrets stay server-side.

Qualified lead definitions belong to the brand. Use verified business facts and
a configured metric such as `x:qualified_leads`, then call
`recordQualifiedLead({customerId, eventId, programKey, metricKey})`. Persist the
qualification in your business database and reconcile after attribution if it
occurs before signup capture; the tracker cannot infer an earlier fact. Replays
use the same event ID. Never accept qualification from browser JSON.

## Verification before rollout

Rehearse with isolated customers: referred OTP signup, referred OAuth signup,
organic signup then a later link, existing-account login, repeat/concurrent
capture, unknown and ambiguous codes, multiple programs, qualified facts before
and after capture, unavailable roster/event API, and expired delivery leases.
Compare immutable customer attribution, local delivery status, and Boomin's
metric ledger. Synthetic test credit is not proof of a genuine production signup.

Managed subdomains/custom domains and Stripe purchase events are separate
extensions; this package does not provision DNS or forward purchases.

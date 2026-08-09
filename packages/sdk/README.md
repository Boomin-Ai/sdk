# @boomin/sdk

The Boomin platform SDK — programmable distribution infrastructure. A
**Distribution** is a coordinated business objective (Boomin's PaymentIntent)
that fans out into concrete **Deployments** — one per execution channel: a
partner program (whose enrolled partners each carry their own link on it), an
owned channel, or paid media.

Built on `fetch` + WebCrypto only: works on Node >= 18, Cloudflare Workers,
Bun, Deno, browsers, and edge runtimes. Zero dependencies, zero Node builtins.

```sh
npm install @boomin/sdk
```

## Quickstart

```js
import Boomin from "@boomin/sdk";

const boomin = new Boomin(process.env.BOOMIN_SECRET_KEY);

// 1. Invite a partner into a program (enrollment payload carries the program)
const enrollment = await boomin.enrollments.create({
  program: "prog_123",
  email: "creator@example.com",
});
await boomin.enrollments.approve(enrollment.id);

// 2. Draft a distribution against that program (`name` is required)
const distribution = await boomin.distributions.create({
  name: "Spring launch",
  objective: "acquisition",
  programs: ["prog_123"],
  spec: { enrollment_policy: "all_approved" },
});

// 3. Validate, then launch — launch is ALWAYS async (202 + operation).
//    `operation` here is an id STRING, not an object.
await boomin.distributions.validate(distribution.id);
const { operation } = await boomin.distributions.launch(distribution.id);
const settled = await boomin.operations.wait(operation, { timeout: 120000 });
console.log(settled.status); // "succeeded" | "partial" | "failed" | "canceled"
```

`operations.wait()` accepts either form — the id string that `launch` returns,
or the operation object that `pause`/`resume`/`cancel` return alongside their
resource.

### Field naming

**The SDK is camelCase in both directions.** You write camelCase params, and
you read camelCase properties back. The REST wire is snake_case; translating is
the SDK's job, not yours.

```js
const event = await boomin.performance.events.create(
  { deployment: "dep_123", type: "sale", valueMinor: 4999 }, // → value_minor
  { idempotencyKey: "evt_123" },                             // → Idempotency-Key header
);

event.valueMinor; // 4999      ← wire field value_minor
event.receivedAt; //           ← wire field received_at
```

Requests convert by **declared schema**, not by guesswork. The nested structures
the API owns — `subjects[]` and `budget` on `distributions.create/update` —
convert too:

```js
await boomin.distributions.create({
  name: "Spring launch",
  subjects: [{ kind: "event", id: "…", role: "primary" }],
  budget: { mode: "funded", asset: "credit", totalMinor: 10000 }, // → total_minor
});
```

**Your payloads are never renamed, in either direction.** These fields are
opaque: their keys round-trip byte-identical, at any depth.

`metadata` · `properties` · `spec` · `permissions` · `rights` ·
`compensationDefaults` · `desiredState` · `observedState` · `externalIds` ·
`stats`

```js
await boomin.performance.events.create({
  deployment: "dep_123", type: "sale",
  properties: { orderId: "1001", customerTier: "gold" }, // stored exactly so
});
```

Snake_case params are still accepted — but **only one spelling per field**.
Sending both throws before the request is issued:

```js
boomin.webhooks.endpoints.create({
  url: "https://example.com/hook",
  enabledEvents: ["payout.settled"],
  enabled_events: ["distribution.live"],
});
// ConflictingParametersError (code: conflicting_parameters)
//   "enabledEvents" and "enabled_events" refer to the same API field.
```

The v1 API also rejects fields it does not recognize (`400 invalid_request`,
naming the field and, where it can tell, the field you meant) rather than
dropping them — so a typo is never a silent no-op.

Need the wire objects verbatim (proxying, logging)? Construct the client with
`rawResponses: true` and every response comes back in its snake_case form.
Request conversion is unaffected.

### Client options

```js
const boomin = new Boomin("sk_live_...", {
  baseUrl: "https://api.boomin.ai", // API origin (paths live under /v1/platform)
  brand: "acme",                    // brand id or slug; threads Boomin-Brand
  maxRetries: 2,                    // retries on 429/5xx (idempotent requests only)
  timeout: 30000,                   // per-request timeout, ms
  rawResponses: false,              // true → snake_case wire objects, unconverted
});
```

Every method accepts trailing per-call options:

```js
await boomin.distributions.launch(id, {}, {
  idempotencyKey: "launch-2026-08-01", // otherwise auto-generated per mutation
  brand: "acme-eu",                    // per-call Boomin-Brand override
  timeout: 10000,
  maxRetries: 0,
});
```

### Idempotency is header-canonical

Every mutation carries an `Idempotency-Key` header — auto-generated per call,
or yours via the per-call option above. **There is no body idempotency field.**
Writing `idempotencyKey` into a *params* object makes it an unknown body field,
and the API answers `400 invalid_request`:

```js
// ✗ 400 — idempotency_key is not a body field
await boomin.distributions.create({ name: "Spring launch", idempotencyKey: "k" });

// ✓ header
await boomin.distributions.create({ name: "Spring launch" }, { idempotencyKey: "k" });
```

The same option supplies `performance.events.create` its ingest identity, so
one concept covers HTTP replay and measurement de-duplication.

Nothing mutates as a side effect of inspection: `distributions.validate(id)` is
the non-mutating way to check a distribution before you launch it.

### Pagination

List calls resolve one page (`{ object: "list", data, hasMore }` — the wire's
`has_more`, camelCased like everything else) and are also async-iterable across
every page:

```js
const page = await boomin.partnerships.list({ limit: 20 });
page.hasMore; // boolean

for await (const enrollment of boomin.enrollments.list({ program: "prog_123" })) {
  // auto-pagination via starting_after
  enrollment.approvalStatus; // ← wire field approval_status
}
```

### Errors

```js
import { OperationConflictError, FundingRequiredError } from "@boomin/sdk/errors";

try {
  await boomin.distributions.launch(id);
} catch (err) {
  if (err instanceof OperationConflictError) {
    // a live operation already holds this subject (code: operation_conflict)
  } else if (err instanceof FundingRequiredError) {
    // fund the brand wallet, the launch operation waits (code: funding_required)
  } else if (err.code === "band_limit_reached") {
    // upgrade the partner band
  }
}
```

All errors extend `BoominError` (`code`, `status`, `requestId`). Subclasses:
`AuthenticationError`, `PermissionError`, `InvalidRequestError`,
`RateLimitError`, `ConflictError`, `APIError`, plus distinctly typed
`OperationConflictError`, `BandLimitReachedError`, `FundingRequiredError`,
`ConflictingParametersError`, and `WebhookSignatureVerificationError`.

Payout configuration adds five, for the conditions a script actually branches
on: `PayoutRulesRequiredError` (nothing configured — *not* nothing owed),
`PayoutRailRequiredError` (no active rail; nothing is auto-provisioned),
`PayoutRailAlreadyExistsError` (create is not upsert — call `update`),
`ImmutableParameterError` (rule economics are frozen; `param` names the
concept), `PayoutBatchEmptyError` and `PayoutBatchStateError` (the batch's
status forbids this transition — read it and look at `status`). Everything else
in the payout registry — `payout_rule_not_found`, `payout_rail_not_found`,
`payout_export_format_invalid`, `payout_export_unconfigured` — arrives on its
status-derived class and is matched by `code`.

`ConflictingParametersError` is the one raised **client-side, before anything is
sent** — `status` is `null`, `param` names the camelCase spelling and
`conflictsWith` its snake_case twin. It extends `InvalidRequestError`, so an
existing 400-family catch keeps working.

### Payouts

Money-out is one primitive with three parts, and the client nests exactly like
the REST tree: `payouts.rules` (how a partner **earns**), `payouts.rails` (how
money physically **leaves**), `payouts.batches` (one frozen disbursement run).
There is no root `payoutRules` / `payoutRails` client.

```js
// 1. A rail — how money leaves. Create is CREATE, not upsert: a second create
//    for a configured rail throws PayoutRailAlreadyExistsError rather than
//    silently rewriting where your money lands.
const rail = await boomin.payouts.rails.create({
  rail: "csv_batch",
  isDefault: true,
  config: {
    format: "paypal_payouts_csv", // required on csv_batch — PayPal's and Wise's
                                  // column sets differ, so there is no default
    walletFunded: false,
    columns: [                    // YOUR data — see below
      { key: "email",  header: "Email Address" },
      { key: "amount", header: "Amount" },
    ],
  },
});

// 2. A rule — how a partner earns. Money is *Minor, never cents.
const rule = await boomin.payouts.rules.create({
  name: "Registration CPA",
  type: "cpa",                                       // revenue_split | cpa | threshold_bonus
  scope: { type: "program", program: "prog_123" },   // discriminated, never applies_to/scope_id
  metricKey: "event_registration",
  perUnitMinor: 500,                                 // ← wire field per_unit_minor
});

// 3. Run the period, then export.
const run = await boomin.payouts.run({ periodStart: "2026-08-01", periodEnd: "2026-09-01" });
run.outcome;        // "payouts_created" | "no_eligible_activity"  ← branch on THIS
run.payoutsCreated; // …not on a count
run.summary.totalAmountMinor;

const accepted = await boomin.payouts.exportCsv({ periodStart: "2026-08-01" });
await boomin.operations.wait(accepted.operation);
const batch = await boomin.payouts.batches.retrieve(accepted.batch);
batch.downloadUrl;  // presigned, RE-MINTED on every read

// 4. Tell Boomin what the provider actually did.
await boomin.payouts.batches.confirm(batch.id, {
  externalBatchRef: "PAYPAL-2026-08",  // same ref replays one operation — a retry
  results: [{ item: "pbi_1", status: "paid" }],  // after a timeout can't pay twice
});
```

**`config.columns` is your data, and it round-trips byte-identical.** The SDK
converts camelCase to the snake_case wire everywhere else, but every key,
header string and array position inside `columns` is sent and returned exactly
as you wrote it. That is not politeness: those headers are the file your bank
ingests, and a "helpfully" re-cased header is a different file. `config.format`
and `config.walletFunded` are the API's own fields and convert normally.

Three shapes worth knowing before you script against them:

- **`run` distinguishes "misconfigured" from "nothing owed".** A brand with no
  active rule and no active content split throws `PayoutRulesRequiredError`
  (409). A brand that is configured but had no qualifying activity **succeeds**
  with `outcome: "no_eligible_activity"`. Treating those alike pays nobody and
  reports success.
- **`exportCsv` and `batches.export` are 202s** resolving
  `{ batch, status, operation }` as id **strings**. No `downloadUrl` — it lives
  on `batches.retrieve()`, re-minted per read instead of expiring in a body.
- **A rule's economics are immutable.** `rules.update` takes `name` and
  `status` only; anything else throws `ImmutableParameterError` naming the
  frozen concept. To change money: create a replacement rule, activate it, then
  `rules.archive(old)`. Archive is the only removal verb — a hard delete would
  cascade the ledger rows the rule produced, erasing the record of money that
  was actually paid.

### Webhooks

Verify `Boomin-Signature: t=<ts>,v1=<hmac>` (HMAC-SHA256, WebCrypto — note
`constructEvent` is async). Pass the RAW request body, never a re-parse.

```js
import { constructEvent } from "@boomin/sdk/webhooks"; // or Boomin.webhooks.constructEvent

export default {
  async fetch(request, env) {
    const payload = await request.text();
    const event = await constructEvent(
      payload,
      request.headers.get("Boomin-Signature"),
      env.BOOMIN_WEBHOOK_SECRET, // or [oldSecret, newSecret] during rotation
      { tolerance: 300 },
    );
    // Verified events are camelCased like every other SDK value.
    if (event.type === "distribution.live") {
      event.data.object.planHash; // ← wire field plan_hash
    }
    return new Response("ok");
  },
};
```

Endpoint management lives on the instance. The signing secret is revealed once,
on create (and again on `rotateSecret`) — store it then, or you will have to
rotate to see another:

```js
const endpoint = await boomin.webhooks.endpoints.create({
  url: "https://example.com/webhooks/boomin",
  enabledEvents: ["distribution.live", "payout.settled"],
});
console.log(endpoint.id, endpoint.secret); // whsec_… — shown ONLY here
console.log(endpoint.enabledEvents);       // ← wire field enabled_events
```

`enabledEvents: []` (or omitting it) subscribes the endpoint to **every** public
event type. Then `.list()`, `.retrieve()`, `.update()`, `.rotateSecret()`, `.del()`.

## Resource clients

| Client | Methods |
| --- | --- |
| `programs` | `create` `retrieve` `update` `list` + nested `requirements` / `tiers` (CRUD) / `connectConfig` / `handoffConfig` (retrieve, update) |
| `partners` | `retrieve` `list` |
| `partnerships` | `list` `retrieve` `pause` `resume` `end` `updatePermissions` |
| `enrollments` | `create` (invite) `approve` `reject` `pause` `resume` `list` `retrieve` |
| `distributions` | `create` `update` `retrieve` `list` `validate` `launch` `pause` `resume` `cancel` |
| `deployments` | `retrieve` `list` `pause` `resume` `cancel` |
| `connections` | `list` `retrieve` `revoke` |
| `performance` | `summary` + `events.create` (measurement ingestion IN) |
| `events` | `list({ type?, startingAfter? })` (operational feed OUT) |
| `operations` | `retrieve` `list` `wait(operationOrId, { timeout })` |
| `webhooks` | `endpoints.create/retrieve/update/list/del` + static `Boomin.webhooks.constructEvent` |
| `payouts` | `list` `run` `exportCsv` `connectStatus` + nested `rules.create/retrieve/list/update/archive`, `rails.create/retrieve/list/update`, `batches.create/retrieve/list/export/confirm/cancel` |

`resume` is the canonical verb on every surface — never `unpause`.

## Contributing

`src/casing.js` is the single boundary between camelCase and the snake_case
wire. When the API grows a new **nested** request structure, declare it in
`REQUEST_FIELD_MAP` there; when it grows a new customer-owned free-form blob,
declare it in `RESPONSE_FIELD_MAP` (which computes `OPAQUE_FIELDS`). Nothing
else in the package makes a casing decision.

A field can be both, and `payout_rail.config` is the worked example: the object
is API-owned (so `walletFunded` must convert) while `columns` inside it is the
customer's (so it must not). Declaring only one half is a bug in either
direction — one 400s a valid call, the other silently rewrites a bank file.

## License

MIT

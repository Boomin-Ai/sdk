# @boomin/sdk

The Boomin platform SDK — programmable distribution infrastructure. A
**Distribution** is a coordinated business objective (Boomin's PaymentIntent)
that fans out into concrete **Deployments** executed by partners, owned
channels, and paid media.

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
const event = await boomin.performance.events.create({
  deployment: "dep_123",
  type: "sale",
  valueMinor: 4999,          // → value_minor on the wire
  idempotencyKey: "evt_123", // → idempotency_key
});

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

`ConflictingParametersError` is the one raised **client-side, before anything is
sent** — `status` is `null`, `param` names the camelCase spelling and
`conflictsWith` its snake_case twin. It extends `InvalidRequestError`, so an
existing 400-family catch keeps working.

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
| `payouts` | `list` `run` `exportCsv` `connectStatus` + `batches.list/retrieve` |

`resume` is the canonical verb on every surface — never `unpause`.

## Contributing

`src/casing.js` is the single boundary between camelCase and the snake_case
wire. When the API grows a new **nested** request structure, declare it in
`REQUEST_FIELD_MAP` there; when it grows a new customer-owned free-form blob,
add it to `OPAQUE_FIELDS`. Nothing else in the package makes a casing decision.

## License

MIT

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

// 2. Draft a distribution against that program
const distribution = await boomin.distributions.create({
  objective: "acquisition",
  programs: ["prog_123"],
  spec: { enrollment_policy: "all_approved" },
});

// 3. Validate, then launch — launch is ALWAYS async (202 + operation)
await boomin.distributions.validate(distribution.id);
const { operation } = await boomin.distributions.launch(distribution.id);
const settled = await boomin.operations.wait(operation.id, { timeout: 120000 });
console.log(settled.status); // "succeeded" | "partial" | "failed" | "canceled"
```

### Client options

```js
const boomin = new Boomin("sk_live_...", {
  baseUrl: "https://api.boomin.ai", // API origin (paths live under /v1/platform)
  brand: "brand_123",               // threads the Boomin-Brand header
  maxRetries: 2,                    // retries on 429/5xx (idempotent requests only)
  timeout: 30000,                   // per-request timeout, ms
});
```

Every method accepts trailing per-call options:

```js
await boomin.distributions.launch(id, {}, {
  idempotencyKey: "launch-2026-08-01", // otherwise auto-generated per mutation
  brand: "brand_456",                  // per-call Boomin-Brand override
  timeout: 10000,
  maxRetries: 0,
});
```

### Pagination

List calls resolve one page (`{ object: "list", data, has_more }`) and are also
async-iterable across every page:

```js
const page = await boomin.partnerships.list({ limit: 20 });

for await (const enrollment of boomin.enrollments.list({ program: "prog_123" })) {
  // auto-pagination via starting_after
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
`OperationConflictError`, `BandLimitReachedError`, `FundingRequiredError`, and
`WebhookSignatureVerificationError`.

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
    if (event.type === "distribution.live") { /* ... */ }
    return new Response("ok");
  },
};
```

Endpoint management lives on the instance: `boomin.webhooks.endpoints.create({ url, enabledEvents })`, `.list()`, `.update()`, `.del()`.

## Resource clients

| Client | Methods |
| --- | --- |
| `programs` | `create` `retrieve` `update` `list` + nested `requirements` / `tiers` (CRUD) / `connectConfig` / `handoffConfig` (retrieve, update) |
| `partners` | `retrieve` `list` |
| `partnerships` | `list` `retrieve` `pause` `resume` `end` `updatePermissions` |
| `enrollments` | `create` (invite) `approve` `reject` `pause` `resume` `list` `retrieve` |
| `distributions` | `create` `update` `retrieve` `list` `validate` `launch` `pause` `resume` `cancel` |
| `deployments` | `retrieve` `list` |
| `connections` | `list` `retrieve` `revoke` |
| `performance` | `summary` + `events.create` (measurement ingestion IN) |
| `events` | `list({ type?, startingAfter? })` (operational feed OUT) |
| `operations` | `retrieve` `list` `wait(id, { timeout })` |
| `webhooks` | `endpoints.create/retrieve/update/list/del` + static `Boomin.webhooks.constructEvent` |
| `payouts` | `list` `run` `exportCsv` `connectStatus` + `batches.list/retrieve` |

`resume` is the canonical verb on every surface — never `unpause`.

## License

MIT

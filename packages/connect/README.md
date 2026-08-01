# @boomin/connect

Browser SDK for Boomin Partner Connect.

```bash
npm install @boomin/connect
```

## Breaking change in 0.2.0

`joinProgram` no longer accepts an `email`. A member is only created for an email that has
actually been proven, so joining now requires a partner token. The API rejects tokenless
joins, and the SDK refuses to send one — `joinProgram()` without a token rejects immediately
with `error.code === "missing_partner_token"` instead of making a doomed request.

Migration: replace `joinProgram({ email })` with the verify-then-join flow below.

## The flow: requestOtp → verifyOtp → joinProgram

```js
import Boomin from "@boomin/connect";

Boomin.init({
  publicKey: import.meta.env.VITE_BOOMIN_PUBLIC_KEY,
  programId: import.meta.env.VITE_BOOMIN_PROGRAM_ID,
  apiBase: import.meta.env.VITE_BOOMIN_API_BASE,
  redirectUri: window.location.origin + window.location.pathname,
});

// 1. Email a one-time code.
await Boomin.requestOtp({ email: "partner@example.com", name: "Partner" });

// 2. Exchange the code for a partner token. The SDK stores it for you.
await Boomin.verifyOtp({ email: "partner@example.com", code: "123456" });

// 3. Join, authenticated as the verified partner.
await Boomin.joinProgram({ name: "Partner" });

// Optional: link a channel.
await Boomin.connectInstagram({ requireCreator: true });
```

If you hold a partner token from somewhere else — a signed server handoff, for example —
pass it explicitly and skip steps 1 and 2:

```js
await Boomin.joinProgram({ authToken: tokenFromHandoff });
```

Referral-first apps can read the same status shape:

```js
const status = await Boomin.getProgramStatus();
console.log(status.referral?.url, status.metrics?.linkClicks);
```

For CLI setup, use:

```bash
npx @boomin/cli init
```

The CDN global remains:

```html
<script src="https://cdn.boomin.ai/boomin-connect.js"></script>
```

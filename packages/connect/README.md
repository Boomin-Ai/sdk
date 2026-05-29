# @boomin/connect

Browser SDK for Boomin Partner Connect.

```bash
npm install @boomin/connect
```

```js
import Boomin from "@boomin/connect";

Boomin.init({
  publicKey: import.meta.env.VITE_BOOMIN_PUBLIC_KEY,
  programId: import.meta.env.VITE_BOOMIN_PROGRAM_ID,
  apiBase: import.meta.env.VITE_BOOMIN_API_BASE,
  redirectUri: window.location.origin + window.location.pathname,
});

await Boomin.joinProgram({ email: "partner@example.com", name: "Partner" });
await Boomin.connectInstagram({ requireCreator: true });
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

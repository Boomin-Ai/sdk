# @boomin/components

Components by Boomin — UI that Boomin delivers at runtime and you mount inside
your own product. Fixes ship from Boomin; you never redeploy for them.

```bash
npm install @boomin/components
```

## `@boomin/components/console` — the org-admin console

The same Brand Settings the Boomin web app shows under the brand gear —
Payments (Stripe Connect, wallet, deal funding), Integrations, Members, API
keys, Billing — rendered inside your page in a shadow root.

```js
import { mountConsole } from "@boomin/components/console";

const handle = await mountConsole(document.getElementById("boomin-console"), {
  handoff: code,                  // one-time code from your backend (below)
  brand: "acme",                  // the brand slug the console acts as
  section: "payments",            // general | kit | integrations | members | payments | billing | developer | danger
  theme: "dark",                  // or { mode: "light", primary: "#0f766e", radius: "0.75rem", ... }
  onExternal: (url) => window.open(url, "_blank"), // Stripe onboarding / Checkout / dashboard
  onNavigate: (section) => history.replaceState(null, "", `#${section}`),
});

handle.navigate("members");
handle.unmount();
```

### Getting a handoff code

The console signs in with a **one-time, 60-second code** so your page never
holds a Boomin session. Mint it server-side with your platform key:

```js
import Boomin from "@boomin/sdk";
const boomin = new Boomin(process.env.BOOMIN_SECRET_KEY, { brand: "acme" });
const { code } = await boomin.consoleSessions.create({ email: user.email });
// → hand `code` to the page that calls mountConsole
```

The email must already belong to a member of the organization your key
belongs to. The console never widens access — it renders exactly what that
person could do on boomin.ai.

### Script tag

```html
<script src="https://boomin.ai/components/v1.js"></script>
<script>
  Boomin.components.mount("console", document.getElementById("boomin-console"), { handoff, brand: "acme" });
</script>
```

### Theming

The console reads shadcn-named CSS variables from the element you mount it
into — `--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--border`, `--radius`, … — so it inherits your design system when you set
them on the host element, or takes them from the `theme` option.

### Self-serving the bundles

`dist/components.js` and `dist/console.js` are the same files boomin.ai
serves. Host them yourself and pass `{ base: "https://your-cdn.example" }` if
your CSP cannot allow boomin.ai.

## Contract

`Boomin.components.contract` is `1`. Breaking changes to the mount API bump
the path (`/components/v2.js`) and this package's major.

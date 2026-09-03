# boominjs

`boominjs` is Components by Boomin — an alias of [`@boomin/components`](https://www.npmjs.com/package/@boomin/components). Same code, shorter name.

```bash
npm install boominjs
```

```js
import { mountConsole } from "boominjs/console";
await mountConsole(document.getElementById("boomin-console"), { handoff, brand: "acme", section: "payments" });
```

See `@boomin/components` for the full README (handoff codes via `@boomin/sdk` `consoleSessions.create`, theming, self-serving the bundles).

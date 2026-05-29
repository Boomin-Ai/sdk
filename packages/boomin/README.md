# boominjs

Temporary compatibility wrapper for the scoped Boomin packages.

Use these packages for new integrations:

```bash
npm install @boomin/connect
npx @boomin/cli init
```

```js
import Boomin from "@boomin/connect";
```

Server-side signed handoff lives in `@boomin/server`:

```js
import { createBoominCreatorJoinHandler } from "@boomin/server/next";
```

This package is not the marketed integration surface.

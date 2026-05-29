# @boomin/server

Server helpers for Boomin signed handoff and server-to-server metric events.

```bash
npm install @boomin/server
```

```js
import { createBoominCreatorJoinHandler } from "@boomin/server/next";

export const GET = createBoominCreatorJoinHandler({
  publicKey: process.env.BOOMIN_PUBLIC_KEY,
  programId: process.env.BOOMIN_PROGRAM_ID,
  signingSecret: process.env.BOOMIN_SIGNING_SECRET,
  issuer: "your-app.com",
  redirectUri: "https://your-app.com/creator-program",
  getCurrentUser: async () => ({
    externalUserId: "user_123",
    email: "partner@example.com",
    name: "Partner",
  }),
});
```

Never expose handoff signing secrets in browser code.

## Referral metrics

```js
import { getPartnerStanding, recordReferralClick, recordSale, recordSignup } from "@boomin/server";

await recordReferralClick({
  publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
  programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
  issuer: process.env.BOOMIN_HANDOFF_ISSUER,
  signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
  partnerRef: "ABC123",
});

await recordSale({
  publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
  programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
  issuer: process.env.BOOMIN_HANDOFF_ISSUER,
  signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
  partnerRef: "ABC123",
  saleCount: 1,
  gmvCents: 4900,
});

const standing = await getPartnerStanding({
  publicKey: process.env.BOOMIN_CONNECT_PUBLIC_KEY,
  programId: process.env.BOOMIN_CONNECT_PROGRAM_ID,
  issuer: process.env.BOOMIN_HANDOFF_ISSUER,
  signingSecret: process.env.BOOMIN_HANDOFF_SIGNING_SECRET,
  externalUserId: "user_123",
});
```

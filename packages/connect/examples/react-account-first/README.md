# @boomin/connect React Account-first Demo

This is the canonical customer-style demo for:

```bash
npm install @boomin/connect
npx @boomin/cli init
```

```bash
npm install
npm run dev
```

If you skip the CLI init, copy your values from Boomin Program Settings > Developer Setup:

```bash
cp .env.example .env
VITE_BOOMIN_PUBLIC_KEY=pk_live_your_program
VITE_BOOMIN_PROGRAM_ID=your-program-id
VITE_BOOMIN_API_BASE=https://api.boomin.ai/v1/connect
```

The flow uses:

1. `Boomin.requestOtp`
2. `Boomin.verifyOtp`
3. `Boomin.connectInstagram({ requireCreator: true })`
4. `Boomin.getConnectStatus(sessionId)`

Expected demo states:

- Email details
- OTP verification
- Instagram connect
- Pending approval
- Approved
- Rejected
- Failed/retry

The demo stores the latest session id in `localStorage`, so refreshing after Instagram redirect still allows status polling.

# @boomin/cli

Boomin CLI for setup, handoff scaffolding, scopes, platform tokens, smoke tests, and the Platform v1 distribution tree.

```bash
npx @boomin/cli --help
npx @boomin/cli init
npx @boomin/cli doctor --json
npx @boomin/cli handoff init --framework next --auth custom
npx @boomin/cli referral init --framework next --auth custom --write
npx @boomin/cli mcp install
npx @boomin/cli skill install
npx @boomin/cli platform smoke --read-only --token sk_boomin_live_...
```

The installed binary is `boomin`.

## Platform v1 (0.4.0)

Command groups over the live `/v1/platform` REST tree (driven through `@boomin/sdk`); auth via `--token sk_boomin_live_...` or `BOOMIN_PLATFORM_TOKEN`. `--json` prints the SDK's objects — **camelCase** (`hasMore`, `approvalStatus`, `amountCents`), matching the flags you type. The REST wire underneath stays snake_case.

```bash
npx @boomin/cli distribution create --name "Launch" --objective acquisition --programs prog_... \
  --budget-mode funded --budget-asset credit --budget-total 10000
npx @boomin/cli distribution validate <dist_id>
npx @boomin/cli distribution launch <dist_id>          # 202 + operation; polls to terminal (--no-wait skips)
npx @boomin/cli distribution pause|resume|cancel <dist_id>
npx @boomin/cli enrollment invite --program prog_... --email partner@example.com
npx @boomin/cli enrollment approve|reject|list|get ...
npx @boomin/cli partnership list|get|pause|resume|end ...
npx @boomin/cli connection list|get|revoke ...
npx @boomin/cli payout list|run|export [--out payouts.csv]|connect
npx @boomin/cli payout rules|rails|batches ...            # see below
npx @boomin/cli webhook create --url https://... | list | rotate-secret <we_id> | delete <we_id>
npx @boomin/cli events list --type distribution.live
```

### Payout configuration (0.4.0)

Three sub-groups under `payout`, mirroring `/payouts/{rules,rails,batches}`.
Configuration is scoped apart from money movement — `payout_rules:*` and
`payout_rails:*`, not `payouts:write` — because a rail's column mapping decides
which field of a payout row lands in the recipient column of a file a bank
ingests.

```bash
# How money LEAVES. Create is create, not upsert: a second create for a
# configured rail is a typed conflict, never a silent rewrite.
npx @boomin/cli payout rails create --rail csv_batch --format paypal_payouts_csv --default \
  --columns '[{"key":"email","header":"Email Address"},{"key":"amount","header":"Amount"}]'
npx @boomin/cli payout rails list|show <prail_id>|update <prail_id> --status disabled

# How a partner EARNS. Money is --per-unit-minor / --bonus-minor, in minor
# units of the rule's currency — never cents.
npx @boomin/cli payout rules create --name "Rev share" --type revenue_split --program prog_... --rate-bps 2000
npx @boomin/cli payout rules create --name "Registration CPA" --type cpa --program prog_... \
  --metric-key event_registration --per-unit-minor 500
npx @boomin/cli payout rules list|show <prule_id>|update <prule_id> --status paused|archive <prule_id>

# One disbursement run.
npx @boomin/cli payout batches create --rail csv_batch --period-start 2026-08-01 --period-end 2026-09-01
npx @boomin/cli payout batches export <pbatch_id> --out payouts.csv
npx @boomin/cli payout batches confirm <pbatch_id> --external-batch-ref PAYPAL-2026-08
npx @boomin/cli payout batches list|show <pbatch_id>|cancel <pbatch_id>
```

Three behaviours worth knowing before you put these in cron:

- **`payout run` exits non-zero on `payout_rules_required`.** A brand with no
  active rule and no active content split is misconfigured, not owed-nothing;
  the command fails and suggests `payout rules create`. A run that was
  configured but found no qualifying activity **succeeds** and prints
  `outcome: no_eligible_activity` along with everything it evaluated.
- **`payout export` polls, then reads.** Export is a kernel Operation and the
  presigned URL is minted on READ of the batch, so the command waits for the
  operation, retrieves the batch, and writes `--out` from its `download_url`.
  `--no-wait` prints the operation id instead. An operation that ends anything
  but `succeeded` exits non-zero rather than leaving an empty file behind.
- **`--columns` is yours.** The JSON you pass reaches the API — and comes back —
  with every header and every position untouched, through both the CLI and the
  SDK's casing boundary. Those headers are the file your bank reads.

`doctor` additionally checks v1 reachability, launch readiness (token scopes incl. `distributions:launch`), webhook endpoint presence, and wallet/billing (payout rail) readiness.

`mcp install` creates a scoped platform token, wires Claude Code with `Authorization: Bearer ...` at user scope, and asks you to restart Claude Code so the MCP server is loaded.

`skill install` installs the Boomin referral installer skill for Claude Code and Codex, then asks you to restart the agent so the skill metadata is loaded.

Hosted MCP is the supported path. `mcp install` wires it into Claude Code; there is no separate local stdio package to install.

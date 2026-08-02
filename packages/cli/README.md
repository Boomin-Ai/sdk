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

## Platform v1 (0.3.0)

Command groups over the live `/v1/platform` REST tree (driven through `@boomin/sdk`); auth via `--token sk_boomin_live_...` or `BOOMIN_PLATFORM_TOKEN`. `--json` prints the raw API objects.

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
npx @boomin/cli webhook create --url https://... | list | rotate-secret <we_id> | delete <we_id>
npx @boomin/cli events list --type distribution.live
```

`doctor` additionally checks v1 reachability, launch readiness (token scopes incl. `distributions:launch`), webhook endpoint presence, and wallet/billing (payout rail) readiness.

`mcp install` creates a scoped platform token, wires Claude Code with `Authorization: Bearer ...` at user scope, and asks you to restart Claude Code so the MCP server is loaded.

`skill install` installs the Boomin referral installer skill for Claude Code and Codex, then asks you to restart the agent so the skill metadata is loaded.

Hosted MCP is the supported path. `mcp install` wires it into Claude Code; there is no separate local stdio package to install.

# @boomin/cli

Boomin CLI for setup, handoff scaffolding, scopes, platform tokens, and smoke tests.

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

The installed binary is `boomin`. A temporary `boominjs` alias exists for transition only.

`mcp install` creates a scoped platform token, wires Claude Code with `Authorization: Bearer ...` at user scope, and asks you to restart Claude Code so the MCP server is loaded.

`skill install` installs the Boomin referral installer skill for Claude Code and Codex, then asks you to restart the agent so the skill metadata is loaded.

Local stdio MCP is published separately as `@boomin/mcp`; hosted MCP setup should use `npx @boomin/cli mcp install`.

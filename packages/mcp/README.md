# @boomin/mcp

Agent-native MCP server for Boomin referral program installation and program operation.

```bash
npx @boomin/mcp
```

Hosted MCP:

```bash
claude mcp add --transport http boomin https://mcp.boomin.ai/mcp
```

Remote clients can authorize through Boomin's browser flow. The MCP server advertises OAuth metadata at:

```txt
https://mcp.boomin.ai/.well-known/oauth-authorization-server
```

The browser consent flow signs the admin in with Boomin email OTP, asks for an organization and skill packs, then exchanges an authorization code for a scoped `sk_boomin_live_...` platform token.

Local stdio MCP:

```json
{
  "mcpServers": {
    "boomin": {
      "command": "npx",
      "args": ["@boomin/mcp"],
      "env": {
        "BOOMIN_PLATFORM_TOKEN": "sk_boomin_live_...",
        "BOOMIN_MCP_SKILL_PACKS": "referral_installer"
      }
    }
  }
}
```

`program_operator` must be explicitly granted through `BOOMIN_MCP_SKILL_PACKS` or the hosted consent flow.

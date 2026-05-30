# Boomin SDK

Public SDK package home for Boomin.

## Packages

- `@boomin/connect`: browser SDK for Partner Connect, referral-first status, channel connect, and CDN global builds.
- `@boomin/server`: server helpers for signed handoff, event ingestion, and framework adapters.
- `@boomin/cli`: setup, doctor, MCP install, referral scaffolding, tokens, and smoke commands.

## npm Trusted Publishing

Configure npm Trusted Publisher per package to this repo:

- Owner/org: `Boomin-Ai`
- Repository: `sdk`
- Workflow filename for `@boomin/cli`: `publish-boomin-cli.yml`
- Allowed action: `npm publish`

When the other scoped packages are ready to publish, add workflows and trusted publisher entries for each package.


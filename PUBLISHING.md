# Publishing the Boomin packages

Every package publishes through a `workflow_dispatch` GitHub Actions workflow
using **npm trusted publishing (OIDC)**. All four workflows declare
`permissions: id-token: write` and call a bare `npm publish` — there is no
`NPM_TOKEN`, no `NODE_AUTH_TOKEN`, and no EOTP prompt anywhere in the path.
GitHub authenticates to npm directly, per-repo and per-workflow.

Two consequences worth stating plainly, because this file previously said the
opposite and cost real time:

- **Nobody needs npm credentials to publish.** Anyone who can dispatch the
  workflow — a human in the Actions UI, or `gh workflow run` — can publish.
  That includes an agent. The credential gate that used to justify
  "founder-only" no longer exists.
- **Never publish locally.** A local `npm publish` bypasses OIDC, would need a
  token, and skips `--provenance` where the workflow sets it. Dispatch the
  workflow.

```sh
gh workflow run publish-boomin-sdk.yml     --repo Boomin-Ai/sdk --ref main -f dist_tag=latest
gh workflow run publish-boomin-cli.yml     --repo Boomin-Ai/sdk --ref main
gh workflow run publish-boomin-connect.yml --repo Boomin-Ai/sdk --ref main
gh workflow run publish-boomin-server.yml  --repo Boomin-Ai/sdk --ref main
```

## The version bump is a separate PR, and it is what actually ships

The workflow publishes whatever version is in `package.json` on the ref you
dispatch. Merging a surface PR changes code, **not** the version — so the
registry keeps serving the old package and nothing you shipped reaches anyone.

The repo convention is two PRs: the surface (#13, #15), then a `chore:` bump
(#14, #16). If you only did the first, the publish will be rejected as a
duplicate version. Check before dispatching:

```sh
node -e "console.log(require('./packages/sdk/package.json').version)"
curl -s https://registry.npmjs.org/@boomin%2fsdk | python3 -c "import sys,json;print(json.load(sys.stdin)['dist-tags'])"
```

**CI going green is not a publish.** `SDK CI` runs automatically on every merge
and says nothing about the registry. The publish workflows are separate and
only ever fire on a manual dispatch.

## Order matters

`@boomin/cli` depends on `@boomin/sdk`. npm resolves that against the
**registry**, not the workspace, so publishing the CLI before the SDK ships a
package that cannot install. As of `@boomin/cli` 0.5.0 the dependency is
`^1.0.0-beta.3`, which pins it to a version that must already be live.

```
1. @boomin/sdk      ← first, always
2. @boomin/cli
3. @boomin/connect  (independent)
4. @boomin/server   (independent; deprecation, see below)
```

## The dist-tag decision

`npm install @boomin/sdk` resolves the **`latest`** dist-tag. A version
published with `--tag beta` does not set `latest`, so a beta-only publish makes
the documented install command fail with
`No matching version found for @boomin/sdk@latest`.

The published docs and the cold-start path both say `npm i @boomin/sdk`, so the
standing decision is **publish beta versions to `latest`**. The version string
carries the "this is beta" signal; the install command staying copy-pasteable
matters more than dist-tag purity. The workflow takes the tag as an input so it
stays a conscious choice — keep choosing `latest` unless something changes.

## Current state (verified against registry.npmjs.org 2026-08-09)

| Package | Local (`main`) | Registry `latest` | |
|---|---|---|---|
| `@boomin/sdk` | 1.0.0-beta.3 | 1.0.0-beta.3 | in sync |
| `@boomin/cli` | 0.5.0 | 0.5.0 | in sync |
| `@boomin/connect` | 0.2.0 | 0.2.0 | in sync |
| `@boomin/server` | 0.1.1 | 0.1.1 | in sync, not yet deprecated |

This table goes stale the moment anything ships. Trust the two commands in the
version-bump section over this table; they take three seconds.

## Verifying a publish

**Do not verify with `npm view`.** It has returned 404 for minutes after a
successful publish twice in this project. Ask the registry directly:

```sh
curl -s https://registry.npmjs.org/@boomin%2fsdk \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['dist-tags'])"
```

Then prove it end to end from an empty directory outside these repos — this is
the first half of the cold-start path, and the only check that catches a broken
dependency range:

```sh
npm i @boomin/sdk @boomin/cli && npx @boomin/cli doctor
```

Also confirm the published metadata, not just the version — `license` should be
`MIT`. `@boomin/mcp@0.2.0` went out `UNLICENSED` and npm publishes are
permanent; it took a 0.2.1 to fix, and 0.2.0 is on the registry forever.

## `@boomin/server`

Per the launch plan it folds into `@boomin/sdk` and is deprecated afterwards —
`npm deprecate "@boomin/server" "Use @boomin/sdk"`. Atlantium imports it today,
so it must keep working until Atlantium migrates. Not a launch blocker, and
**not yet done** — the registry shows no deprecation notice.

## The unscoped `boomin` name

Still blocked (npm similarity against `boom`, which is hapi's, not ours).
`@boomin/sdk` is the shipped name and the docs are written against it. A support
ticket citing the `@boomin` scope, `boominjs`, and boomin.ai can be filed any
time; nothing depends on it.

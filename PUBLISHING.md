# Publishing the Boomin packages

Everything here is run by the founder — publishes need npm credentials and an
EOTP, which no agent should ever hold. Each package has a `workflow_dispatch`
workflow, so the normal path is the GitHub Actions UI, not a local `npm publish`.

## Order matters

`@boomin/cli` depends on `@boomin/sdk` (`^1.0.0-beta.1`). npm resolves that
against the **registry**, not the workspace, so publishing the CLI before the
SDK ships a package that cannot install.

```
1. @boomin/sdk      ← first, always
2. @boomin/cli
3. @boomin/connect  (independent)
4. @boomin/server   (independent; deprecation, see below)
```

## The dist-tag decision (read before the first SDK publish)

`npm install @boomin/sdk` resolves the **`latest`** dist-tag. A version
published with `--tag beta` does not set `latest`, so on a package whose only
release is beta-tagged, the documented install command fails with
`No matching version found for @boomin/sdk@latest`.

The published docs and the cold-start path both say `npm i @boomin/sdk`. So:

| Choice | `npm i @boomin/sdk` | Signal |
|---|---|---|
| **Publish `1.0.0-beta.1` as `latest`** (recommended) | works | version string still says beta |
| Publish as `beta` | **fails** — needs `@boomin/sdk@beta` | conventional prerelease |
| Cut `1.0.0` stable first | works | claims stability we haven't earned |

Recommendation: **publish `1.0.0-beta.1` to `latest`.** The version string
carries the "this is beta" signal; the install command staying copy-pasteable
matters more than dist-tag purity for a launch. The workflow takes the tag as
an input so this stays a conscious choice.

## Current state

| Package | Local | Registry |
|---|---|---|
| `@boomin/sdk` | 1.0.0-beta.1 | **not published** |
| `@boomin/cli` | 0.3.0 | 0.2.0 |
| `@boomin/connect` | 0.2.0 | 0.2.0 (current) |
| `@boomin/server` | 0.1.1 | 0.1.1 (current) |

## Steps

1. **`@boomin/sdk`** — Actions → *Publish @boomin/sdk* → Run workflow, `dist_tag: latest`.
   Verify: `npm view @boomin/sdk version` and, in an empty directory,
   `npm i @boomin/sdk` actually resolves.
2. **`@boomin/cli`** — Actions → *Publish @boomin/cli*.
   Verify: `npx @boomin/cli@0.3.0 --help` lists the `distribution` group.
3. **Post-publish check** — from a directory outside these repos:
   ```sh
   npm i @boomin/sdk && npx @boomin/cli doctor
   ```
   That is the first half of the cold-start path; if it works from a clean
   machine, the published surface is real.

## `@boomin/server`

Per the launch plan it folds into `@boomin/sdk` and is deprecated afterwards —
`npm deprecate "@boomin/server" "Use @boomin/sdk"`. Atlantium imports it today,
so it must keep working until Atlantium migrates. Not a launch blocker.

## The unscoped `boomin` name

Still blocked (npm similarity against `boom`). `@boomin/sdk` is the shipped
name and the docs are written against it. A support ticket citing the
`@boomin` scope, `boominjs`, and boomin.ai can be filed any time; nothing
depends on it.

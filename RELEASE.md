# Releasing Manguito CMS

Manguito CMS is a pnpm + Turborepo monorepo versioned with [Changesets](https://github.com/changesets/changesets). Releases are currently **manual** (no CI publish workflow yet).

Five packages are published to npm under the public `@bobbykim` scope:

- `@bobbykim/manguito-cms-core`
- `@bobbykim/manguito-cms-db`
- `@bobbykim/manguito-cms-api`
- `@bobbykim/manguito-cms-admin`
- `@bobbykim/manguito-cms-cli`

`apps/sandbox` and `packages/test-utils` are `private` and are **never** published.

## Prerequisites

- **Node** ≥ 22 and **pnpm** (the version in `packageManager`, currently `pnpm@10.32.1`).
- **npm auth** with publish rights to the `@bobbykim` scope:
  - `npm login`, or set `NPM_TOKEN` (an automation token) in your environment.
  - Verify with `npm whoami`.
  - If your npm account requires 2FA, have your authenticator ready — `changeset publish` will prompt for an OTP per package.
- A clean working tree on an up-to-date `master`.

## The model in one line

Changeset files describe *what changed* and accumulate on feature branches. Merging them to `master` lets you **version** (bump numbers + write changelogs) and then **publish** to npm.

## 1. Add a changeset (on your feature branch)

For any change that should ship, add a changeset before opening the PR:

```bash
pnpm changeset
```

Pick the affected packages and a bump level:

- **patch** — bug fixes, docs/metadata that ship inside a package.
- **minor** — new, backward-compatible features.
- **major** — breaking changes.

This writes a markdown file under `.changeset/`. Commit it with your change. Open a PR and merge to `master` as usual.

> Docs-only changes to files that are **not** shipped inside a package (e.g. the root `README.md`, `docs/**`) do not need a changeset.

## 2. Version the packages (on `master`)

Once the changesets you want to release are merged:

```bash
git checkout master
git pull
pnpm version          # runs `changeset version`
```

This consumes every pending changeset, bumps `package.json` versions, and updates each package's `CHANGELOG.md`. Review the diff, then commit:

```bash
git add -A
git commit -m "chore(release): version packages <x.y.z>"
```

> Tip: you can do this on a short-lived `release/` branch and open a "Version Packages" PR if you'd rather review the bumps before they land on `master`.

## 3. Pre-publish checks

```bash
pnpm install          # refresh the lockfile for the new versions
pnpm build            # build all packages in dependency order
pnpm test             # full test suite must pass
```

Do not publish if the build or tests fail.

## 4. Publish to npm

```bash
pnpm release          # runs `changeset publish`
```

This publishes each public package whose version is not yet on npm, replaces `workspace:*` dependencies with the real versions automatically, and creates a git tag per published package (e.g. `@bobbykim/manguito-cms-cli@0.1.1`). Private packages are skipped.

If 2FA is enabled, enter the OTP when prompted (once per package).

## 5. Push tags and cut a GitHub release

```bash
git push --follow-tags
```

Then draft a GitHub release from the new tag(s), using the relevant `CHANGELOG.md` entries as the notes.

## Verifying a release

```bash
npm view @bobbykim/manguito-cms-cli version    # should show the new version
npx @bobbykim/manguito-cms-cli@latest init demo # smoke-test the published CLI
```

## Troubleshooting

- **`ERR_PNPM_...` / lockfile mismatch during publish** — run `pnpm install` after `pnpm version` so the lockfile matches the new versions, then commit it.
- **`E402`/`ENEEDAUTH` from npm** — you're not logged in or the token lacks publish rights; re-run `npm login` or fix `NPM_TOKEN`.
- **A package didn't publish** — `changeset publish` only publishes versions that aren't already on npm. If a bump was missed, add a changeset and re-run from step 2.
- **`workspace:*` appeared on npm** — it shouldn't; `changeset publish` (via pnpm) rewrites these to real versions. If you published with plain `npm publish`, unpublish/deprecate and republish with `pnpm release`.

## Future: automated releases

There is no CI publish pipeline yet (`.github/workflows/` is absent). A `changesets/action` workflow can automate steps 2–5: it opens a "Version Packages" PR as changesets land, and publishes on merge using an `NPM_TOKEN` secret. Adding it is a good follow-up to make releases a merge-button.

# Releasing Manguito CMS

Manguito CMS is a pnpm + Turborepo monorepo versioned with [Changesets](https://github.com/changesets/changesets). Publishing is **manual**; CI gates every change to `master` but does not publish.

Six packages are published to npm under the public `@bobbykim` scope:

- `@bobbykim/manguito-cms-core`
- `@bobbykim/manguito-cms-db`
- `@bobbykim/manguito-cms-api`
- `@bobbykim/manguito-cms-admin`
- `@bobbykim/manguito-cms-cli`
- `@bobbykim/create-manguito`

`apps/sandbox` and `packages/test-utils` are `private` and are **never** published.

## How a release works with a protected `master`

`master` accepts changes only through a pull request whose `ci` check passed. Nobody can push to it directly, the owner included ([ADR 0006](docs/adr/0006-protected-master-and-ci-gate.md)). A release therefore has two halves:

1. **The version bump changes files, so it goes through a pull request.** `changeset version` rewrites `package.json` versions and `CHANGELOG.md` files on a `release/<x.y.z>` branch. You merge that pull request like any other.
2. **Publishing changes no files, so it runs on `master` after the merge.** `changeset publish` uploads to npm and creates one git tag per package. It makes no commit (`.changeset/config.json` sets `"commit": false`). You push only the tags, and the ruleset does not cover tags.

## Quick reference

```bash
# 1. Version on a release branch
git checkout master && git pull
git checkout -b release/<x.y.z>
pnpm run version                     # NOT `pnpm version` — see step 2
git add -A && git commit -m "chore(release): version packages <x.y.z>"
git push -u origin release/<x.y.z>
gh pr create --base master --title "chore(release): version packages <x.y.z>" --body "Version Packages"

# 2. Merge the pull request once `ci` is green

# 3. Publish from the updated master
git checkout master && git pull
gh run list --branch master --workflow CI --commit "$(git rev-parse HEAD)" --limit 1   # must say success
pnpm install --frozen-lockfile
pnpm turbo run build --filter="./packages/*"
pnpm release                         # changeset publish: npm + tags
git push --follow-tags               # pushes the tags only
```

Each step is explained below.

## Prerequisites

- **Node** ≥ 22 and **pnpm** (the version in `packageManager`, currently `pnpm@10.32.1`).
- **GitHub CLI** (`gh`), authenticated, to open the release pull request and check CI. The GitHub web UI works too.
- **npm auth** with publish rights to the `@bobbykim` scope:
  - `npm login`, or set `NPM_TOKEN` (an automation token) in your environment.
  - Verify with `npm whoami`.
  - If your npm account requires 2FA, have your authenticator ready: `changeset publish` prompts for an OTP per package.
- A clean working tree.

## 1. Add a changeset (on your feature branch)

For any change that should ship, add a changeset before opening the pull request:

```bash
pnpm changeset
```

Pick the affected packages and a bump level:

- **patch**: bug fixes, and docs or metadata that ship inside a package.
- **minor**: new, backward-compatible features.
- **major**: breaking changes.

This writes a Markdown file under `.changeset/`. Commit it with your change, open a pull request, and merge it once `ci` passes. Changesets accumulate on `master` until you release.

> Changes only to files that are **not** shipped inside a package (e.g. the root `README.md`, `docs/**`, `.github/**`) do not need a changeset.

## 2. Version the packages (release branch → pull request)

When the changesets you want to release are on `master`:

```bash
git checkout master
git pull
git checkout -b release/<x.y.z>
pnpm run version
```

**Use `pnpm run version`, not `pnpm version`.** `pnpm version` is pnpm's own built-in version-bump command and never runs the repo's `version` script. `pnpm run version` runs `changeset version`, which consumes every pending changeset, bumps `package.json` versions, and updates each package's `CHANGELOG.md`.

Review the diff (`git diff --stat`), then commit, push and open the pull request:

```bash
git add -A
git commit -m "chore(release): version packages <x.y.z>"
git push -u origin release/<x.y.z>
gh pr create --base master --title "chore(release): version packages <x.y.z>" --body "Version Packages"
```

You do not normally need `pnpm install` here. Internal dependencies are `workspace:*`, so a version bump leaves `pnpm-lock.yaml` unchanged. If the bump did change the lockfile (because the release also changed a dependency), CI installs with `--frozen-lockfile` and fails at its Install step; run `pnpm install` on the branch, commit the lockfile, and push.

## 3. Merge the release pull request

Merge it once `ci` passes, in the GitHub UI or with:

```bash
gh pr merge release/<x.y.z> --merge
```

If `ci` fails, fix it on the release branch and push again, as with any pull request.

## 4. Publish to npm (on `master`)

```bash
git checkout master
git pull
gh run list --branch master --workflow CI --commit "$(git rev-parse HEAD)" --limit 1
```

The run for the merge commit must show `success` (wait with `gh run watch <id>` if it is still in progress). It ran the full test suite and smoke test against this exact commit, so there is no need to repeat them locally. Then build and publish:

```bash
pnpm install --frozen-lockfile
pnpm turbo run build --filter="./packages/*"   # the same build CI runs; see below
pnpm release          # runs `changeset publish`
```

Build with this filter, not the root scripts. It is the build CI runs, and it covers all six published packages. `pnpm build` also builds `apps/sandbox`, which needs real storage credentials in `apps/sandbox/.env` and is irrelevant to a release. `pnpm build:packages` skips `@bobbykim/create-manguito`, and that package has no prepublish build. Its published `files` are only `dist`, so publishing after `build:packages` alone would ship it without its compiled code.

`pnpm release` publishes each public package whose version is not yet on npm, replaces `workspace:*` dependencies with real versions, and creates a git tag per published package (e.g. `@bobbykim/manguito-cms-cli@0.1.1`). Private packages are skipped. If 2FA is enabled, enter the OTP when prompted (once per package).

## 5. Push tags and cut a GitHub release

```bash
git push --follow-tags
```

Your local `master` matches `origin/master` after step 4's pull, so this pushes only the new tags. The ruleset protects `refs/heads/master` only; tags are not affected.

Then draft a GitHub release from the new tag(s), using the relevant `CHANGELOG.md` entries as the notes.

## Verifying a release

```bash
npm view @bobbykim/manguito-cms-cli version    # should show the new version
npm create @bobbykim/manguito@latest demo      # smoke-test the published scaffolder
```

## Troubleshooting

- **`pnpm version` printed a version table or `ERR_PNPM_INVALID_VERSION_BUMP`.** You ran pnpm's built-in command. Run `pnpm run version`.
- **CI failed at Install with `ERR_PNPM_OUTDATED_LOCKFILE`.** The lockfile no longer matches a `package.json`. On the branch, run `pnpm install`, commit `pnpm-lock.yaml`, and push.
- **Push to `master` rejected (`GH013: Repository rule violations`).** You committed on `master` locally. Move the commit to a branch and reset `master`:

  ```bash
  git branch release/<x.y.z>
  git reset --hard origin/master
  git checkout release/<x.y.z>
  git push -u origin release/<x.y.z>
  ```

  Then open a pull request from that branch.
- **`E402`/`ENEEDAUTH` from npm.** You're not logged in, or the token lacks publish rights. Re-run `npm login` or fix `NPM_TOKEN`.
- **A package didn't publish.** `changeset publish` only publishes versions that aren't already on npm. If a bump was missed, add a changeset on a branch, merge it, and start again from step 2.
- **Publishing stopped partway** (an OTP timed out, the network dropped). Re-run `pnpm release`. It skips versions already on npm and publishes the rest, then push tags as in step 5.
- **`workspace:*` appeared on npm.** It shouldn't: `changeset publish` (via pnpm) rewrites these to real versions. If you published with plain `npm publish`, deprecate or unpublish the version and republish with `pnpm release`.

## When CI or the ruleset blocks you

- **A pull request waits forever for `ci`.** The check never reported. The usual causes:
  - the head commit's message contains `[skip ci]`;
  - the job in `.github/workflows/ci.yml` was renamed;
  - the workflow gained a `paths` filter.

  Push a new commit, or fix the workflow, so `ci` runs. The required check name is coupled to `.github/rulesets/master.json`; see [ADR 0006](docs/adr/0006-protected-master-and-ci-gate.md).
- **CI is broken by something outside the repo** (a GitHub Actions or Docker Hub outage), and you must merge anyway. As a repo admin, open **Settings → Rules → Rulesets → master-protection** and set **Enforcement status** to **Disabled**. Merge, then restore the protection from the committed file:

  ```bash
  scripts/apply-ruleset.sh            # scripts/apply-ruleset.sh --dry-run shows what it will do
  ```

  The script finds the ruleset by name and puts every setting back. Re-running it is also how you undo any other hand edit to the ruleset.

## Future: automated releases

CI runs on every pull request and push to `master` (`.github/workflows/ci.yml`), but publishing is still manual. A `changesets/action` workflow could automate steps 2–5: it opens a "Version Packages" pull request as changesets land, and publishes on merge. Two things to know before adopting it:

- It needs an `NPM_TOKEN` secret or npm trusted publishing, and npm 2FA complicates it.
- A pull request opened with the default `GITHUB_TOKEN` does not trigger `pull_request` workflows. The required `ci` check would never report on the action's pull request, which would stay blocked. Give the action a personal access token or a GitHub App token instead.

# CI and Branch Protection — Design

**Status:** Approved in conversation 2026-10-07.

## Problem

Nothing outside a developer's machine checks a change before it lands on `master`.

- **There is no CI.** The repo has no `.github/` directory, and `git log --all -- .github` returns nothing, so there has never been one. `lint`, `typecheck`, `test` and `smoke` run only when someone remembers to run them locally. CLAUDE.md's Phase 10 entry ("Deployment — Lambda, Neon, CI/CD pipeline") overstates what exists; [RELEASE.md](../../../RELEASE.md) is accurate ("`.github/workflows/` is absent").
- **`master` is unprotected.** `gh api repos/bobbykim89/manguito-cms/branches/master/protection` returns `404 Branch not protected`, and `gh api repos/bobbykim89/manguito-cms/rulesets` returns `[]`. "Never commit to master" exists only as an assistant memory note, which binds no one.
- **The release flow commits to `master` directly.** RELEASE.md step 2 runs `pnpm version` on `master` and commits the result (`f9055a3 chore(release): version packages` landed that way). Step 5 pushes with `git push --follow-tags`.

## Goals

- Every pull request and every push to `master` runs lint, the package build, typecheck, the full test suite against a real Postgres, and the smoke test.
- `master` accepts changes only through a pull request whose `ci` check passed. Nobody can bypass that, the owner included.
- The ruleset lives in the repo as reviewable JSON and is applied by a script that can be safely re-run.
- Releasing still works, with one change: the version commit arrives through a pull request.

## Non-goals

- **Closing existing gate gaps.** ESLint has no Vue plugin, so `packages/admin/**/*.vue` is unlinted, and `pnpm typecheck` omits the `db` package. Each is a follow-up. CI runs the scripts exactly as they exist today.
- **A changeset-presence check** on pull requests. Deferred.
- **Automated publishing** (`changesets/action`). Publishing stays manual. Automation needs an npm token or trusted publishing, and npm 2FA complicates it; it is a separate project.
- **Turbo remote cache, a Node version matrix, building the sandbox app.** CI targets Node 22 only, matching `engines`.
- **Updating CLAUDE.md.** That is the next item on the backlog and should describe this work once it exists.

## Section 1 — CI workflow

File: `.github/workflows/ci.yml`.

### Triggers

- `pull_request`, all branches.
- `push` to `master`. This catches anything a merge breaks, which matters because the ruleset does not require branches to be up to date (Section 2).
- `concurrency`: group by workflow and ref, with `cancel-in-progress: true`. A newer push to the same pull request cancels the older run.

### One job, `ci`

The job id and name are both `ci`. That string is the check name Section 2's ruleset requires, so the two must stay in sync.

It runs on `ubuntu-latest` with one service container:

- image `postgres:16`, the image `manguito-test-db` uses in `docker-compose.yml`;
- `POSTGRES_DB: manguito_test`, `POSTGRES_USER: postgres`, `POSTGRES_PASSWORD: postgres`;
- port `5432:5432`;
- a `pg_isready` health check, so steps start only once the database accepts connections.

The job sets `DB_URL: postgresql://postgres:postgres@localhost:5432/manguito_test` in its environment. The credentials are not secrets: they exist only inside one run's throwaway container.

### Steps, in order

1. `actions/checkout`.
2. `pnpm/action-setup` with no `version` input. It reads `packageManager` (`pnpm@10.32.1`) from the root `package.json`.
3. `actions/setup-node` with `node-version: 22` and `cache: pnpm`.
4. `pnpm install --frozen-lockfile`. This also fails a pull request whose lockfile does not match its `package.json` files, which catches a release PR that skipped `pnpm install`.
5. `pnpm lint`.
6. `pnpm turbo run build --filter="./packages/*"`.
7. `pnpm typecheck`.
8. `pnpm test`.
9. `pnpm smoke`.

Each action is pinned to its current major version, checked against that action's releases page at implementation time.

### Why the build is filtered

`pnpm build` runs `turbo run build` over the whole workspace, and `pnpm turbo run build --dry=json` lists `sandbox#build` among its tasks. The sandbox's `build` script is `manguito build --env .env`. That needs a gitignored `.env`, plus a `manguito` binary that is linked only after the CLI package is built (which is why the root `build:packages` script ends with `pnpm install --frozen-lockfile`). The sandbox build is a deploy step, not a gate.

`pnpm turbo run build --filter="./packages/*" --dry=json` lists exactly these tasks:

```
@bobbykim/create-manguito#build
@bobbykim/manguito-cms-admin#build
@bobbykim/manguito-cms-api#build
@bobbykim/manguito-cms-cli#build
@bobbykim/manguito-cms-core#build
@bobbykim/manguito-cms-db#build
@bobbykim/manguito-cms-test-utils#build
```

The last entry is a placeholder: `packages/test-utils/package.json` has no `build` script, because the package exports its TypeScript source directly (`"import": "./src/index.ts"`). A real run therefore executes six build tasks, as the turbo summary `Tasks: 6 successful, 6 total` shows. (Corrected during execution, 2026-10-07.)

The admin package's `build` script is `vue-tsc && vite build && tsup`, so this step also type-checks the admin package's Vue components.

### Why typecheck follows the build

Packages resolve each other's types through their built output. `packages/core/package.json` exports `"types": "./dist/index.d.ts"`, so `tsc --noEmit` in `api` or `cli` needs `core` and `db` built first.

### Why the test scripts need no CI-specific change

Every package test script that needs the database has the form `dotenv -e ../../.env.test -- vitest run`, and `apps/sandbox`'s `smoke` script has the same shape. `.env.test` is gitignored and absent in CI. `dotenv-cli` does not fail on a missing file and passes the process environment through. Verified with:

```
DB_URL=from-env npx dotenv -e ../../.env.nonexistent -- node -e "console.log('DB_URL=' + process.env.DB_URL)"
```

That prints `DB_URL=from-env` and exits 0. The job-level `DB_URL` therefore reaches `globalSetup.ts`'s `process.env['DB_URL']` read and `packages/test-utils/src/db.ts`'s, unchanged.

`pnpm test` is `turbo run test --concurrency=1`. Its dry run lists `test` tasks for `create-manguito`, `admin`, `api`, `cli`, `core` and `db`, plus those packages' `build` dependencies (`turbo.json`: `test` depends on `^build`). It schedules no `sandbox` task. The sandbox has no `test` script; it is covered only by step 9.

Each run starts from an empty database. `globalSetup.ts` generates and applies migrations and seeds from scratch, as [ADR 0003](../../adr/0003-real-postgres-integration-tests.md) already assumes ("CI provisions a fresh Postgres service so every run starts clean").

### Risk: the suite has only ever run on one machine

The first CI run may expose dependencies on the local setup, such as paths, timing, or a database left warm from earlier runs. Fixing them is part of this work. Loosening or skipping a gate to get green is not.

## Section 2 — Ruleset

### `.github/rulesets/master.json`

The body of a `POST /repos/{owner}/{repo}/rulesets` request:

```json
{
  "name": "master-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/master"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "ci", "integration_id": 15368 }]
      }
    }
  ]
}
```

The field names follow GitHub's REST rulesets API and must be checked against its current documentation at implementation time. `integration_id` pins the check to the GitHub Actions app, so a commit status named `ci` from some other source cannot satisfy it. `15368` is the app id the plan must confirm from the first CI run: the `app.id` of the `ci` check run, from `gh api repos/bobbykim89/manguito-cms/commits/<sha>/check-runs`.

### Decisions

- **0 required approvals.** GitHub does not let an author approve their own pull request, so requiring one would lock out the sole maintainer.
- **Branches need not be up to date** (`strict_required_status_checks_policy: false`). For a single-maintainer repo, strict mode mostly forces needless rebases. The `push` trigger's run on `master` is the backstop.
- **No bypass actors.** A bypass would let accidental direct commits through, and blocking those is half the point.
- **Tags are not targeted.** `target: "branch"` with a `refs/heads/master` condition leaves `refs/tags/*` alone, so the release's tag push is unaffected.
- **All three merge methods allowed.** The history uses merge commits (`abd8b52 Merge pull request #43 …`).

### `scripts/apply-ruleset.sh`

A bash script, matching `scripts/lint-plan.sh`, with `set -euo pipefail`:

1. Resolve `owner/repo` with `gh repo view --json nameWithOwner --jq .nameWithOwner`.
2. Look up an existing ruleset by name: `gh api repos/<owner>/<repo>/rulesets --jq '.[] | select(.name == "master-protection") | .id'`.
3. If an id is found, `PUT repos/<owner>/<repo>/rulesets/<id>` with `--input .github/rulesets/master.json`. Otherwise `POST repos/<owner>/<repo>/rulesets` with the same input.
4. Print the ruleset's id and its `_links.html.href`.

Re-running it produces no change when nothing drifted, and restores the file's settings when someone edited the ruleset in the UI. When the `gh` token lacks admin rights, `gh api` exits non-zero with GitHub's error message; `set -e` stops the script before it reports success, and nothing was written.

The script is a one-shot admin tool with no test suite. Section 4 verifies it end to end.

## Section 3 — Release process and records

### RELEASE.md

- **Step 2 becomes a pull request.** Create `release/<x.y.z>` from an up-to-date `master`, run `pnpm version` then `pnpm install`, commit `chore(release): version packages`, push, open a "Version Packages" pull request, and merge it once `ci` passes. The existing tip suggesting this becomes the procedure.
- **Step 3 runs on `master` after the merge** (`git checkout master && git pull`), unchanged otherwise.
- **Step 5 notes** that `git push --follow-tags` now pushes only tags. Local `master` equals `origin/master` after the pull, so no branch update is attempted.
- **New troubleshooting entry: "push to master rejected."** If you committed on `master` locally, move the work to a branch with `git branch release/<x.y.z> && git reset --hard origin/master`, then push the branch.
- **"Future: automated releases"** is updated: CI exists; publishing is still manual.

### `docs/adr/0006-protected-master-and-ci-gate.md`

A cross-cutting ADR in the format of the existing root ADRs (frontmatter `status: accepted`, a decision paragraph, "Considered Options", "Consequences"). It records:

- `master` is protected with no bypass, and releases go through a version pull request (the considered options are a bypass list and `changesets/action`);
- CI is one job against a fresh Postgres service, building `./packages/*` only;
- the `ci` check name couples `ci.yml` and `master.json`, so renaming one requires renaming the other;
- a link to [ADR 0003](../../adr/0003-real-postgres-integration-tests.md), whose CI assumption this ADR makes true.

## Section 4 — Verification

Each artifact is verified by making it fail for the reason it exists.

- **The workflow runs green on its own pull request.** The pull request adding `ci.yml` triggers it. Every one of the nine steps must pass. No step may be skipped or marked `continue-on-error`.
- **The workflow fails red when a gate is broken.** On the same pull request, push one throwaway commit per gate class, confirm the run fails at the expected step, then revert it:
  - a lint error (an unused variable without the `_` prefix) → fails at `pnpm lint`;
  - a type error in a test file under `packages/api/src/__tests__/` → fails at `pnpm typecheck`. It must be a test file. `packages/api/tsup.config.ts` sets `dts: true`, so a type error in source reachable from a tsup entry fails earlier, at the build step, and would not prove `typecheck` gates anything. A test file is outside every tsup entry, Vitest does not type-check, and `packages/api/tsconfig.json` includes `src`, so `typecheck` is the only step that sees it;
  - a failing assertion in an existing integration test → fails at `pnpm test`.

  This proves each step really gates. A workflow that ran a step with `|| true`, or ran the wrong command, would stay green.
- **The ruleset rejects a direct push.** After `scripts/apply-ruleset.sh` runs, `git push origin <a throwaway commit>:master` must be rejected with a rule-violation message.
- **The ruleset blocks a red merge.** A throwaway pull request whose `ci` run fails must show merging as blocked. Close it afterwards.
- **The script can be re-run.** Running `scripts/apply-ruleset.sh` a second time updates the same ruleset id (`PUT`); it does not create a second ruleset. Confirm with `gh api repos/bobbykim89/manguito-cms/rulesets --jq length`, which must still print `1`.
- **Tags still push.** At the next release, `git push --follow-tags` from `master` succeeds. Until then, push and delete a throwaway lightweight tag to confirm tag refs are not blocked.

## Rollout order

1. Open one pull request with `ci.yml`, `master.json`, `apply-ruleset.sh`, the RELEASE.md changes and ADR 0006. Run Section 4's workflow checks on it.
2. Merge it. `master` is still unprotected at this point.
3. The maintainer runs `scripts/apply-ruleset.sh`. This changes live repository settings, so it is the maintainer's step, or the assistant's only with explicit confirmation. It runs after the merge so the `ci` check has already reported against `master`.
4. Run Section 4's ruleset checks.

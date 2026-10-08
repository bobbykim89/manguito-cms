# CI and Branch Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run lint, the package build, typecheck, the test suite against a real Postgres, and the smoke test on every pull request and every push to `master`, and make `master` accept changes only through a pull request whose `ci` check passed.

**Architecture:** One GitHub Actions job, `ci`, runs the repo's existing scripts against a throwaway `postgres:16` service container. A repository ruleset, kept as JSON in the repo and applied by a re-runnable `gh api` script, requires that check and a pull request on `master`, with no bypass. Releases keep publishing by hand; only the version commit moves into a pull request.

**Tech Stack:** GitHub Actions, GitHub REST rulesets API via `gh`, bash, `jq`, pnpm 10 + Turborepo, Postgres 16.

**Spec:** [docs/superpowers/specs/2026-10-07-ci-and-branch-protection-design.md](../specs/2026-10-07-ci-and-branch-protection-design.md). Read it before Task 1.

## Global Constraints

- **Never commit to `master`.** This plan runs on branch `chore/ci-and-branch-protection`. The probe branches in Tasks 2 and 5 are throwaway and are never merged.
- **Commit format:** conventional commits `type(scope): subject`, scope `repo`. End every commit with the `Co-Authored-By` trailer your harness instructs.
- **No package source changes.** Nothing under `packages/*/src` or `apps/*` changes, except the throwaway probe commits, which never reach `master`. If a task finds it needs one, stop and report. No changeset is needed: RELEASE.md exempts files not shipped inside a package.
- **The check name `ci` couples two files.** The job in `.github/workflows/ci.yml` has id `ci` and `name: ci`; `.github/rulesets/master.json` requires context `ci`. Change both or neither.
- **No `paths` or `paths-ignore` filters on the workflow.** A required check that never reports blocks a pull request forever, so a docs-only PR must still run `ci`.
- **Action versions, measured 2026-10-07** with `gh api repos/<action>/releases/latest --jq .tag_name`: `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, `pnpm/action-setup` v6.1.0. Pin each to its major (`@v7`, `@v7`, `@v6`).
- **The GitHub Actions app id is `15368`,** measured 2026-10-07: `gh api repos/actions/checkout/commits/main/check-runs` reports `app.id=15368 app.slug=github-actions`. Task 1 re-confirms it on this repo's own run.
- **Outward-facing actions.** Approving this plan approves pushing `chore/ci-and-branch-protection` and the `ci-probe/*` branches, opening and closing their pull requests, and force-pushing the `ci-probe/*` branches only. It does **not** approve merging any pull request (the maintainer merges) or running `scripts/apply-ruleset.sh` without `--dry-run`. Task 5 asks for that confirmation explicitly.
- **Finding a run after a push.** Every `RUN_ID=$(gh run list … --commit "$(git rev-parse HEAD)" …)` lookup is pinned to the pushed commit, so it can never pick up an older run. For a few seconds after a push, GitHub may not have registered the run yet and `RUN_ID` comes back empty or `null`. Re-run the lookup until it returns an id; never fall back to dropping `--commit`.
- **Every check states the failure it rejects** (PLAN-QUALITY rule 1). Each CI gate is proven by a probe that must turn the run red at a named step.
- **Gates for every task that changes files:** `pnpm lint`, `pnpm turbo run build --filter="./packages/*"`, `pnpm typecheck`, and `pnpm test` locally (needs `pnpm db:test:up` and `.env.test`). Docs tasks also run `pnpm lint:plans` on every Markdown file they create or edit; it checks that relative links resolve.

## Review Focus

Five inputs or conditions the spec implies but does not test directly, most likely to bite first. Each is pinned in the task that owns it.

1. **A release PR that skipped `pnpm install`** has a stale lockfile. The run must fail at the Install step, not later and not silently. → **Task 2**, probe 4.
2. **Two merges to `master` in quick succession.** Each merge commit must get its own completed `ci` result. Cancelling the earlier run would leave that commit without one. The workflow cancels in-progress runs only for pull requests. → **Task 1**, concurrency block, and its Step 3 assertion.
3. **The apply script run from a subdirectory** must still find `.github/rulesets/master.json`. Resolving the path from the current directory would fail, or apply the wrong file. → **Task 3**, Step 5.
4. **The apply script run with a token that cannot authenticate** must exit non-zero and print GitHub's error before it reports anything as applied. → **Task 3**, Step 6.
5. **Pushing a release tag after protection is on** must still succeed. The ruleset targets `refs/heads/master` only. → **Task 5**, Step 7.

---

### Task 1: CI workflow, green on its own pull request

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the root scripts `lint`, `typecheck`, `test` and `smoke` in `package.json`, and `turbo run build --filter="./packages/*"`.
- Produces: a check run named `ci` from app id `15368` on every pull request and every push to `master`. Its step names are `Install`, `Lint`, `Build packages`, `Typecheck`, `Test` and `Smoke`; Tasks 2 and 5 assert on them.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [master]

# One run per ref. A newer push to a pull request cancels that pull request's
# older run. Runs on master are never cancelled, so every merge commit gets its
# own result.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  # `ci` is the check name .github/rulesets/master.json requires. Renaming the
  # job means renaming it there too, or every pull request waits forever on a
  # check that never reports.
  ci:
    name: ci
    runs-on: ubuntu-latest
    timeout-minutes: 30
    services:
      # Mirrors manguito-test-db in docker-compose.yml. Throwaway: created
      # fresh for each run, so every run migrates and seeds from empty.
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: manguito_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d manguito_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      # .env.test is gitignored and absent here. dotenv-cli passes the process
      # environment through when its file is missing, so every package's
      # `dotenv -e ../../.env.test -- vitest run` reads this value.
      DB_URL: postgresql://postgres:postgres@localhost:5432/manguito_test
    steps:
      - uses: actions/checkout@v7
      # No version input: reads `packageManager` from the root package.json.
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm lint
      # Filtered: `pnpm build` also runs sandbox's `manguito build --env .env`,
      # which needs a gitignored .env. The sandbox build is a deploy step.
      - name: Build packages
        run: pnpm turbo run build --filter="./packages/*"
      # After the build: packages resolve each other's types from dist/*.d.ts.
      - name: Typecheck
        run: pnpm typecheck
      - name: Test
        run: pnpm test
      - name: Smoke
        run: pnpm smoke
```

- [ ] **Step 2: Lint the workflow locally**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:latest -color`
Expected: no output, exit 0.

This catches YAML and expression errors before a push. It does not prove any gate works; Task 2 does that.

- [ ] **Step 3: Check the concurrency expression rejects the master-cancelling mutation**

Run: `grep -n "cancel-in-progress" .github/workflows/ci.yml`
Expected: exactly one line, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.

The mutation this rejects is `cancel-in-progress: true`. Under it, two merges in quick succession leave the first merge commit with a cancelled `ci` result (Review Focus 2). It cannot be exercised on a pull request, so the line is checked here and reviewed.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(repo): run lint, build, typecheck, test and smoke on every PR"
```

- [ ] **Step 5: Push and open the pull request**

```bash
git push -u origin chore/ci-and-branch-protection
gh pr create --base master --head chore/ci-and-branch-protection \
  --title "ci: add CI workflow and master branch protection" \
  --body "Implements docs/superpowers/specs/2026-10-07-ci-and-branch-protection-design.md. Do not merge until every task before Task 5 in docs/superpowers/plans/2026-10-07-ci-and-branch-protection.md is done."
```

End the body with the PR attribution line your harness instructs.

- [ ] **Step 6: Watch the run to completion**

```bash
RUN_ID=$(gh run list --branch chore/ci-and-branch-protection --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

Expected: exit 0, with all six named steps succeeded:

```bash
gh run view "$RUN_ID" --json jobs --jq '.jobs[] | .steps[] | "\(.name): \(.conclusion)"'
```

Every line must end in `success`. None may be `skipped`.

If a step fails, the cause is almost certainly something on the local machine that CI lacks (spec, "Risk"). Fix the cause in the workflow or the test, commit, push, and re-watch. Never add `continue-on-error`, `|| true`, or `.skip`. If the fix needs a package source change, stop and report (Global Constraints).

If `pnpm/action-setup@v6` errors because it cannot find a pnpm version, set `with: { version: 10.32.1 }` to match `packageManager`, and note the deviation in the PR.

- [ ] **Step 7: Confirm the check name and app id the ruleset will require**

```bash
gh api "repos/bobbykim89/manguito-cms/commits/$(git rev-parse HEAD)/check-runs" \
  --jq '.check_runs[] | "\(.name) app.id=\(.app.id)"'
```

Expected: a line `ci app.id=15368`. If the name or the id differs, stop: Task 3's `master.json` must use what this prints.

---

### Task 2: Prove each gate turns the run red

Each probe is a throwaway commit on a draft pull request that is never merged. It proves a step really gates. A step that ran the wrong command, swallowed its exit code, or was skipped would stay green.

**Files:**
- Touch, throwaway only: `packages/core/src/registry/columns.ts`, `packages/api/src/__tests__/paths.test.ts`, `packages/core/package.json`

**Interfaces:**
- Consumes: Task 1's step names `Install`, `Lint`, `Typecheck` and `Test`.
- Produces: nothing that persists. The probe branch and its pull request are deleted at the end.

- [ ] **Step 1: Prove locally that the typecheck probe is invisible to the build and to Vitest**

The spec requires the typecheck probe to fail **only** at Typecheck. Check that first, locally. Append to `packages/api/src/__tests__/paths.test.ts`:

```ts
// CI probe: a deliberate type error. No tsup entry reaches this file and
// Vitest does not type-check, so only the Typecheck step can catch it.
describe('ci probe', () => {
  it('has a type error only tsc can see', () => {
    const value: number = 'not a number'
    expect(value).toBe('not a number')
  })
})
```

Run:

```bash
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm --filter @bobbykim/manguito-cms-api build
pnpm --filter @bobbykim/manguito-cms-api test -- src/__tests__/paths.test.ts
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: lint, build and the Vitest run all pass. Typecheck fails with `TS2322` at the `const value` line.

If lint or build fails, the probe is wrong: CI would go red at an earlier step and prove nothing about Typecheck. Fix the probe before continuing. Then restore the file: `git checkout packages/api/src/__tests__/paths.test.ts`.

- [ ] **Step 2: Open the probe branch and its draft pull request**

```bash
git checkout -b ci-probe/gates chore/ci-and-branch-protection
git commit --allow-empty -m "chore(repo): ci probe base (do not merge)"
git push -u origin ci-probe/gates
gh pr create --draft --base master --head ci-probe/gates \
  --title "ci probe: gates (do not merge)" \
  --body "Throwaway. Proves each CI step fails red. Closed and deleted when done."
```

Wait for this base run to go green before the first probe; it is the control:

```bash
RUN_ID=$(gh run list --branch ci-probe/gates --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

- [ ] **Step 3: Probe 1, Lint**

Append to `packages/core/src/registry/columns.ts`:

```ts
const ciProbeUnused = 1
```

```bash
git commit -am "chore(repo): ci probe, lint (do not merge)"
git push
RUN_ID=$(gh run list --branch ci-probe/gates --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID"; gh run view "$RUN_ID" --json jobs --jq '.jobs[] | .steps[] | select(.conclusion == "failure") | .name'
```

Expected: the run fails, and the failing step printed is exactly `Lint`.

Reset for the next probe:

```bash
git reset --hard HEAD~1 && git push --force-with-lease
```

Before pushing each probe, confirm the previous run has finished, or the new push will cancel it.

- [ ] **Step 4: Probe 2, Typecheck**

Append Step 1's `ci probe` block to `packages/api/src/__tests__/paths.test.ts` again, then:

```bash
git commit -am "chore(repo): ci probe, typecheck (do not merge)"
git push
RUN_ID=$(gh run list --branch ci-probe/gates --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID"; gh run view "$RUN_ID" --json jobs --jq '.jobs[] | .steps[] | select(.conclusion == "failure") | .name'
```

Expected: exactly `Typecheck`. `Build packages` must have succeeded in the same run:

```bash
gh run view "$RUN_ID" --json jobs --jq '.jobs[] | .steps[] | select(.name == "Build packages") | .conclusion'
```

Expected: `success`. Then reset as in Step 3.

- [ ] **Step 5: Probe 3, Test**

Append to `packages/api/src/__tests__/paths.test.ts`:

```ts
describe('ci probe', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2)
  })
})
```

Commit (`chore(repo): ci probe, test (do not merge)`), push, watch, and print the failing step as in Step 3.
Expected: exactly `Test`. Then reset.

- [ ] **Step 6: Probe 4, Install (stale lockfile, Review Focus 1)**

In `packages/core/package.json`, add `"is-odd": "3.0.1"` to `devDependencies` without running `pnpm install`. This models a release PR that ran `pnpm version` but skipped `pnpm install`.

Commit (`chore(repo): ci probe, stale lockfile (do not merge)`), push, watch, and print the failing step as in Step 3.
Expected: exactly `Install`, and the run log contains `ERR_PNPM_OUTDATED_LOCKFILE`:

```bash
gh run view "$RUN_ID" --log-failed | grep -c ERR_PNPM_OUTDATED_LOCKFILE
```

Expected: a count of 1 or more. Then reset.

- [ ] **Step 7: Close and delete the probe**

```bash
gh pr close ci-probe/gates --delete-branch
git checkout chore/ci-and-branch-protection
git branch -D ci-probe/gates
```

Record the four run ids and their failing steps in a comment on the real pull request from Task 1, so the reviewer can see the evidence:

```bash
gh pr comment chore/ci-and-branch-protection --body "Gate probes: Lint <run-url>, Typecheck <run-url>, Test <run-url>, Install <run-url>. Each failed at exactly its named step."
```

Fill in the four run URLs from `gh run view <id> --json url --jq .url`.

---

### Task 3: Ruleset file and apply script

**Files:**
- Create: `.github/rulesets/master.json`
- Create: `scripts/apply-ruleset.sh` (executable)

**Interfaces:**
- Consumes: the check name `ci` and app id from Task 1 Step 7.
- Produces: `scripts/apply-ruleset.sh [--dry-run]`. With no argument it creates or updates the ruleset named `master-protection` and prints its id and URL. With `--dry-run` it prints the method and endpoint it would call and writes nothing. Task 5 runs both.

- [ ] **Step 1: Write the ruleset**

Create `.github/rulesets/master.json`. The field names were checked against GitHub's REST docs on 2026-10-07 ("Create a repository ruleset"):

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

If Task 1 Step 7 printed a different name or app id, use those values.

Check it parses and carries the coupled values:

```bash
jq -e '.name == "master-protection" and .bypass_actors == [] and ([.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[] | .context] == ["ci"])' .github/rulesets/master.json
```

Expected: `true`, exit 0.

- [ ] **Step 2: Write the apply script**

Create `scripts/apply-ruleset.sh`:

```bash
#!/usr/bin/env bash
#
# Applies .github/rulesets/master.json to this repository's GitHub settings:
#
#   scripts/apply-ruleset.sh            create or update the ruleset
#   scripts/apply-ruleset.sh --dry-run  print what it would do; write nothing
#
# Safe to re-run. It finds the ruleset by name and updates it in place, so a
# second run never creates a duplicate, and a run after someone edited the
# ruleset in the UI restores the file's settings. Needs `gh` authenticated with
# admin rights on the repo, and `jq`. See docs/adr/0006-protected-master-and-ci-gate.md.

set -euo pipefail

RULESET_NAME="master-protection"
# Resolved from the script's own location, so it works from any directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULESET_FILE="$ROOT/.github/rulesets/master.json"

dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
elif [ $# -gt 0 ]; then
  echo "usage: apply-ruleset.sh [--dry-run]" >&2
  exit 2
fi

# The lookup below matches by name. If the file's name drifted from it, every
# run would miss the existing ruleset and create another one.
file_name="$(jq -r .name "$RULESET_FILE")"
if [ "$file_name" != "$RULESET_NAME" ]; then
  echo "✖ $RULESET_FILE is named '$file_name'; expected '$RULESET_NAME'." >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
existing_ids="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id")"

if [ "$(printf '%s' "$existing_ids" | grep -c .)" -gt 1 ]; then
  echo "✖ $repo has more than one ruleset named '$RULESET_NAME' (ids: $(echo $existing_ids)). Delete the extras in Settings → Rules, then re-run." >&2
  exit 1
fi

if [ -n "$existing_ids" ]; then
  method=PUT
  endpoint="repos/$repo/rulesets/$existing_ids"
else
  method=POST
  endpoint="repos/$repo/rulesets"
fi

if [ "$dry_run" = true ]; then
  echo "dry run: would $method $endpoint with $RULESET_FILE"
  exit 0
fi

result="$(gh api --method "$method" "$endpoint" --input "$RULESET_FILE")"
echo "✔ $method $endpoint"
echo "  id:  $(jq -r .id <<<"$result")"
echo "  url: $(jq -r ._links.html.href <<<"$result")"
```

```bash
chmod +x scripts/apply-ruleset.sh
```

- [ ] **Step 3: Static-check the script**

Run: `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/apply-ruleset.sh`
Expected: no output, exit 0. If it flags `echo $existing_ids` (SC2086), that unquoted expansion is deliberate: it joins ids onto one line. Add `# shellcheck disable=SC2086` on the line above it with that reason, rather than restructuring.

- [ ] **Step 4: Dry run from the repo root**

Run: `scripts/apply-ruleset.sh --dry-run`
Expected: `dry run: would POST repos/bobbykim89/manguito-cms/rulesets with /mnt/projects/manguito-cms/.github/rulesets/master.json`. It is POST because the repo has no rulesets yet; `gh api repos/bobbykim89/manguito-cms/rulesets` returned `[]` on 2026-10-07.

- [ ] **Step 5: Dry run from a subdirectory (Review Focus 3)**

Run: `(cd packages/core && ../../scripts/apply-ruleset.sh --dry-run)`
Expected: the same line as Step 4, with the same absolute path to `master.json`.

This rejects the mutation `RULESET_FILE=".github/rulesets/master.json"`, a path relative to the current directory: `jq` would fail with `No such file or directory`. Verify that. Apply the mutation, re-run this step and see it fail, then restore the line and see it pass.

- [ ] **Step 6: Unauthenticated run fails before reporting anything (Review Focus 4)**

Run: `GH_TOKEN=invalid scripts/apply-ruleset.sh --dry-run; echo "exit=$?"`
Expected: GitHub's `Bad credentials` error from `gh` is the **only** error, then `exit=1` (or any non-zero code). No `✖`, `dry run:` or `✔` line follows it.

This rejects dropping `set -e`, or swallowing `gh` failures with `|| true`. Measured during execution: with `-e` removed, the script keeps going after the failed `gh repo view`, queries `repos//rulesets`, captures GitHub's 404 JSON body as `existing_ids`, and prints a misleading `✖ … has more than one ruleset named 'master-protection'` error. It still exits 1, so the exit code alone does not reject this mutation. The "no line follows" condition does. Verify that. Remove `-e` from `set -euo pipefail`, re-run and see the extra `✖` line, then restore.

- [ ] **Step 7: Gates and commit**

Run the Global Constraints gates. Nothing in a package changed, so they must be exactly as green as on `master`.

```bash
git add .github/rulesets/master.json scripts/apply-ruleset.sh
git commit -m "chore(repo): add the master ruleset and its apply script"
git push
```

The push re-runs `ci` on the pull request. Watch it green as in Task 1 Step 6.

---

### Task 4: Release process, ADR 0006, context map

**Files:**
- Modify: `RELEASE.md`, sections "2. Version the packages (on `master`)", "3. Pre-publish checks", "5. Push tags and cut a GitHub release", "Troubleshooting", "Future: automated releases"
- Create: `docs/adr/0006-protected-master-and-ci-gate.md`
- Modify: `CONTEXT-MAP.md`, the opening paragraph's list of cross-cutting ADRs

**Interfaces:**
- Consumes: the file names from Tasks 1 and 3.
- Produces: documentation only.

- [ ] **Step 1: Rewrite RELEASE.md step 2**

Replace the whole of section `## 2. Version the packages (on \`master\`)`, from its heading up to (not including) `## 3. Pre-publish checks`, with:

````markdown
## 2. Version the packages (on a release branch)

`master` is protected: it accepts changes only through a pull request whose `ci` check passed ([ADR 0006](docs/adr/0006-protected-master-and-ci-gate.md)). The version bump is no exception.

Once the changesets you want to release are merged:

```bash
git checkout master
git pull
git checkout -b release/<x.y.z>
pnpm version          # runs `changeset version`
pnpm install          # refresh the lockfile for the new versions
```

`pnpm version` consumes every pending changeset, bumps `package.json` versions, and updates each package's `CHANGELOG.md`. Review the diff, then commit and open a pull request:

```bash
git add -A
git commit -m "chore(release): version packages <x.y.z>"
git push -u origin release/<x.y.z>
gh pr create --base master --title "chore(release): version packages <x.y.z>" --body "Version Packages"
```

Merge it once `ci` passes. CI installs with `--frozen-lockfile`, so a release branch that skipped `pnpm install` fails at its Install step.
````

- [ ] **Step 2: Rewrite RELEASE.md step 3's opening**

Replace the code block under `## 3. Pre-publish checks`:

````markdown
```bash
pnpm install          # refresh the lockfile for the new versions
pnpm build            # build all packages in dependency order
pnpm test             # full test suite must pass
```
````

with:

````markdown
After the release pull request merges:

```bash
git checkout master
git pull
pnpm install --frozen-lockfile   # the lockfile was refreshed on the release branch
pnpm build                       # build all packages in dependency order
pnpm test                        # full test suite must pass
```
````

Keep the line `Do not publish if the build or tests fail.` that follows it.

- [ ] **Step 3: Note the tag push in step 5**

In `## 5. Push tags and cut a GitHub release`, directly after the `git push --follow-tags` code block, insert:

```markdown
Local `master` equals `origin/master` after step 3's pull, so this pushes only the new tags. The ruleset protects `refs/heads/master` only; tags are not affected.
```

- [ ] **Step 4: Add the troubleshooting entry**

Append to the `## Troubleshooting` list:

```markdown
- **Push to `master` rejected (`GH013: Repository rule violations`)** — you committed on `master` locally. Move the commit to a branch and reset `master`: `git branch release/<x.y.z> && git reset --hard origin/master`, then `git checkout release/<x.y.z>`, push it, and open a pull request.
```

- [ ] **Step 5: Update "Future: automated releases"**

Replace its paragraph with:

```markdown
CI runs on every pull request and push to `master` (`.github/workflows/ci.yml`), but publishing is still manual. A `changesets/action` workflow could automate steps 2–5: it opens a "Version Packages" pull request as changesets land, and publishes on merge. It needs an `NPM_TOKEN` secret or npm trusted publishing, and npm 2FA complicates it.
```

Also update the first paragraph of the file. Replace `Releases are currently **manual** (no CI publish workflow yet).` with `Publishing is **manual**; CI gates every change to \`master\` but does not publish.`

- [ ] **Step 6: Write ADR 0006**

Create `docs/adr/0006-protected-master-and-ci-gate.md`:

```markdown
---
status: accepted
---

# `master` is protected by a CI gate with no bypass, and releases arrive by pull request

`master` accepts changes only through a pull request whose `ci` check passed. The rule is a repository ruleset kept in the repo as [`.github/rulesets/master.json`](../../.github/rulesets/master.json) and applied by [`scripts/apply-ruleset.sh`](../../scripts/apply-ruleset.sh). It has no bypass actors, the owner included. `ci` is one GitHub Actions job ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) that installs with a frozen lockfile, then runs lint, the build of `./packages/*`, typecheck, the test suite and the smoke test against a throwaway `postgres:16` service container. The release's version commit therefore arrives through a "Version Packages" pull request, and publishing stays a manual step on `master` after it merges ([RELEASE.md](../../RELEASE.md)).

## Considered Options

- **A bypass list containing the owner** — rejected: it would keep the old release flow (commit the version bump straight to `master`), but it lets accidental direct commits through too, and preventing those is half the reason for the rule.
- **Automated publishing with `changesets/action`** — deferred: it makes a release one merge button, but needs an npm token or trusted publishing, and npm 2FA complicates it. The version pull request this ADR introduces is the same shape that action produces, so adopting it later changes little.
- **Configuring the ruleset by hand in GitHub's settings** — rejected: nothing in the repo would record what is enforced, and drift would be invisible. The JSON is reviewable, and re-running the script restores it.
- **Parallel CI jobs (lint, test and so on)** — rejected for now: every gate after lint needs the built `dist/` output, so separate jobs would each reinstall and rebuild, or pass artifacts between jobs, to save little on a suite that runs in minutes. One job also gives the ruleset one stable check name.
- **Requiring branches to be up to date before merging** — rejected: with one maintainer it mostly forces needless rebases. The workflow also runs on every push to `master`, which catches anything a merge breaks.

## Consequences

- The string `ci` couples `ci.yml` (the job's id and `name`) and `master.json` (the required context). Renaming one without the other leaves every pull request waiting on a check that never reports.
- The workflow must not gain `paths` or `paths-ignore` filters, for the same reason: a docs-only pull request would never get its required check.
- The required check is pinned to the GitHub Actions app (`integration_id` 15368), so a commit status named `ci` from any other source does not satisfy it.
- CI builds `./packages/*` only. The sandbox's `build` script is `manguito build --env .env`, a deploy step that needs a gitignored `.env`.
- This makes true what [ADR 0003](0003-real-postgres-integration-tests.md) assumed: "CI provisions a fresh Postgres service so every run starts clean."
- Tags are outside the ruleset (`refs/heads/master` only), so the release's `git push --follow-tags` is unaffected.
- Known gaps CI inherits from the scripts it runs, deliberately out of scope: `.vue` files are not linted, and `pnpm typecheck` omits the `db` package. The admin package's `build` runs `vue-tsc`, so admin types are checked there.
```

- [ ] **Step 7: Index ADR 0006 in CONTEXT-MAP.md**

In `CONTEXT-MAP.md`'s first paragraph, the cross-cutting list ends:

```markdown
[0005 smoke-test layer](./docs/adr/0005-smoke-test-layer.md)).
```

Replace that with:

```markdown
[0005 smoke-test layer](./docs/adr/0005-smoke-test-layer.md), [0006 protected master and CI gate](./docs/adr/0006-protected-master-and-ci-gate.md)).
```

- [ ] **Step 8: Check links and gates, then commit**

Run: `pnpm lint:plans RELEASE.md CONTEXT-MAP.md docs/adr/0006-protected-master-and-ci-gate.md`
Expected: `Plan checks passed.` This checks every relative link, including ADR 0006's links to `.github/` files and the script.

Rejected mutation: a link to `0006-protected-master-ci-gate.md` (a word dropped). Verify that. Break one link, re-run and see it fail, then restore.

Then run the Global Constraints gates. Then:

```bash
git add RELEASE.md CONTEXT-MAP.md docs/adr/0006-protected-master-and-ci-gate.md
git commit -m "docs(repo): release through a version PR and record ADR 0006"
git push
```

Watch `ci` go green on the pull request as in Task 1 Step 6. Then tell the maintainer the pull request is ready to merge, and stop until they have merged it.

---

### Task 5: Apply the ruleset and verify protection (after the maintainer merges)

**Precondition:** the Task 1 pull request is merged into `master`, and the `ci` run for the merge commit on `master` succeeded:

```bash
git checkout master && git pull
gh run list --branch master --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json headSha,conclusion --jq '.[0]'
```

Expected: `headSha` equals `git rev-parse HEAD`, and `conclusion` is `success`. If the run is still in progress, wait with `gh run watch`.

**Files:** none. This task changes live repository settings only.

**Interfaces:**
- Consumes: `scripts/apply-ruleset.sh` from Task 3, and the step names from Task 1.

- [ ] **Step 1: Dry run, then ask the maintainer**

Run: `scripts/apply-ruleset.sh --dry-run`
Expected: `dry run: would POST repos/bobbykim89/manguito-cms/rulesets …`.

Show the maintainer that line and the contents of `.github/rulesets/master.json`. Ask for explicit confirmation to apply them. Without a yes, stop here. The maintainer may prefer to run Step 2 themselves.

- [ ] **Step 2: Apply**

Run: `scripts/apply-ruleset.sh`
Expected: `✔ POST repos/bobbykim89/manguito-cms/rulesets`, then an `id:` and a `url:` line. Record the id.

If GitHub answers `403` or `404`, the `gh` token lacks admin rights on the repo. The script exits non-zero and nothing was written. The token needs the `repo` scope and the account needs admin rights on the repo; `admin:repo_hook` (webhooks) is irrelevant to rulesets. The maintainer fixes the token (`gh auth refresh -s repo`, or a fine-grained token with the repo's Administration permission) and re-runs.

- [ ] **Step 3: Confirm the rules apply to `master`**

Run: `gh api repos/bobbykim89/manguito-cms/rules/branches/master --jq '[.[].type] | sort'`
Expected: `["deletion","non_fast_forward","pull_request","required_status_checks"]`.

Do not run Steps 4 and 5 until this matches. If the ruleset were not active, Step 5's push would land on `master`.

- [ ] **Step 4: A red pull request cannot merge**

```bash
git checkout -b ci-probe/blocked-merge master
printf '\nconst ciProbeUnused = 1\n' >> packages/core/src/registry/columns.ts
git commit -am "chore(repo): ci probe, blocked merge (do not merge)"
git push -u origin ci-probe/blocked-merge
gh pr create --base master --head ci-probe/blocked-merge --title "ci probe: blocked merge (do not merge)" --body "Throwaway. Proves the ruleset blocks merging a red PR."
RUN_ID=$(gh run list --branch ci-probe/blocked-merge --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID"
gh pr view ci-probe/blocked-merge --json mergeStateStatus --jq .mergeStateStatus
```

Expected: the run fails at `Lint`, and `mergeStateStatus` is `BLOCKED`. Then confirm a merge attempt is refused:

```bash
gh pr merge ci-probe/blocked-merge --merge; echo "exit=$?"
```

Expected: an error naming the required status check, and a non-zero exit. Then clean up:

```bash
gh pr close ci-probe/blocked-merge --delete-branch
git checkout master && git branch -D ci-probe/blocked-merge
```

- [ ] **Step 5: A direct push to `master` is rejected**

```bash
git checkout -b ci-probe/direct-push master
git commit --allow-empty -m "chore(repo): ci probe, direct push (must be rejected)"
git push origin HEAD:master; echo "exit=$?"
```

Expected: the push is rejected with `GH013: Repository rule violations found for refs/heads/master`, and the exit is non-zero. Clean up:

```bash
git checkout master && git branch -D ci-probe/direct-push
git fetch origin && git status -sb
```

`git status -sb` must show `master...origin/master` with no ahead or behind count.

- [ ] **Step 6: Re-running the script updates in place**

Run: `scripts/apply-ruleset.sh`
Expected: `✔ PUT repos/bobbykim89/manguito-cms/rulesets/<id>`, with the **same** id Step 2 recorded.

Run: `gh api repos/bobbykim89/manguito-cms/rulesets --jq length`
Expected: `1`.

- [ ] **Step 7: Tags still push (Review Focus 5)**

```bash
git tag -a ci-probe-tag -m "ci probe" && git push origin ci-probe-tag
git push origin :refs/tags/ci-probe-tag && git tag -d ci-probe-tag
```

Expected: both pushes succeed. The tag is annotated, the kind `changeset publish` creates and `--follow-tags` pushes.

- [ ] **Step 8: Report**

Tell the maintainer:
- the ruleset id and URL;
- each verification's result (blocked merge, rejected push, update in place, tag push);
- that the next release follows the new RELEASE.md step 2.

Then remind them that updating CLAUDE.md is the next backlog item, and should now describe the CI gate and the commands it runs.

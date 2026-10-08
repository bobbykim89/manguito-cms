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
- An environment variable a test reads must be declared in `turbo.json`'s `passThroughEnv` for the `test` task (today: `DB_URL`). Turbo's strict environment mode hides undeclared variables from tasks. Locally `.env.test` masks this, because dotenv loads the file inside the task, so an undeclared variable passes locally and fails only in CI.
- CI builds `./packages/*` only. The sandbox's `build` script is `manguito build --env .env`, a deploy step that needs a gitignored `.env`.
- This makes true what [ADR 0003](0003-real-postgres-integration-tests.md) assumed: "CI provisions a fresh Postgres service so every run starts clean."
- Tags are outside the ruleset (`refs/heads/master` only), so the release's `git push --follow-tags` is unaffected.
- Known gaps CI inherits from the scripts it runs, deliberately out of scope: `.vue` files are not linted, and `pnpm typecheck` omits the `db` package. The admin package's `build` runs `vue-tsc`, so admin types are checked there.

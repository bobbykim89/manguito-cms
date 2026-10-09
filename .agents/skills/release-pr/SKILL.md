---
name: release-pr
description: Prepare and open the version-packages release pull request with scripts/release-pr.sh, checking each changeset's bump level and waiting for the maintainer's yes before anything is pushed.
disable-model-invocation: true
---

# Release PR

Runs RELEASE.md step 2 through `scripts/release-pr.sh`. The script does the mechanical work; your job is the judgment it cannot make: whether each bump level fits its change, and getting the maintainer's explicit yes before the branch leaves this machine. Publishing to npm is the maintainer's step (it needs their npm OTP): you guide it and never run it.

## Steps

1. **Prepare.** From the repo root, on an up-to-date `master` with a clean tree, run `scripts/release-pr.sh prepare`. If it refuses, relay its message and stop. Each refusal names its own fix: wrong branch, uncommitted changes, `master` behind or ahead of origin, no pending changesets.

2. **Review the bump levels.** The script prints three things: the release branch, the commit body (packages under *Changed* versus *Bumped because a dependency changed*), and each changeset's id, packages, bump type and summary. Read every summary against its bump type:
   - **major**: breaking. A removed or renamed export, field, route, CLI flag or config key, or changed behaviour a consumer must adapt to.
   - **minor**: a new, backward-compatible capability.
   - **patch**: a fix, or a change with no API surface.

   This is a 0.x project. Note any breaking change regardless of label, because 0.x consumers on `^0.y` ranges do not receive a new minor automatically. A *mismatch* is a summary whose described change needs a higher bump than its label. Check every changeset. Open its original file with `git show HEAD~1:.changeset/<id>.md` when the summary is too terse to judge.

3. **Ask.** Show the maintainer the commit body, the `git diff --stat` the script printed, and every mismatch with a one-line reason (or "no mismatches"). Ask whether to push the branch and open the pull request. Wait for an explicit yes.
   - **Mismatch to fix:** discard the branch (`git checkout master && git branch -D <branch>`). The changeset gets corrected on a feature branch, merged, and this skill re-runs. A changeset is never edited on the release branch, where it has already been consumed.
   - **No:** leave the branch local and repeat the script's two commands, resume and discard.

4. **Open.** On a yes, run `scripts/release-pr.sh open` and give the maintainer the PR URL. The `ci` check must pass before it can merge.

5. **Hand over publishing.** Once the maintainer has merged it, walk them through RELEASE.md steps 3–5, quoting the commands from that file:
   - confirm `ci` succeeded on the merge commit;
   - build with the turbo filter;
   - run `pnpm release`;
   - run `git push --follow-tags`.

   They run `pnpm release`, because it prompts for their npm OTP.

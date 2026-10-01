#!/usr/bin/env bash
#
# Pre-flight checks for a design spec or implementation plan under
# docs/superpowers/. Run before dispatching any task:
#
#   pnpm lint:plans docs/superpowers/plans/my-plan.md
#
# Two checks, both chosen because their absence produced real defects (see
# docs/superpowers/PLAN-QUALITY.md):
#
#   1. Every task extracts to a brief containing exactly one task.
#      Superpowers' task-brief extractor tracks ``` toggles so it can skip
#      headings that appear inside code blocks. Its only guard is that the
#      output is non-empty, so one unbalanced fence makes capture run to the
#      end of the file: a task's brief silently arrives containing every
#      LATER task too, with no error. That happened, and produced a 1159-line
#      brief for a 177-line task.
#
#   2. Relative markdown links resolve.
#      Plans and specs cross-reference each other and the ADRs constantly. A
#      spec in this repo shipped a link to a section ("Ruling 11") that
#      existed in no document, and an assertion that a residual was recorded
#      in a sibling spec that did not record it.
#
# Deliberately NOT checked: line-number citations (the line still exists, it
# just says something else now — see PLAN-QUALITY.md rule 6), identifier
# existence (a plan legitimately names code it is about to create), and
# fixture construction. Those need judgment or real work; these two are free.

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "usage: lint-plan.sh FILE [FILE...]" >&2
  exit 2
fi

status=0

# Will every task extract to a brief containing exactly one task?
#
# This deliberately does NOT lint fences directly. Two earlier drafts of this
# function tried and both were wrong:
#
#   1. Counting ``` markers and testing for an odd total false-positives on a
#      four-backtick fence wrapping a three-backtick example (a legitimate and
#      useful thing in a plan), and never sees a ~~~ fence at all.
#   2. Tracking fences the CommonMark way and reporting one left open at EOF
#      misses the more common damage: deleting a single closing fence usually
#      does not leave a fence open to EOF — the block closes LATE, at the next
#      bare fence, swallowing every heading in between, after which the rest of
#      the file re-pairs normally and the file ends balanced.
#
# What actually matters is the observable: superpowers' task-brief extractor
# tracks fence toggles to skip headings inside examples, and its only guard is
# that the output is non-empty — so a mis-tracked fence makes one task's brief
# absorb later tasks and still exit 0. So replicate the extractor's own logic,
# flaws included, and assert the invariant a brief must satisfy: ONE task per
# brief. That predicts what the shipped tool will really hand an implementer,
# catches both failure shapes above, tolerates deliberate example headings that
# do no harm, and starts passing on its own once the extractor is fixed
# upstream.
#
# What it does NOT catch: TRUNCATION. If a fenced example contains a line the
# extractor reads as a real task heading — e.g. `### Task 9` inside a `~~~`
# block, which its ``` toggle cannot see — the task ends early and its brief is
# short but still holds exactly one heading, so the invariant here is satisfied.
# That direction is upstream's obra/superpowers#2304. Checking it would mean
# asserting a brief's expected LENGTH, which this script has no way to know.
check_extraction() {
  local file=$1
  local nums
  nums=$(sed -E -n 's/^#+[[:space:]]+Task[[:space:]]+([0-9]+).*/\1/p' "$file" | sort -un)
  [ -z "$nums" ] && return

  local n got
  for n in $nums; do
    # The same awk superpowers' task-brief uses, verbatim in behaviour.
    got=$(awk -v n="$n" '
      /^```/ { infence = !infence }
      !infence && /^#+[ \t]+Task[ \t]+[0-9]+/ {
        intask = ($0 ~ ("^#+[ \t]+Task[ \t]+" n "([^0-9]|$)"))
      }
      intask { print }
    ' "$file" | grep -cE '^#+[[:space:]]+Task[[:space:]]+[0-9]' || true)

    if [ "$got" -eq 0 ]; then
      echo "  BRIEF  $file: Task $n extracts to nothing, though its heading exists" >&2
      status=1
    elif [ "$got" -ne 1 ]; then
      echo "  BRIEF  $file: Task $n extracts to a brief containing $got task headings" >&2
      echo "         An implementer would receive later tasks' requirements as its own," >&2
      echo "         at exit 0, with no warning. Usually an unbalanced or mis-nested" >&2
      echo "         code fence earlier in the task. See PLAN-QUALITY.md." >&2
      status=1
    fi
  done
}

check_links() {
  local file=$1
  local dir
  dir=$(dirname "$file")

  # Markdown inline links whose target is a local path: skip http(s), mailto,
  # and in-page anchors. A trailing #anchor is stripped before resolving.
  grep -on '](\([^)]*\))' "$file" 2>/dev/null | while IFS=: read -r ln match; do
    local target=${match#](}
    target=${target%)}
    case "$target" in
      http://* | https://* | mailto:* | '#'* | '') continue ;;
    esac
    local path=${target%%#*}
    [ -z "$path" ] && continue
    if [ ! -e "$dir/$path" ] && [ ! -e "$path" ]; then
      echo "  LINK   $file:$ln: unresolved -> $target" >&2
      echo "status=1" > /tmp/.lint-plan-fail.$$
    fi
  done

  # The subshell above cannot set `status` in the parent, so it leaves a marker.
  if [ -f "/tmp/.lint-plan-fail.$$" ]; then
    rm -f "/tmp/.lint-plan-fail.$$"
    status=1
  fi
}

for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "  ERROR  no such file: $file" >&2
    status=1
    continue
  fi
  echo "checking $file"
  check_extraction "$file"
  check_links "$file"
done

if [ "$status" -ne 0 ]; then
  echo >&2
  echo "Plan checks FAILED. See docs/superpowers/PLAN-QUALITY.md." >&2
  exit 1
fi

echo "Plan checks passed."

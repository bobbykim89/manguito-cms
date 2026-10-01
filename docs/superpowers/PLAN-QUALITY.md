# Plan Quality Rules

**Read this before writing a design spec or an implementation plan under `docs/superpowers/`.**

A plan is not prose. It is a dense set of **factual claims about this codebase** — identifiers that exist, counts that hold, guarantees that trace to real call paths — handed to someone who will act on every one of them without checking. Writing it fluently is not the same as writing it correctly, and a plan reads authoritative precisely because it was written confidently.

Every rule below exists because its absence produced a real defect in the schema-versioning work (sub-projects 2c–2e). The evidence is kept with each rule, because an abstract rule gets skimmed and a rule with a scar gets followed.

Run `pnpm lint:plans <file>` before dispatching any task. It checks two things mechanically — that every task extracts to a brief containing exactly one task, and that relative links resolve — and neither is a rule below: they are the two failures that are free to detect. Every rule here is on you.

---

## 1. Every test states the mutation it rejects

For each test a plan specifies, write the wrong implementation it must fail against — and make *verify red under that mutation* one of the task's own steps, not something a reviewer discovers later.

**Why.** This is the rule that matters most. Four tests in sub-project 2e passed while the behaviour they were named for was absent:

- A CSP assertion checked `toContain("'unsafe-inline'")`. The strict policy already carries that string in `style-src`, so it passed under the unfixed code too.
- Three routing tests queried `{ __typename }`. An implementation serving the *current* schema on every versioned endpoint passed all three — the exact failure the sub-project existed to prevent.
- No test asserted `res.status`, leaving a deliberate HTTP-200-vs-404 decision, argued for at length in the spec, unprotected.
- Three label/column/registry-name mapping rows could each be broken with the entire 436-test suite green.

Every one was found by a reviewer mutating the implementation. None would have been found by reading the tests. If you cannot name the mutation a test rejects, the test is decoration — delete it or fix it.

## 2. Never state a count; state the command and the delta

Write "run `X`, expect the total to rise by 3" — not "there will be 14 tests" or "the baseline is 247".

**Why.** Hand-counted figures in 2c–2e were wrong at least five times: a plan claimed 11 tests where its own code block had 10, a dispatch claimed 12 where the brief had 10, prose claimed "three call sites" where there were two, and two task baselines were stale because they predated a fix wave. Absolute totals also rot the moment any earlier task adds a test, which makes every later task's figure a small lie.

When you must quote a baseline, say where it was measured — commit SHA and date — and label running totals *indicative*, with the instruction to trust the named test files over the arithmetic.

## 3. An identifier naming existing code is pasted from a command, never typed

Before a plan names a function, type, fixture, constant or file that already exists, run the grep and paste the result.

**Why.** 2e's plan invented `TEST_REGISTRY`, `TEST_RESOLVER`, `TEST_DB`, `GQL_REGISTRY` and `GQL_BLOG_TYPE_NAME`. The real names were `registry`, `repos`, `fieldKeyMaps`, `resolver`, `db` and `content--gqlpost`. One task's Interfaces block declared a helper "exported from `schema.ts`" while the same task's code placed it inside a closure. A global constraint asserted that every file under `packages/api/src/` uses explicit `.js` in relative imports — true for source files, false for every test. A ledger note called a struct field unread when it was read one screen away.

Memory and inference are not sources. The file is.

## 4. A fixture modelling a producer's output states that producer's invariants

If a plan hand-builds data that some function normally produces, write down what that function guarantees — then check the fixture against it.

**Why.** 2e hand-built a `BakedVersionModel` whose *current* version exposed a column under a label different from the registry's field name. `buildProjections` can never produce that: it derives `exposed_as` from `f.name`. The fixture made `createCmsApp` throw at startup, cost a task its first run, and a second version of the same mistake survived to the final review. One sentence — "current's projection always has `exposed_as === f.name`" — would have killed both.

Prefer building fixtures through the real producer. When you must hand-build (testing a layer in isolation is a legitimate reason), say so explicitly and list the invariants you are choosing to model.

## 5. Every "unchanged" claim cites a traced call path

Any sentence containing *unchanged*, *identical*, *byte-identical*, *unaffected* or *no new* must name the code path you followed to verify it.

**Why.** 2e's spec promised "a project that never cut a version sees no new endpoints," and the changeset repeated it. False: the CLI passes `versions: versionModel` unconditionally at three call sites, and the version model defaults to one live version — so every CLI-built project serves `/graphql/v1`. Three greps away. It reached a release note before the final review caught it. A second goal promised consumers were "unaffected by later cuts" when a newly added content type appears on every older version's schema.

A guarantee you want is not a guarantee you have.

## 6. Prefer symbol names to line numbers

Cite `buildFieldKeyMap`'s collision check, not `field-keys.ts:119`. Where a line number genuinely helps, expect it to rot and re-check it when you touch the file.

**Why.** Line citations in 2e went stale within the same branch — comments pointed at `resolvers.ts:81` and `:82` for a call that had moved to `:116`, and the commit that moved it was the one that added the citation. No cheap check catches this: the line still exists, it just says something else now. `pnpm lint:plans` verifies that cited *files* exist; it cannot verify that a line still means what you said.

## 7. The gate list must name every gate that exists

A task's verification steps must list every check CI runs — here: `test`, `typecheck`, `lint`, and `build` where relevant.

**Why.** One 2e task's steps listed `test` and `typecheck` but omitted `lint`. Its brief-mandated code contained four unsuppressed `as any` casts, which broke `turbo run lint` for the whole package and went unnoticed until the task review. Separately, this arc had already shipped a type error that survived `test`, `lint` **and** `build`, because no package script ran `tsc` at the time.

Vitest transpiles without type-checking. Green tests prove nothing about types, and nothing about lint.

---

## Before dispatching

1. `pnpm lint:plans docs/superpowers/plans/<plan>.md docs/superpowers/specs/<spec>.md`
2. Scan your own test code for rule 1 — for each `it(...)`, can you name the mutation it rejects?
3. Grep every identifier the plan claims already exists (rule 3).
4. Re-read every *unchanged* / *identical* / *no new* sentence and trace it (rule 5).

The review loop will catch what you miss, but that is the expensive place to catch it. In sub-project 2e every fix round was triggered by a defect in the planning documents rather than in the implementation — the reviewers' effort went into auditing the plan instead of the code.

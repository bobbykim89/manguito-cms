---
status: accepted
---

# Link tables carry a unique (left, right) pair; manguito adds it itself, in dev and in generated SQL

Every link table (the table behind a many-to-many reference) has a unique constraint on its `(left_id, right_id)` pair, declared in codegen under the name `linkUniqueName(table)`: `<table>_unique`, or, past Postgres's 63-byte identifier limit, a 47-character prefix plus an 8-character hash. Because adding that constraint to a table that already holds duplicate pairs fails, manguito cleans up and adds the constraint itself in both migration modes. In production, `runGenerate` rewrites each `ADD CONSTRAINT … UNIQUE("left_id","right_id")` that `drizzle-kit generate` emits (`addLinkDedupe`) into a `DO` block that deletes repeated pairs first, keeping the lowest `order`, and skips itself when the constraint exists. This is the first time manguito edits drizzle-kit's output; it does so because ADR 0002 makes the generated `.sql` file the reviewable artifact, so the clean-up has to be visible in that file rather than run beside it. In dev, `ensureLinkConstraints` runs before `drizzle-kit push`: when push must add a unique constraint to a table with rows, it stops at a "truncate the table?" prompt, so the constraint is added first, under the exact name codegen uses, and push then plans nothing.

## Considered Options

- **Let push and migrate add the constraint unaided** — rejected: migrate fails on existing duplicates, and push asks to truncate a table that holds the developer's links.
- **A separate data migration run before the generated one** — rejected: the clean-up would live outside the reviewable file and could be skipped or reordered.
- **Rewrite the SQL by diffing snapshots ourselves** — rejected: matching drizzle-kit's exact `ADD CONSTRAINT … UNIQUE("left_id","right_id");` statement is small and covered by tests; owning the diff is not.
- **Let dev answer push's prompt with `--force`** — rejected: `--force` would also approve unrelated destructive changes (ADR 0002 amendment).

## Consequences

- The rewrite depends on drizzle-kit's statement format; a test pins it, and a format change surfaces as a failing test, not as silent duplicates.
- `ensureLinkConstraints` may throw on a database error (ADR 0001: an unexpected failure); it skips link tables the database does not have yet, and tables that already carry the constraint.
- Link tables from before the `order` column existed are cleaned by `ctid` instead, keeping an arbitrary row per pair.
- Known limitation: renaming a link field in dev drops the old link table and creates a new one, which push may present as a truncate question. The default answer is the safe one.

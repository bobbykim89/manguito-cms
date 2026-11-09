# Link Uniqueness and Constraint Names — Design

**Status:** Written 2026-11-08. The maintainer skipped the questions and asked for the design directly, so every decision below is the author's call unless marked otherwise.

Closes two items of #57:

- **Concurrent saves can double links** (from the #75 review).
- **Constraint names can still collide past 63 characters** (from the #82 review).

Both items concern the names and constraints db codegen gives link tables, and the fix for the first adds a constraint whose name the second must check, so they ship in one PR. The third open item, chip labels, is a separate PR.

## Problem

### Doubled links

`persistJunctionField` in `packages/api/src/relations.ts` replaces a field's links with a `DELETE` of the item's rows, then one `INSERT` of the new list. Writes are not transactional (neon-http has no interactive transactions). Two overlapping saves of one item can run delete A, delete B, insert A, insert B, which stores every link twice. Nothing stops it: `generateJunctionTables` in `packages/db/src/codegen/index.ts` emits a link table with `left_id`, `right_id` and `order` columns and no key or unique constraint.

Reads already hide duplicates since #84 (`firstOfEach` keeps the first position), so the damage is wasted rows and an `order` sequence with repeats, not a wrong read. But the rows accumulate, and every other consumer of the table (exports, future features, hand-written SQL) sees them.

### Colliding constraint names

Postgres keeps the first 63 bytes of an identifier and drops the rest silently. drizzle-orm 0.45.2 names constraints by concatenation:

| Constraint | drizzle name (from `drizzle-orm/pg-core`) |
|---|---|
| foreign key | `<table>_<columns joined by _>_<target table>_<target columns joined by _>_fk` (`foreign-keys.js`) |
| unique | `<table>_<columns joined by _>_unique` (`unique-constraint.js`) |
| check | the explicit name codegen passes: `<column>_check` (`generateTableDef`) |

Two names that agree in their first 63 characters become one name in Postgres, and the migration fails with "constraint … already exists". Known cases:

- A link table whose name is 62 or more characters: its `left_id` and `right_id` foreign keys both truncate to `<link table>_` plus the same letters.
- Two foreign-key columns of one table whose names share a long prefix.

PR #82 added `TABLE_NAME_COLLISION` and `DUPLICATE_COLUMN` in core for table and column names. Constraint names were left out, because the rule is drizzle's, and core does not know drizzle.

## Goals

1. Each link table holds a given `(left_id, right_id)` pair at most once, enforced by Postgres.
2. Existing databases reach that state on upgrade without an editor or developer deleting data by hand, through both migration modes (docs/adr/db/0002-two-mode-migrations.md):
   - `manguito dev`, which runs `drizzle-kit push`;
   - `manguito migrate`, which generates and applies `.sql` files.
3. Overlapping saves of one item never fail because of the new constraint, and never store a pair twice.
4. A schema whose generated constraint names would collide in Postgres is refused at validate time, with a message naming the field or type to shorten and the length that clears it. This covers every `manguito validate`, `build`, `dev` and `migrate`.

## Non-goals

- **Making a save atomic.** Two overlapping saves of different lists can still leave a mix of both lists, for example A's links plus B's extra ones. This PR stops doubling only. A save that is all-or-nothing needs transactions (#84's parked follow-up).
- **Renaming existing constraints.** Foreign-key and check names stay drizzle's defaults, so no existing project gets a migration that drops and re-adds its foreign keys.
- **Paragraph tables.** They have no link tables, because core refuses many-to-many fields in paragraph types (`UNSUPPORTED_RELATION`).

## Anti-goals

These would make the change a failure even if the tests passed:

- **An upgrade that can delete links the editor meant to keep.** The clean-up removes only a row whose pair another row already holds.
- **A `manguito dev` upgrade that stops at drizzle-kit's prompt** "Do you want to truncate `<table>`?". `drizzle-kit push` (0.31.10, `bin.cjs`) asks this before adding a unique constraint to any table that has rows, whether or not they repeat. "Yes, truncate" deletes every link in the table. An existing dev database would hit the prompt once per link table.
- **A new validation error on a schema that works today**, unless that schema's migration already fails.

## Design

### 1. The constraint (db codegen)

`generateJunctionTables` adds one unique constraint on `(<left_column>, <right_column>)` to every link table, through the table's extra-config callback, as `generateTableDef` does for checks. The constraint gets an explicit name instead of drizzle's default, `<link table>_left_id_right_id_unique`. The default fails in two ways:

- **It collides with the left foreign key when the link table name is 54 characters or more.** Both names start `<link table>_left_id_` and are cut at 63 characters before they differ. Postgres compares constraint names per table across every kind, so the migration would fail on schemas that work today.
- **It truncates whenever the link table name is over 34 characters.** Then the name in the database differs from the name in the schema file. drizzle-kit 0.31.10 has no identifier-length handling (`bin.cjs` contains no `63`), so a truncated name risks a diff on every push.

**The name rule (`linkUniqueName(tableName: string): string`, exported from the db package):**

- `<link table>_unique` when that fits in 63 characters, which is any link table name up to 56 characters.
- Otherwise, the first 47 characters of the link table name, `_`, the first 8 hex digits of the SHA-256 of the full link table name, and `_unique`: exactly 63 characters.

Either way the name never truncates. In the short form it differs from both foreign-key names at the character after `<link table>_` (`u` against `l`/`r`). The hashed form starts with the link table's first 47 characters and then `_`, while the foreign keys continue with the full name, so the two can only meet if the hash happens to match the link table's next characters. §4 checks every computed name anyway. Link tables over 61 characters already fail on their own two foreign keys, which §4 reports.

### 2. Bringing existing databases there

The clean-up runs on each link table before its constraint is added. For each pair, it keeps the row with the lowest `order` and deletes the rest. This is the row a read already shows (`junctionOrderBy` sorts by `"order"` then right id, and `firstOfEach` keeps the first). Link tables have no id column, so ties on `order` fall back to `ctid`. Rows with the same pair and the same `order` are identical, so which one survives does not matter.

```sql
DELETE FROM "<t>" a USING "<t>" b
WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id"
  AND (a."order", a.ctid) > (b."order", b.ctid);
```

Every generated link table has an `order` column (`fieldTypeRegistry` sets `order_column: true` for every many-to-many field since #75), so the statement can rely on it. A database upgrading from before #75 gets `ADD COLUMN "order"` in the same migration. **The builder confirms that drizzle-kit emits column additions before constraint additions,** using the real generate output in the test below.

One pure function, `linkDedupeSql(table: string, left: string, right: string): string` in the db package, builds this statement for both modes.

**`manguito migrate`: the clean-up goes into the generated migration file.** After `drizzle-kit generate` writes its files, `runGenerate` in `packages/db/src/migrations/index.ts` rewrites each new `.sql` file. It replaces every statement that adds a unique constraint on `("left_id","right_id")` to an existing table with one guarded `DO` block: if `pg_constraint` has no constraint of that name on that table, the block runs the table's clean-up, then the original `ADD CONSTRAINT`. Otherwise it does nothing. The guard is there because `manguito dev` (below) adds the same constraint itself. Without the guard, a developer who runs `dev` and then `migrate` against one database would get a migration that fails with "constraint already exists". `applyMigrations`' reconciliation only skips migrations whose first `CREATE TABLE` already exists, so it does not cover this case. *(Author's call, after the builder check.)*

- **The match is by shape:** `ALTER TABLE "<t>" ADD CONSTRAINT "<name>" UNIQUE("left_id","right_id")`. Only link tables have that column pair, because core's `fieldTypeRegistry` fixes the column names. The rewrite therefore needs no registry, and the signatures of `generateMigration` and `previewMigration` stay as they are.
- **Why the file:** the clean-up is then part of the reviewed, versioned migration (ADR db/0002). `--dry-run` shows it, because `previewMigration` also goes through `runGenerate`. It also runs wherever the file is applied.
- **New tables:** a link table created in the same migration gets its constraint inside `CREATE TABLE`, which the pattern does not match. Nothing is inserted for it, and nothing is needed.
- **The function:** `addLinkDedupe(sql: string): string`, a pure, exported function that the rewrite calls.
- **No confirmation prompt:** the destructive-change scanner (`scanMigrationSql`) gains no pattern for the clean-up. It deletes only copies of a pair another row keeps, so it loses nothing an editor saved. The `-- ` comment the rewrite puts above the statement says so, for a reader of the file.

**`manguito dev`: the constraint is added before push runs.** `ensureLinkConstraints(db, registry)`, a new exported db function, runs before `runDevMigration` both at startup and on each reload in `packages/cli/src/commands/dev.ts`. It works through every link table in the registry, using the content and taxonomy owners, exactly the set `generateJunctionTables` emits. For each table that already exists and lacks a constraint named `linkUniqueName(table)`, it runs the clean-up, then:

```sql
ALTER TABLE "<t>" ADD CONSTRAINT "<name>" UNIQUE("left_id","right_id")
```

It returns the number of rows each table lost. dev prints one line for each table that lost rows, for example `Removed 3 duplicate links from junction_content_post_tags`. Push then finds the constraint already in place, so it plans no unique-constraint statement and never asks the truncate question. A table that does not exist yet is skipped, and push creates it with the constraint inline.

**A table from before #75.** It has no `order` column yet: `ensureLinkConstraints` runs before push, and push is what adds the column. For such a table the clean-up keeps the row with the lowest `ctid`. Rows of one pair differ only in `ctid` there, so nothing is lost. *(Author's call.)*

**Known limitation: renaming a many-to-many field or its owner type in `dev`.** A rename renames the link table, and with it the constraint. `ensureLinkConstraints` cannot see the rename ahead of push. If the developer tells push that the table was renamed, push drops the old unique constraint and adds the new one. On a table with rows, push then asks its truncate question. The question's default answer, "No, add the constraint without truncating the table", is safe, and the rows hold no duplicates by then. Real rename handling would mean driving push's rename prompts, which is out of proportion here. The ADR and the db changeset record this limitation. *(Author's call, after the builder check.)*

### 3. Writes (api)

`persistJunctionField` adds `ON CONFLICT DO NOTHING` to its `INSERT`, with no conflict target. Without it, the second of two overlapping saves would fail with a unique violation, a 500, once the constraint exists.

- **No target:** this is valid on a database that does not have the constraint yet, for example when the api package is upgraded before `manguito migrate` runs. There it changes nothing.
- **Order after a conflict:** the first insert's `order` values stand.

`firstOfEach` on the read side stays, because a database not yet migrated can still hold duplicates.

### 4. Constraint-name check (db, wired into the CLI)

`findConstraintNameCollisions(registry: SchemaRegistry): ParseError[]`, a pure function exported from the db package, computes every constraint name codegen produces for every table it emits. The names come from the same naming functions codegen uses, so the two cannot drift.

**Per-table names.** These must differ after truncation to 63 characters:

- each foreign key of a field column;
- each `<column>_check`;
- for a link table, its two foreign keys and `linkUniqueName`.

**Schema-wide names.** Index-backed constraints share Postgres's relation namespace, so these must also differ after truncation:

- every table name codegen emits (system, taxonomy, paragraph, content, link);
- every unique-constraint name (the link tables' and the system tables' drizzle defaults, such as `users_email_unique`);
- every primary-key name Postgres derives (`<table>_pkey`, with the table part shortened so the whole fits in 63 characters), **as a target only**. Primary keys are declared inline with no name, and Postgres numbers its choice (`…_pkey1`) when the name is taken, so two primary-key names never fail against each other and are not compared with one another. An explicitly named constraint that lands on one does fail, so the link tables' unique names are compared against them. *(Author's call, after the builder check.)*

**Error code.** The new code is `CONSTRAINT_NAME_COLLISION`, added to `ParseErrorCode` in `packages/core/src/parser/loader.ts`. That is a type-only change to core with no new dependency.

**Message.** Following #82's convention (`checkTableNameCollisions`), each message:

- names the two constraints and the table, in the editor's terms (field and type names);
- names the one shortening that clears the collision, with the exact maximum length. For a link table, that is "shorten field `f` to at most N characters, or the name of type `T`", with N worked out the way `checkTableNameCollisions` works out its `room`;
- has a suppression test. Applying the suggested change to the failing fixture must produce no error (the project's rule for error messages).

**Wiring.** The CLI calls the check wherever it calls `validateCrossReferences`, and treats the errors the same way:

- `loadValidatedSchema` in `dev.ts`;
- `build.ts`, which `migrate` runs through;
- `validate.ts`;
- `utils/registry.ts`.

The builder decides whether to fold the two calls into one CLI helper, so that a fifth call site cannot miss one of them.

**No errors on schemas that work today.** The check reports only names that collide after truncation. Such a schema's migration already fails, so the anti-goal on new validation errors holds. The builder verifies this against the sandbox schema (`apps/sandbox`), which has 71–72-character foreign-key names that differ within 63, and the check must pass it.

### 5. `migrate` rebuilds after an upgrade (cli)

*(The maintainer's decision, after the builder check.)* `manguito migrate` rebuilds only when `needsRebuild` (in `packages/cli/src/commands/build.ts`) finds `dist/generated/schema.ts` missing or older than a file under `schemas/`. After a package upgrade with no schema edit, the old `schema.ts`, which has no link constraints, still counts as current. drizzle-kit generate then finds no difference, and the upgrade never reaches the database. #75's `order` column had the same gap.

**The fix.** `runBuild` writes the versions of the installed `@bobbykim/manguito-cms-*` packages next to `schema.ts` in `dist/generated/`. It resolves them from the project, as `resolveAdminRoot` resolves the admin package. `needsRebuild` also returns true when that record is missing or differs from the installed versions. A project built before this release has no record, so the first `migrate` after upgrading rebuilds, which is the point. The rebuild also runs the constraint-name check (§4) on that path.

The builder picks:

- the record's file name and format;
- which packages it lists. The minimum is every package whose code shapes `dist/generated/`: core, db and cli.

## Testing expectations

Each test names the mutation it rejects (PLAN-QUALITY rule 1). The plan turns these into tasks.

- **Codegen:**
  - the generated link table declares the unique constraint, with the name from `linkUniqueName`;
  - `linkUniqueName` at 56 and 57 characters, and at the hash boundary: 63 characters, deterministic, and different for two long names sharing their first 47 characters.
- **`addLinkDedupe`, unit:**
  - the `ADD CONSTRAINT` is replaced by a `DO` block that runs the clean-up and then the constraint, only when `pg_constraint` lacks it;
  - applying the rewritten file to a database where the constraint already exists succeeds and changes nothing, which covers the dev-then-migrate case;
  - a `CREATE TABLE` with an inline unique is left alone;
  - SQL with no link constraint comes back unchanged.
- **Migrate path, integration** (pattern: `on-delete-change.integration.test.ts`):
  - generate and apply a schema whose link table has no constraint;
  - insert duplicate pairs with distinct and equal orders;
  - regenerate with the new codegen and apply;
  - the lowest-order row of each pair survives, every distinct pair survives, and a second insert of a pair is refused;
  - the real generate output matches the `addLinkDedupe` pattern, which guards against a drizzle-kit format change.
- **Dev path, integration:** `ensureLinkConstraints` on a table with duplicates removes exactly the extras and reports their count. A second run is a no-op. **The builder proves that a following `drizzle-kit push` plans no unique-constraint statement,** by running push non-interactively or by an equivalent check that does not stop on the prompt.
- **Api, integration:** two saves of one item, interleaved by hand (delete, delete, insert, insert, against the real database), store each pair once and return success. The existing test "reads a link stored twice once, keeping first-position order" in `relation-cardinality.read.integration.test.ts` inserts duplicate rows directly. Once the constraint exists, it must drop the constraint in its own setup to model an unmigrated database, or it has to be rewritten.
- **Rebuild after upgrade:** `needsRebuild` is true when the version record is missing or names a different version, and false when it matches and no schema file is newer. Mutations it rejects: ignoring the record, or treating a missing record as current.
- **Name check:**
  - a 62-character link table, and two foreign-key columns sharing a long prefix, are each refused with `CONSTRAINT_NAME_COLLISION`;
  - applying each message's suggestion clears it;
  - the sandbox schema and every existing fixture pass;
  - each of the four CLI entry points reports the error. At least one CLI test covers this, plus a call-site test or the shared helper's test.

## Release

Changesets:

- **db: minor.** A project that upgrades gets a new migration (the unique constraints, plus their clean-up), and the package gains exports.
- **cli: minor.** `dev` changes the database before push, and validation refuses schemas it didn't before (only ones whose migration already fails).
- **api: patch.**
- **core: patch.** It gains one error code.

The db changeset tells upgraders to run `manguito migrate` (production) or restart `manguito dev`, and says what the clean-up removes. `migrate` rebuilds on its own after the upgrade (§5).

**ADR.** Add one to `docs/adr/db/`: generated migrations may be rewritten by `runGenerate`, the first time manguito edits drizzle-kit's output, and dev adds link constraints before push. Amend ADR db/0002 to point to it.

## Calls the author made (for review)

1. The unique constraint gets an explicit name, `<link table>_unique`, with a hashed fallback past 56 characters, instead of drizzle's default.
2. The migrate path writes the clean-up into the generated `.sql` file. The dev path does the clean-up and adds the constraint itself, before push.
3. The clean-up keeps the lowest-`order` row of each pair.
4. The clean-up is not reported as a destructive operation.
5. `ON CONFLICT DO NOTHING` with no target on link inserts.
6. The constraint-name check lives in the db package and is wired into the CLI next to `validateCrossReferences`.
7. A unique constraint, not a composite primary key, because drizzle-kit's composite primary-key diffs are a known source of push churn.

8. The migrate rewrite guards the constraint with a `pg_constraint` check, so running `dev` and then `migrate` against one database works.
9. Primary-key names are only targets in the name check, never compared with each other.
10. Renaming a link field in dev may show push's truncate question, whose default answer is safe. This is recorded as a known limitation.

## Left to the builder

- The exact message wording, within §4's requirements.
- Whether to fold the CLI's validation calls into one helper.
- How the dev-path test drives drizzle-kit push without a TTY.

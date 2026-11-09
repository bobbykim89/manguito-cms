# Link Uniqueness and Constraint Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**

- Each link table stores a pair once, enforced by Postgres.
- Existing databases get there through both `manguito dev` and `manguito migrate`.
- A schema whose constraint names collide past 63 characters is refused at validate time.

**Architecture:**

- **db package:**
  - names the new unique constraint (`linkUniqueName`) and emits it from codegen;
  - rewrites each generated migration so the constraint is added only after its duplicates are cleaned up (`addLinkDedupe`);
  - adds the constraint itself before dev's push (`ensureLinkConstraints`);
  - computes every constraint name codegen produces, to report collisions (`findConstraintNameCollisions`).
- **api:** link inserts tolerate the constraint.
- **cli:**
  - calls the new db functions;
  - rebuilds before `migrate` when the installed manguito versions changed.

**Tech Stack:** TypeScript, drizzle-orm 0.45.2, drizzle-kit 0.31.10, Postgres, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-08-link-uniqueness-design.md](../specs/2026-11-08-link-uniqueness-design.md)

## Global Constraints

- Postgres keeps the first 63 bytes of an identifier. Every generated name is ASCII, so bytes are characters.
- Layer boundaries:
  - db imports only from core;
  - api imports from core and db;
  - cli imports from all.
- No new dependency in core. Core's only change is a new `ParseErrorCode` member.
- Use the Result type or an error list for expected failures; never throw for them. A database error inside `ensureLinkConstraints` may throw (ADR 0001: an unexpected failure).
- Follow the factory and function style: named function declarations for exports, and no barrel files other than each package's `src/index.ts`.
- Every new test carries a `// MUTATION:` comment naming the wrong implementation it rejects, and is run red under that mutation before going green (PLAN-QUALITY rule 1).
- Run tests with `pnpm --filter <pkg> test <file>`, without `--`. With `--`, the whole suite runs.
- The integration tests need the test database (`pnpm db:test:up`) and `.env.test`.
- api tests that build an app through `createTestApp` import the built api, so run `pnpm turbo run build --filter=@bobbykim/manguito-cms-api` before them.
- The db and cli packages typecheck against core's built `.d.ts`. After changing core, run `pnpm turbo run build --filter=@bobbykim/manguito-cms-core`.
- Commits use `type(scope): subject` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Facts measured for this plan (2026-11-08, at 9280a0d)

**drizzle-kit 0.31.10 `generate`, adding the constraint to an existing link table.** A throwaway spike produced, in this order:

```sql
ALTER TABLE "junction_content_a_tags" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "junction_content_a_tags" ADD CONSTRAINT "junction_content_a_tags_unique" UNIQUE("left_id","right_id");
```

A new table instead gets `CONSTRAINT "<name>" UNIQUE("left_id","right_id")` inside its `CREATE TABLE`.

**drizzle-kit 0.31.10 `push`,** spiked against the test database with `tablesFilter`, with stdin closed (`</dev/null`):

- **Table with rows, constraint missing:** push reaches its truncate prompt in `pgSuggestions` and prints a stack trace. It **exits 0** and the constraint is not added.
- **The same table after `ALTER TABLE … ADD CONSTRAINT "<same name>" UNIQUE(left_id, right_id)`:** push prints `[i] No changes detected` and exits 0.

So a test proves "push plans nothing" by asserting that push's output contains `No changes detected`, never by its exit code.

**drizzle naming,** from `drizzle-orm/pg-core`:

- foreign key: `${chunks.join("_")}_fk`, where the chunks are the table, its columns, the target table and the target columns (`foreign-keys.js`);
- unique default: `` `${table}_${columns.join("_")}_unique` `` (`unique-constraint.js`).

## Review Focus

These are the failure modes the spec implies but no other test would catch, most likely first. Each one has a test in the task named.

1. **A link table name over 56 characters**, which takes the hashed form of `linkUniqueName`, must still give `No changes detected` on a following push. Task 3 tests this.
2. **The reload path in `dev`.** `ensureLinkConstraints` must run before the second `runDevMigration` call, not only at startup. Task 4 tests this.
3. **A project with no link tables:**
   - `addLinkDedupe` returns its input unchanged;
   - `ensureLinkConstraints` returns `[]` and dev prints nothing.

   Tasks 2, 3 and 4 test this.
4. **`migrate --dry-run`** shows the clean-up, because `previewMigration` goes through the same rewrite. Task 2 tests this.
5. **A rewritten migration applied to a database that already has the constraint,** which is the dev-then-migrate flow, succeeds and deletes nothing. Task 2 tests this.

---

### Task 1: Name the constraint and emit it from codegen

**Files:**

- Create: `packages/db/src/link-tables.ts`
- Modify: `packages/db/src/codegen/index.ts` (`generateJunctionTables`)
- Modify: `packages/db/src/index.ts` (exports)
- Test: `packages/db/src/__tests__/link-tables.test.ts` (new)
- Test: `packages/db/src/codegen/__tests__/generateSchemaFile.test.ts`

**Interfaces:**

- Produces:
  - `linkUniqueName(tableName: string): string`
  - `linkDedupeSql(table: string, left: string, right: string, hasOrder: boolean): string`

  Both are exported from `@bobbykim/manguito-cms-db`.

- [ ] **Step 1: Write the failing tests** in `link-tables.test.ts`:
  - `linkUniqueName`:
    - a 56-character name gives `<name>_unique`, which is 63 characters;
    - a 57-character name gives exactly 63 characters, matching `` `${name.slice(0, 47)}_${sha256hex(name).slice(0, 8)}_unique` ``;
    - two 60-character names that share their first 47 characters give different results;
    - calling it twice gives the same result.

    `// MUTATION:` a plain `<name>_unique` with no fallback fails the 63-character assertion. A hash of the truncated name fails the "different results" case.
  - `linkDedupeSql("t", "left_id", "right_id", true)` equals:

    ```sql
    DELETE FROM "t" a USING "t" b WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id" AND (a."order", a.ctid) > (b."order", b.ctid)
    ```

  - With `hasOrder` false, the last condition is `a.ctid > b.ctid`.

  `// MUTATION:` reversing the comparison to `<` keeps the highest order. Task 3's integration test is what catches that, so note it there.

- [ ] **Step 2: Add a codegen test** in `generateSchemaFile.test.ts`.
  - **Short name:** for a registry with link table `junction_content_post_tags`, the output contains `s.unique('junction_content_post_tags_unique').on(table.left_id, table.right_id)`, inside the link table's extra-config callback.
  - **Long name:** a second case uses a field name long enough to make the link table name 60 characters, and asserts that the name inside `s.unique('…')` equals `linkUniqueName(thatTable)`.

  `// MUTATION:` emitting `s.unique().on(…)` with no name fails both cases.

- [ ] **Step 3: Run the new tests and check they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-db test link-tables generateSchemaFile`
Expected: FAIL. `linkUniqueName` isn't exported yet, and the `s.unique(` assertion fails.

- [ ] **Step 4: Implement**
  - In `link-tables.ts`:
    - `linkUniqueName` uses `node:crypto` `createHash('sha256')`;
    - `linkDedupeSql` builds the statement above, with identifiers double-quoted.
  - In `generateJunctionTables`, give each link table a `(table) => ({ pair: s.unique('<linkUniqueName>').on(table.<left>, table.<right>) })` callback, the shape `generateTableDef` uses for checks.
  - Export both functions from `src/index.ts`.

- [ ] **Step 5: Run the tests, then the package gates**

Run:

```bash
pnpm --filter @bobbykim/manguito-cms-db test link-tables generateSchemaFile
pnpm --filter @bobbykim/manguito-cms-db lint
pnpm --filter @bobbykim/manguito-cms-db typecheck
```

Expected: PASS. The existing `generateSchemaFile` assertions still pass, because they use `toContain`. If one compares a whole link-table block, update it to include the callback.

- [ ] **Step 6: Commit** as `feat(db): give every link table a unique (left, right) constraint`.

---

### Task 2: Clean up duplicates in generated migrations

**Files:**

- Modify: `packages/db/src/link-tables.ts` (add `addLinkDedupe`)
- Modify: `packages/db/src/migrations/index.ts` (`runGenerate`)
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/link-tables.test.ts`
- Test: `packages/db/src/migrations/__tests__/link-unique.integration.test.ts` (new; follow the temp-dir pattern of `on-delete-change.integration.test.ts` and the apply pattern of `migrations.integration.test.ts`)

**Interfaces:**

- Consumes: `linkDedupeSql` from Task 1.
- Produces: `addLinkDedupe(sql: string): string`, exported. `generateMigration` and `previewMigration` keep their signatures.

- [ ] **Step 1: Write the failing unit tests** for `addLinkDedupe` in `link-tables.test.ts`.
  - **Input:** the two measured statements under "Facts measured", verbatim, including `--> statement-breakpoint`.
  - **The `ADD COLUMN` line:** comes back unchanged and still first.
  - **The `ADD CONSTRAINT` statement:** replaced by one `DO $$ … $$;` block that, in order:
    - checks `NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"junction_content_a_tags"'::regclass AND conname = 'junction_content_a_tags_unique')`;
    - runs `linkDedupeSql('junction_content_a_tags', 'left_id', 'right_id', true)`;
    - runs the original `ALTER TABLE … ADD CONSTRAINT … UNIQUE("left_id","right_id")`.

    A `-- ` comment line above it says the block removes only repeated (left, right) pairs and keeps the lowest order.
  - **A `CREATE TABLE`** with an inline `CONSTRAINT "…" UNIQUE("left_id","right_id")` comes back byte-identical.
  - **SQL with no link constraint**, for example a plain `CREATE TABLE "content_x" (…)`, comes back byte-identical.
  - **A `--> statement-breakpoint`** that followed the original statement on the same line still follows the block.

  `// MUTATION:` matching any `UNIQUE(` fails the `CREATE TABLE` case. Dropping the `NOT EXISTS` guard fails Step 2's re-apply case.

- [ ] **Step 2: Write the failing integration test** `link-unique.integration.test.ts`. Its config uses the real `DB_URL` and a migrations table named `__manguito_migrations_link_unique`. Table names carry the prefix `lu_` so that they collide with nothing.

  **Before-schema (hand-built).** v1's `schema.ts` is a string written by hand to model the codegen output from before Task 1. Its invariants:
  - one content table `content_lu_post` (`id` uuid primary key);
  - one taxonomy table `taxonomy_lu_tag` (`id` uuid primary key);
  - link table `junction_content_lu_post_tags` with `left_id` and `right_id` (uuid, not null, cascading foreign keys) and `order` (integer, not null, default 0), with no unique constraint.

  v2 is the same string with the callback Task 1 emits, using `linkUniqueName('junction_content_lu_post_tags')`.

  Test steps:
  1. `generateMigration`, then `applyMigrations` v1.
  2. Insert pairs:
     - P1 at orders 2 and 0;
     - P2 at order 1, twice;
     - P3 once.
  3. Write v2, then `generateMigration`. Assert the new file contains `DO $$` and `pg_constraint`. This is the real-output guard against a drizzle-kit format change.
  4. `applyMigrations`. Assert the table holds exactly P1 at order 0, one P2 and P3.
  5. Inserting P3 again fails with a unique violation (`23505`).
  6. **Re-apply case:** run the generated v2 file's SQL a second time, statement by statement on the `--> statement-breakpoint` split, through `db.execute(sql.raw(…))`. It succeeds, and the row count is unchanged.
  7. **Dry run:** in step 3, call `previewMigration` before `generateMigration`, and assert that its SQL contains `DO $$` (Review Focus 4).

  Drop the tables and the migrations table in `afterAll`.

  `// MUTATION:`
  - remove the `runGenerate` rewrite, and step 4 fails with "could not create unique index";
  - change `>` to `<` in `linkDedupeSql`, and P1 survives at order 2.

- [ ] **Step 3: Run both tests and check they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-db test link-tables link-unique`
Expected: FAIL.

- [ ] **Step 4: Implement**
  - `addLinkDedupe` matches statements of the shape `ALTER TABLE "<t>" ADD CONSTRAINT "<n>" UNIQUE("left_id","right_id");`, as one regex over the file text.
  - `runGenerate` reads each new `.sql` file, applies `addLinkDedupe`, and writes it back only when the text changed.

- [ ] **Step 5: Run the tests and the db gates** (the Task 1 commands, adding `link-unique`).

Expected: PASS.

- [ ] **Step 6: Commit** as `feat(db): clean up duplicate links in the migration that adds their constraint`.

---

### Task 3: Add link constraints before dev's push

**Files:**

- Modify: `packages/db/src/link-tables.ts` (add `ensureLinkConstraints`)
- Modify: `packages/db/src/index.ts`
- Create: `docs/adr/db/0006-link-table-constraints-and-migration-rewrite.md`
- Modify: `docs/adr/db/0002-two-mode-migrations.md` (an amendment pointing to 0006)
- Test: `packages/db/src/__tests__/ensure-link-constraints.integration.test.ts` (new)

**Interfaces:**

- Consumes: `linkUniqueName` and `linkDedupeSql` from Task 1.
- Produces:

  ```ts
  ensureLinkConstraints(
    db: DrizzlePostgresInstance,
    registry: SchemaRegistry
  ): Promise<Array<{ table: string; removed: number }>>
  ```

  It returns one entry per table it added a constraint to, including tables where `removed` is 0.

- [ ] **Step 1: Write the failing integration test.** The registry is built with `parseSchema` and `buildSchemaRegistry`, as in `on-delete-change.integration.test.ts`. It has:
  - content `content--lu2_post`, with a many-to-many field `tags` targeting `taxonomy--lu2_tag`;
  - a second many-to-many field whose name makes its link table 60 characters long (Review Focus 1).

  Create the tables with `generateSchemaFile` output, minus the unique callbacks, through `drizzle-kit push` with `tablesFilter: ['*lu2_*']`. Alternatively use raw SQL that models the old codegen; the builder picks, and says which in a comment. Then:

  1. **Duplicates removed:** insert duplicates into both link tables, call `ensureLinkConstraints`, and get back `[{ table, removed }]` with the exact removed counts. Rows are kept as in Task 2.
  2. **Second run:** returns `[]`.
  3. **Push plans nothing:** run `drizzle-kit push` with the full schema and `tablesFilter: ['*lu2_*']`. **Never push to the shared test database without `tablesFilter`:** push drops every table that isn't in its schema. Run it through `spawnSync`, stdin `'ignore'` and a 60 s timeout. Its stdout and stderr together contain `No changes detected`.
  4. **Table missing:** the link table is absent and the registry lists it. Its entry is skipped.
  5. **Before #75:** a link table without an `order` column, holding a duplicate pair, ends up with one row. The `ctid` form was used.
  6. **No link tables:** a registry without any returns `[]` and runs no `ALTER`.

  `// MUTATION:`
  - adding the constraint under drizzle's default name fails step 3;
  - skipping the clean-up fails step 1 with a unique-index error;
  - not checking for the `order` column fails step 5.

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-db test ensure-link-constraints`
Expected: FAIL. `ensureLinkConstraints` isn't exported yet.

- [ ] **Step 3: Implement** `ensureLinkConstraints`. Iterate the link tables of `registry.content_types` and `registry.taxonomy_types`, the owners `generateJunctionTables` uses. For each:
  - check `to_regclass` for the table;
  - check `pg_constraint` (`conrelid`, `conname`) for the constraint;
  - check `information_schema.columns` for the `order` column;
  - count the removed rows from the `DELETE`'s `rowCount`, or by `RETURNING 1`.

- [ ] **Step 4: Write ADR db/0006.** It records:
  - **Link tables carry a unique pair,** under `linkUniqueName`.
  - **`runGenerate` rewrites generated SQL** (`addLinkDedupe`). This is the first time manguito edits drizzle-kit's output; give the reason (ADR 0002's reviewable file).
  - **dev adds the constraint before push,** to avoid push's truncate prompt.
  - **Known limitation:** renaming a link field in dev may show push's truncate question, and the default answer is safe.

  Add a dated amendment to ADR 0002 that links to it.

- [ ] **Step 5: Run the test and the db gates.** Expected: PASS.

- [ ] **Step 6: Commit** as `feat(db): add link constraints before dev's push`.

---

### Task 4: Wire `ensureLinkConstraints` into `manguito dev`

**Files:**

- Modify: `packages/cli/src/commands/dev.ts` (both `runDevMigration` call sites)
- Test: `packages/cli/tests/dev.test.ts`

**Interfaces:** Consumes `ensureLinkConstraints` from Task 3.

- [ ] **Step 1: Write the failing tests** in `dev.test.ts`. Add `ensureLinkConstraints` to the existing `vi.mock('@bobbykim/manguito-cms-db', …)`.
  - **Startup:**
    - `ensureLinkConstraints` is called before `runDevMigration`, compared by `mock.invocationCallOrder`;
    - when it returns `[{ table: 'junction_content_post_tags', removed: 3 }]`, stdout contains `Removed 3 duplicate links from junction_content_post_tags`;
    - with `removed: 0`, nothing about duplicates is printed.
  - **Reload:** using the existing `watchOneSchemaEdit` helper, it is called again before the second `runDevMigration` (Review Focus 2).

  `// MUTATION:`
  - calling it after `runDevMigration` fails the order assertion;
  - calling it only at startup fails the reload test.

- [ ] **Step 2: Run and check they fail:** `pnpm --filter @bobbykim/manguito-cms-cli test dev`.

- [ ] **Step 3: Implement.**
  - Call `ensureLinkConstraints(db.getDb(), registry)` right before each `runDevMigration(drizzleConfigPath)`.
  - Print one `printSuccess` line for each entry with `removed > 0`.
  - On reload, a throw is caught like the existing push failure: the `⚠` line on stderr, then `return`.

- [ ] **Step 4: Run the gates:**

```bash
pnpm build:packages
pnpm --filter @bobbykim/manguito-cms-cli test dev
pnpm --filter @bobbykim/manguito-cms-cli lint
pnpm --filter @bobbykim/manguito-cms-cli typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit** as `feat(cli): add link constraints before dev pushes the schema`.

---

### Task 5: Link inserts tolerate the constraint

**Files:**

- Modify: `packages/api/src/relations.ts` (`persistJunctionField`)
- Modify: `packages/api/src/__tests__/relation-cardinality.fixture.ts` (`createFixtureTables`)
- Modify: `packages/api/src/__tests__/relation-cardinality.read.integration.test.ts` (its `beforeAll`)
- Test: `packages/api/src/__tests__/relation-cardinality.write.integration.test.ts`
- Create: `.changeset/link-insert-on-conflict.md` (api: patch)

**Interfaces:** Consumes `linkUniqueName` from `@bobbykim/manguito-cms-db`, which api may import.

- [ ] **Step 1: Make the fixture model codegen.** `createFixtureTables` adds `, CONSTRAINT "<linkUniqueName(j.table_name)>" UNIQUE ("<left>", "<right>")` to each link table it creates.
  - The read test's "link stored twice" setup needs duplicates, so it first drops that constraint (`ALTER TABLE … DROP CONSTRAINT`), to model a database that hasn't been migrated yet.
  - Its comment says exactly that.

- [ ] **Step 2: Write the failing test** in the write test's `describe('many-to-many links keep their order and store each id once')`. The test is named `overlapping saves of one item store each link once`.
  - Wrap the test db in a proxy whose `execute` lets the first two calls through and holds every later call until both have finished. This forces delete A, delete B, insert A, insert B.
  - Call `persistJunctionField(proxy, postId, junction, [tagA, tagB])` twice through `Promise.all`.
  - Both resolve. The link table then holds exactly two rows for `postId`.

  `// MUTATION:`
  - removing `ON CONFLICT DO NOTHING` makes the second call reject with `23505`;
  - removing the fixture's constraint gives four rows.

- [ ] **Step 3: Build the api and run the tests; check that the new test fails**

```bash
pnpm turbo run build --filter=@bobbykim/manguito-cms-api
pnpm --filter @bobbykim/manguito-cms-api test relation-cardinality
```

Expected: the new test FAILS, and every other `relation-cardinality` test passes. That includes the read test, now that it drops the constraint itself.

- [ ] **Step 4: Implement:** append ` ON CONFLICT DO NOTHING` to both `INSERT` forms in `persistJunctionField`, with no conflict target. Update its comment to cover overlapping saves.

- [ ] **Step 5: Run the tests and the api gates** (`lint`, `typecheck`, and the Step 3 commands). Expected: PASS.

- [ ] **Step 6: Write the changeset.** api, patch: "Overlapping saves of one item no longer store a link twice."

- [ ] **Step 7: Commit** as `fix(api): overlapping saves store each link once`.

---

### Task 6: Constraint-name collision check

**Files:**

- Modify: `packages/core/src/parser/loader.ts` (add `'CONSTRAINT_NAME_COLLISION'` to `ParseErrorCode`)
- Create: `packages/db/src/constraint-names.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/constraint-names.test.ts` (new)
- Create: `.changeset/link-unique-constraint.md` (db: minor, core: patch)

**Interfaces:**

- Consumes: `linkUniqueName` from Task 1.
- Produces: `findConstraintNameCollisions(registry: SchemaRegistry): ParseError[]`, exported from the db package. It returns errors with code `CONSTRAINT_NAME_COLLISION`.

**Names computed** (spec §4), all compared after `.slice(0, 63)`.

Within each table:

- **Content, taxonomy and paragraph tables:**
  - for each field whose `db_column` has a `foreign_key` and no `junction`: `` `${table}_${column_name}_${fk.table}_${fk.column}_fk` ``;
  - for each field with a non-empty `check_constraint`: `` `${column_name}_check` ``.
- **Link tables:**
  - `` `${jt}_${left}_${ownerTable}_id_fk` ``;
  - `` `${jt}_${right}_${right_table}_id_fk` ``;
  - `linkUniqueName(jt)`.

Schema-wide:

- Each link table's `linkUniqueName` is compared against:
  - every table name, including the system tables `media`, `base_paths`, `roles` and `users`;
  - every other link unique name;
  - the system unique names `base_paths_name_unique`, `base_paths_path_unique`, `roles_name_unique`, `roles_hierarchy_level_unique` and `users_email_unique`;
  - every primary-key name.
- A primary-key name is `` `${table}_pkey` `` when that fits in 63 characters, otherwise `` `${table.slice(0, 58)}_pkey` ``.
- Primary keys are never compared with each other, and tables are never compared with each other (that is #82's check).

**Messages:** one error per colliding pair. For a link table, report once per table. Each message names the type and field, and the column too when `column_name` differs from the field name. Each message names one fix:

| Kind | When | The fix the message names |
|---|---|---|
| K1: a link table's two foreign keys | link table name of 62 characters or more | shorten field `f` to at most N characters, where N = 61 − `` `junction_${ownerTable}_` ``.length, or the name of type `T`. When N < 1, name only the type, worded as in `checkTableNameCollisions`. |
| K2: two foreign keys in one table | the two names agree in their first 63 characters | rename field `a` or `b` so that the two differ within their first N characters, where N = 62 − table length, or shorten the name of type `T` |
| K3: two `_check` names in one table | as K2 | as K2, with N = 57 |
| K5: a link unique name against a schema-wide name | as K2 | rename field `f` of type `T` |
| Any other pair | | a general message naming both constraints and both fields |

- [ ] **Step 1: Add the core code** and rebuild core: `pnpm turbo run build --filter=@bobbykim/manguito-cms-core`.

- [ ] **Step 2: Write the failing tests** in `constraint-names.test.ts`. Registries are built through `parseSchema` and `buildSchemaRegistry`.
  - **Pin to drizzle:** the foreign-key name rule equals drizzle's. Build a `pgTable` in the test with two long names, then compare `getTableConfig(t).foreignKeys[0].getName()` from `drizzle-orm/pg-core` with the string the check computes. To compare, export the rule as `foreignKeyName(table, column, targetTable, targetColumn)` from `constraint-names.ts`.
  - **K1:** a link table name of exactly 62 characters is refused. The suggested N is 61 − prefix. A fixture with the field shortened to N characters gives no errors (the suppression test). At 61 characters there are no errors.

    `// MUTATION:` an off-by-one in N fails the suppression test.
  - **K2:** a content type with two one-to-one reference fields whose names share their first 62 − table-length characters. It errors; the suggested rename clears it.
  - **K3:** two enum fields whose names share their first 57 characters. It errors; the rename clears it.
  - **K5:** a link unique name that equals another table's name. For example, fields `tags` and `tags_unique` on one type give link tables `junction_…_tags` and `junction_…_tags_unique`, and the first one's `linkUniqueName` is the second one's table name. It errors; renaming the field clears it.
  - **Working schemas pass:** a primary-key pair alone, two type tables sharing their first 58 characters, produces no error. Neither does the sandbox schema (`apps/sandbox/schemas`), loaded with `walkSchemaDirectory`, `parseSchema`, `parseRoles` and `parseRoutes`.

  `// MUTATION:`
  - comparing primary keys with each other fails the 58-character case;
  - leaving out truncation fails K1.

- [ ] **Step 3: Run and check they fail:** `pnpm --filter @bobbykim/manguito-cms-db test constraint-names`.

- [ ] **Step 4: Implement** `findConstraintNameCollisions` and `foreignKeyName`. Export both from `src/index.ts`.

- [ ] **Step 5: Run the tests and the db and core gates** (lint, typecheck). Expected: PASS.

- [ ] **Step 6: Write the changeset** (db: minor, core: patch). It says:
  - every link table gets a unique (left, right) constraint;
  - `manguito migrate` generates it, together with a clean-up that keeps the lowest-order copy of each repeated link, and `migrate` rebuilds on its own after the upgrade (Task 8);
  - a restart of `manguito dev` adds it directly;
  - the rename limitation, in one line;
  - schemas whose constraint names collide past 63 characters are now refused before migration, instead of failing in it.

- [ ] **Step 7: Commit** as `feat(db): refuse schemas whose constraint names collide in Postgres`.

---

### Task 7: Run the check wherever the CLI validates

**Files:**

- Create: `packages/cli/src/utils/schema-checks.ts`
- Modify:
  - `packages/cli/src/commands/dev.ts` (`loadValidatedSchema`)
  - `packages/cli/src/commands/build.ts`
  - `packages/cli/src/commands/validate.ts`
  - `packages/cli/src/utils/registry.ts`
- Test: `packages/cli/src/__tests__/schema-checks.test.ts` (new) and `packages/cli/tests/validate.test.ts`

**Interfaces:**

- Consumes: `findConstraintNameCollisions` from Task 6.
- Produces: `checkRegistry(registry: SchemaRegistry, maxFileSize: number | undefined): ParseError[]`. It returns `validateCrossReferences(...)`'s errors when there are any; otherwise it returns `findConstraintNameCollisions(registry)`.

- [ ] **Step 1: Write the failing tests.**
  - **`schema-checks.test.ts`,** with core and db mocked:
    - with cross-reference errors, those are returned and the collision check is not called;
    - without them, the collision errors are returned.

    `// MUTATION:` returning only cross-reference errors fails the second case.
  - **`validate.test.ts`:** mock the db package's `findConstraintNameCollisions` to return one `CONSTRAINT_NAME_COLLISION` error. `runValidate` exits 1, and its output contains the message.
  - **No other path:** `grep -rn "validateCrossReferences(" packages/cli/src` lists only `schema-checks.ts`. Add this as a check step, not a test.

- [ ] **Step 2: Run and check they fail:** `pnpm --filter @bobbykim/manguito-cms-cli test schema-checks validate`.

- [ ] **Step 3: Implement.** Replace the four `validateCrossReferences(registry, config.api.media?.max_file_size)` calls with `checkRegistry(...)`, keeping each site's existing error handling.

- [ ] **Step 4: Run the gates**

```bash
pnpm build:packages
pnpm --filter @bobbykim/manguito-cms-cli test
pnpm --filter @bobbykim/manguito-cms-cli lint
pnpm --filter @bobbykim/manguito-cms-cli typecheck
grep -rn "validateCrossReferences(" packages/cli/src
```

Expected:

- all PASS;
- the grep shows one line, in `schema-checks.ts`.

- [ ] **Step 5: Commit** as `feat(cli): check constraint names wherever the schema is validated`.

---

### Task 8: `migrate` rebuilds after a manguito upgrade

**Files:**

- Modify: `packages/cli/src/commands/build.ts` (`runBuild` writes the record; `needsRebuild` reads it)
- Test: `packages/cli/src/__tests__/build.test.ts` (`describe('needsRebuild')`)
- Create: `.changeset/migrate-rebuild-on-upgrade.md` (cli: minor)

**Interfaces:**

- Produces:
  - `installedManguitoVersions(cwd: string): Record<string, string>`;
  - `needsRebuild(cwd: string, installed?: Record<string, string>): Promise<boolean>`. The default for `installed` is `installedManguitoVersions(cwd)`.

  Both are exported from `build.ts`.
- The record lives at `dist/generated/manguito-versions.json`, as a JSON object mapping package name to version.

- [ ] **Step 1: Write the failing tests** in the existing `describe('needsRebuild')`, extending its `node:fs` mock with `readFileSync`. With `schema.ts` newer than every schema file:
  - **Record missing:** returns true.
  - **Record names a different version:** for example `{"@bobbykim/manguito-cms-db":"0.2.1"}` against installed `0.3.0`. Returns true.
  - **Record matches installed:** returns false.

  `// MUTATION:`
  - ignoring the record fails the first two cases;
  - treating a missing record as current fails the first.

- [ ] **Step 2: Run and check they fail:** `pnpm --filter @bobbykim/manguito-cms-cli test build`.

- [ ] **Step 3: Implement.**
  - **`installedManguitoVersions`:**
    - covers `@bobbykim/manguito-cms-core`, `-db`, `-api`, `-admin` and `-cli`;
    - resolves each package's entry with `createRequire(join(cwd, 'package.json')).resolve(name)`, then reads the nearest `package.json` above it. A package's `exports` may not list `./package.json`, so it can't be resolved directly;
    - skips a package it cannot resolve.
  - **`runBuild`:** writes the record right after `schema.ts`.
  - **`needsRebuild`:** compares the record with `installed` by deep equality.

- [ ] **Step 4: Run the gates** (the Task 7 commands, with `build`). Expected: PASS.

- [ ] **Step 5: Write the changeset.** cli, minor:
  - `manguito migrate` rebuilds when the installed manguito packages changed since the last build;
  - `dev` adds link constraints before pushing;
  - validation refuses colliding constraint names.

- [ ] **Step 6: Commit** as `feat(cli): rebuild before migrate when manguito packages were upgraded`.

---

### Task 9: Full gates

- [ ] **Step 1:** Run the CI steps:

```bash
pnpm lint
pnpm build:packages
pnpm typecheck
pnpm test
pnpm smoke
```

Expected: all pass. If a test outside this plan's files fails because the new constraint now refuses duplicate rows it inserts, fix it the way Task 5 fixed the read test. List each one in the PR body.

- [ ] **Step 2:** Run `pnpm lint:plans` on this plan and the spec. Expected: "Plan checks passed."

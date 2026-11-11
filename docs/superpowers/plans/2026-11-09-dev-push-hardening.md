# Dev Push Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dev's push from re-planning long foreign keys (#88), make `ensureLinkConstraints` one round trip (#89), and run one dev reload at a time through one shared schema loader (#72).

**Architecture:**

- **db.** Foreign keys whose drizzle default name is over 63 characters get a hashed 63-character name. Codegen emits it through an explicit `s.foreignKey(…)`, and `findConstraintNameCollisions` checks the same name, which removes its foreign-key collision errors. `ensureLinkConstraints` reads every link table's state in one catalog query.
- **cli.** A coalescing queue serializes dev reloads across both watchers. One `parseProjectSchemas` replaces six copies of the schema-parsing loop.

**Tech Stack:** TypeScript (strict), drizzle-orm 0.45 / drizzle-kit 0.31.10, Postgres, Vitest, pnpm + Turborepo.

**Spec:** [docs/superpowers/specs/2026-11-09-dev-push-hardening-design.md](../specs/2026-11-09-dev-push-hardening-design.md)

## Global Constraints

- db imports only from core; cli imports from all. No new dependencies (`node:crypto` is built in and already used by `linkUniqueName`).
- Expected failures return a `Result` (`{ ok: true; value } | { ok: false; errors: ParseError[] }`, from core's `parser/loader.ts`); nothing throws for them.
- Every `drizzle-kit push` in a test uses a positive `tablesFilter`. Never a negated one, never none: the test DB is shared.
- A foreign key whose drizzle default name is ≤ 63 characters is emitted exactly as today: inline `.references(…)`.
- Hashed name: `<default>.slice(0, 51)` + `_` + first 8 hex characters of `sha256(<whole default name>)` + `_fk`, which is 63 characters.
- **Changesets:**
  - db patch: Tasks 1–3, in one file written in Task 1 and extended in Tasks 2 and 3.
  - cli patch: Tasks 4–5, in one file written in Task 4 and extended in Task 5.
- Commits: conventional `type(scope): subject`, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test commands** (run from the repo root; no `--` before the file):
  - `pnpm --filter @bobbykim/manguito-cms-db test <file>`
  - `pnpm --filter @bobbykim/manguito-cms-cli test <file>`
  - The test DB must be up (`pnpm db:test:up`).
- Every test carries a `// MUTATION:` comment naming the wrong implementation it rejects, and each task runs it red under that mutation before committing (PLAN-QUALITY rule 1).
- Gates per task: the package's `test`, `typecheck` and `lint` (`pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`).

## Review Focus

1. **A type table with a long foreign key and no enum field.** `generateTableDef` today returns a table with no constraint callback when there are no enum fields. The long foreign key must still be emitted, not dropped. Test in Task 1.
2. **A self-referencing many-to-many on a long-named type.** Left and right both target the owner table. Their default names differ only in `left_id`/`right_id`, and the two hashed names must differ. Test in Task 1.
3. **A long foreign key on a paragraph table**, such as a media column. Paragraph tables go through the same `generateTableDef`. Test in Task 1.
4. **`onDelete` other than cascade on an explicit foreign key** (`restrict`, `set null`). It must survive the move out of `.references(…)`. Test in Task 1.
5. **A schema-file parse error and a broken `roles.json` together.** The shared loader must report both, not stop at the first. Test in Task 5.

---

### Task 1: Hashed names for long foreign keys in codegen

**Files:**

- Modify: `packages/db/src/constraint-names.ts` (add the name function beside `foreignKeyName`)
- Modify: `packages/db/src/codegen/index.ts` (`generateFieldColumn`, `generateTableDef`, `generateJunctionTables`)
- Test: `packages/db/src/__tests__/constraint-names.test.ts`, `packages/db/src/codegen/__tests__/generateSchemaFile.test.ts`, `packages/db/src/__tests__/ensure-link-constraints.integration.test.ts`
- Create: `.changeset/hashed-foreign-key-names.md`

**Interfaces:**

- Produces: `export function codegenForeignKeyName(table: string, column: string, targetTable: string, targetColumn: string): string`. It returns `foreignKeyName(...)` when that is ≤ 63 characters, else the hashed name from Global Constraints.
- Produces: `generateFieldColumn(field: ParsedField, options?: { inlineReference?: boolean }): string | null`. `inlineReference` defaults to `true`; `false` omits `.references(…)`.
- Explicit foreign keys go in the table's constraint callback as `<column>_fk: s.foreignKey({ name: '<name>', columns: [table.<column>], foreignColumns: [<targetVar>.<targetColumn>] }).onDelete('<onDelete>'),`. That's the same object-style callback the enum checks use, and both share one callback.

- [ ] **Step 1: Write the name-function tests** in `constraint-names.test.ts`, in a new `describe('codegenForeignKeyName')`.
  - `it('keeps drizzle's name when it is exactly 63 characters')`: build a default name of exactly 63 characters and `expect(codegenForeignKeyName(...)).toBe(foreignKeyName(...))`. MUTATION: hash at `>= 63`.
  - `it('hashes a 64-character name to 63 characters')`:
    - `toHaveLength(63)`;
    - `startsWith(default.slice(0, 51) + '_')`;
    - `endsWith('_fk')`;
    - matches `/^.{51}_[0-9a-f]{8}_fk$/`.

    MUTATION: a 52-character prefix.
  - `it('gives different names to two foreign keys that share their first 51 characters')`: use the same table and target with columns `left_id` and `right_id` on a long link table. MUTATION: hash only the table name.
- [ ] **Step 2: Write the codegen tests** in `generateSchemaFile.test.ts`, in a new `describe('generateSchemaFile — long foreign-key names (#88)')`. Build fixtures through `parseSchema` + `buildSchemaRegistry` (the file already imports `parseSchema`), so table and column names are the real producer's.
  - **Link table.** A link table whose foreign keys pass 63 characters: `junction_content_<long>_post_<field>`. The output contains `s.foreignKey({ name: '<codegenForeignKeyName(link, 'left_id', owner, 'id')>'` and `.onDelete('cascade')`. Its `left_id:` line has no `.references(`. MUTATION: keep the inline `.references` as well.
  - **Self-reference (Review Focus 2).** A self-referencing long type: two `s.foreignKey(` entries with different names. MUTATION: hash the table name only.
  - **Type table without enums (Review Focus 1).** A long reference column and no enum: the output contains `s.foreignKey(` and a constraint callback. MUTATION: emit the callback only when enum fields exist.
  - **Type table with enums.** A long reference plus an enum: one callback with both `s.check(` and `s.foreignKey(`. MUTATION: a second callback argument.
  - **Paragraph table (Review Focus 3).** A long media column: `s.foreignKey(` naming `media`.
  - **onDelete (Review Focus 4).** A long reference with `on_delete` mapped to `set null` emits `.onDelete('set null')`. MUTATION: hard-code `'cascade'`.
  - **Short names.** The existing snapshot test (`matches snapshot for testParsedSchema fixture`) must pass unchanged. All its foreign keys are 25–62 characters (measured 2026-11-09). MUTATION: always emit explicit foreign keys.
- [ ] **Step 3: Tighten and add the push tests** in `ensure-link-constraints.integration.test.ts`.
  - **Tighten** `'plans no unique-constraint change for the hashed-name link table'`: replace its body's churn allowance with `expect(out).toContain('No changes detected')`, and update its comment and MUTATION to "codegen keeps the inline `.references()` for long names". The test name may become `'plans nothing for the 60-character link table'`.
  - **Add** `it('renames long foreign keys once on the first push after the upgrade, then plans nothing')`:
    - New fixture prefix `lu5`, added to `dropAll`. Push it with the current codegen and filter `['*lu5_*']`.
    - Model the old database: `ALTER TABLE … RENAME CONSTRAINT "<hashed>" TO "<foreignKeyName(...)>"` for each long foreign key. Postgres cuts the new name to 63 characters, exactly what the old codegen left behind. Invariant modelled: old and new codegen differ only in foreign-key names.
    - Push again. Then `pg_constraint` (`contype = 'f'`) lists the hashed names, with `confdeltype = 'c'` and the same `conkey`/`confrelid` as before the rename.
    - A third push prints `No changes detected`.
    - MUTATION: name foreign keys `<default>.slice(0, 63)`, which makes the second push plan nothing, so the hashed names never appear.
- [ ] **Step 4: Run all three files and confirm the new tests fail** (`codegenForeignKeyName` is undefined; the push test sees FK statements).
- [ ] **Step 5: Implement** `codegenForeignKeyName` (with `createHash('sha256')` from `node:crypto`), the `inlineReference` option and the callback entries.
  - `generateTableDef` computes each column's name with `codegenForeignKeyName(tableName, col.column_name, fk.table, fk.column)`.
  - `generateJunctionTables` does the same with `(jt.table_name, jt.left_column, owner table, 'id')` and `(jt.table_name, jt.right_column, jt.right_table, 'id')`.
  - Leave `users.role_id` in `SYSTEM_TABLES_SECTION` alone.
- [ ] **Step 6: Run the three files, then `pnpm --filter @bobbykim/manguito-cms-db typecheck` and `lint`.** All pass. Run each new test red under its MUTATION, then restore.
- [ ] **Step 7: Write `.changeset/hashed-foreign-key-names.md`** (`'@bobbykim/manguito-cms-db': patch`). It says:
  - foreign keys whose names pass 63 characters get a hashed 63-character name, so dev's push stops re-planning them (#88);
  - an existing project's long foreign keys are renamed once, on its next dev push or in its next generated migration.
- [ ] **Step 8: Commit** `fix(db): give foreign keys past 63 characters a hashed name`.

### Task 2: Collision check on the emitted names

**Files:**

- Modify: `packages/db/src/constraint-names.ts` (`typeTableConstraints`, `typeTableMessage`, `checkLinkTable`)
- Modify: `docs/adr/db/0006-link-table-constraints-and-migration-rewrite.md`
- Test: `packages/db/src/__tests__/constraint-names.test.ts`
- Modify: `.changeset/hashed-foreign-key-names.md`

**Interfaces:**

- Consumes: `codegenForeignKeyName` (Task 1).
- `findConstraintNameCollisions(registry: SchemaRegistry): ParseError[]` keeps its signature.

- [ ] **Step 1: Rewrite the foreign-key tests to expect a pass.** The describes are named `(K1)` and `(K2)`.
  - **K1:** the 62-character link table and the 43-`b` type both give `collisions(...)` equal to `[]`. MUTATION: `checkLinkTable` still compares `stored(foreignKeyName(...))`.
  - **K2:** both fixtures (`one`/`two`, and the 54-`p` type) give `[]`. MUTATION: `typeTableConstraints` still uses `foreignKeyName`.
  - Delete the K1/K2 tests that only checked message text or suppression of errors that no longer occur:
    - `is cleared by shortening…`;
    - `is cleared by a rename…`;
    - `names the column…`;
    - `suggests changing a declared column…`;
    - `names the longest type name…`.

    Keep `names a foreign key the way drizzle does`.
- [ ] **Step 2: Re-fixture the two foreign-key-and-check tests** (in `names in more than one kind of constraint`).
  - Use a reference column whose default foreign-key name is exactly 63 characters: on `content_post` that is a 31-character column.
  - Use an enum column named that 63-character foreign-key name plus `_x`, so its `<column>_check` cut to 63 equals the foreign key. Core allows field names over 63 characters; `DUPLICATE_COLUMN` compares only the first 63, which differ here.
  - Keep both tests' assertions: the error names both fields, suggests at most 56 characters for the enum field, and shortening to that clears it. MUTATION as today.
- [ ] **Step 3: Run `constraint-names.test.ts`.** Expect the K1/K2 pass tests to FAIL.
- [ ] **Step 4: Implement.**
  - `typeTableConstraints` and `checkLinkTable` name foreign keys with `codegenForeignKeyName`.
  - Remove `checkLinkTable`'s left-and-right branch (the 61-character advice). Its remaining message covers any coincidence and names all three constraints.
  - Replace `typeTableMessage`'s foreign-key-pair branch with a short message for a hash coincidence that names both fields and suggests renaming one. No fixture can reach it; say so in a comment, like the existing link-table one.
  - Update the comments that describe the removed errors.
- [ ] **Step 5: Run `constraint-names.test.ts`, `typecheck` and `lint`.** All pass; run each changed test red under its MUTATION.
- [ ] **Step 6: Amend ADR db/0006.**
  - Add a section: foreign keys past 63 characters use the same hashed-name scheme as link uniques. Foreign-key `CONSTRAINT_NAME_COLLISION` errors are gone, and an existing project's long foreign keys are renamed once.
  - Check `docs/adr/db/0002-two-mode-migrations.md`'s amendment and `packages/db/CONTEXT.md` for text describing the removed errors. Fix any you find; `grep -n "61\|foreign key" <file>` showed none in CONTEXT.md on 2026-11-09.
- [ ] **Step 7: Extend the changeset.** Add a line saying schemas that failed with a foreign-key `CONSTRAINT_NAME_COLLISION` now pass.
- [ ] **Step 8: Commit** `fix(db): check the hashed foreign-key names and drop their collision errors`.

### Task 3: One catalog query in `ensureLinkConstraints` (#89)

**Files:**

- Modify: `packages/db/src/link-tables.ts` (`ensureLinkConstraints`)
- Test: `packages/db/src/__tests__/ensure-link-constraints.integration.test.ts`
- Modify: `.changeset/hashed-foreign-key-names.md`

**Interfaces:**

- `ensureLinkConstraints(db: DrizzlePostgresInstance, registry: SchemaRegistry): Promise<Array<{ table: string; removed: number }>>` is unchanged.

- [ ] **Step 1: Write the tests.**
  - `it('reads every link table's state in one query when every constraint exists')`:
    - Wrap `db` in `{ ...db, execute: (q) => { calls++; return db.execute(q) } }`, cast to `DrizzlePostgresInstance`.
    - Place it directly after the first test, which constrains `main`'s two link tables. Later tests drop `LONG_LINK` and a constraint.
    - `ensureLinkConstraints(counting, main)` resolves `[]` with `calls === 1`.
    - MUTATION: one lookup per link table gives 2 or 4.
  - `it('sends no query for a registry without link tables')`: use `empty` and expect `calls === 0`. MUTATION: run the catalog query with an empty list.
- [ ] **Step 2: Run the file.** Expect the first test to FAIL (calls = 4: two lookups × two tables).
- [ ] **Step 3: Implement.**
  - Send one `db.execute` that returns, for each registry link table found in `current_schema()`, its name, whether `linkUniqueName(table)` exists in `pg_constraint` for it, and whether `pg_attribute` has a live `order` column.
  - Then, per table missing the constraint, run the existing `linkDedupeSql(...) RETURNING 1` and `ADD CONSTRAINT`, in registry order.
  - Pass table and constraint names as parameters, not interpolated. drizzle's `sql` template expands a JS array into a parenthesised parameter list, not a Postgres array. Use `sql.join` or one `ARRAY[...]` per list.
- [ ] **Step 4: Run the whole file.** It must pass, including `skips a link table the registry lists but the database lacks` and `cleans a link table that has no order column`. Then run `typecheck` and `lint`, and run the new tests red under their MUTATIONs.
- [ ] **Step 5: Extend the changeset.** Add: `ensureLinkConstraints` reads all link tables in one query (#89).
- [ ] **Step 6: Commit** `perf(db): read link-table constraints in one catalog query`.

### Task 4: One dev reload at a time (#72)

**Files:**

- Create: `packages/cli/src/utils/reload-queue.ts`
- Test: `packages/cli/src/utils/__tests__/reload-queue.test.ts`
- Modify: `packages/cli/src/commands/dev.ts` (the two watcher loops in `runDev`)
- Test: `packages/cli/tests/dev.test.ts`
- Create: `.changeset/dev-reload-queue.md`

**Interfaces:**

- Produces: `export function createReloadQueue(run: () => Promise<void>): () => Promise<void>`.
  - Calling the returned trigger starts `run` when idle.
  - While a run is in flight, any number of triggers mark one follow-up run, which starts when the current run settles.
  - The promise a trigger returns resolves once a run that started after that trigger has settled. It never rejects, even when `run` rejects.

- [ ] **Step 1: Write `reload-queue.test.ts`** with deferred promises (no timers).
  - `it('never runs two reloads at once')`: track the number of active runs, trigger twice and settle both. Max active is 1. MUTATION: call `run` on every trigger.
  - `it('collapses triggers during a run into one more run')`: trigger, trigger 3× during the run, settle everything. `run` is called 2 times. MUTATION: queue every trigger, giving 4.
  - `it('starts a new run for a trigger after the queue goes idle')`: trigger, settle, trigger. 2 runs. MUTATION: never reset the pending flag after the follow-up.
  - `it('keeps going after a run that rejects')`: the first run rejects, with a trigger during it. The follow-up runs and both trigger promises resolve. MUTATION: no catch, so the follow-up never starts.
- [ ] **Step 2: Run it.** It FAILS: the module doesn't exist.
- [ ] **Step 3: Implement `createReloadQueue`.**
- [ ] **Step 4: Write the dev test** `it('runs reloads from both watchers one at a time')` in `dev.test.ts`.
  - Mock `node:fs` `existsSync` to `true` (through `importOriginal`) so the programmatic watcher starts.
  - Give `fsWatch` a `mockImplementation` that returns a fresh one-event iterator per call.
  - Make `runDevMigration` resolve on startup, then wait on a deferred for each reload.
  - Expect the second reload's `generateDrizzleConfig` call not to happen before the first reload's deferred is released. Release it; then exactly 3 `runDevMigration` calls in all (startup + 2).
  - MUTATION: give each watcher its own queue, or call `reloadSafely` directly.
- [ ] **Step 5: Wire dev.**
  - In `runDev`, create one queue around `reloadSafely({ … })`, with the args both loops pass today.
  - Both loops call `void reload()` without awaiting, so a burst of events collapses into one follow-up.
  - Keep `reloadSafely`, which still catches everything.
- [ ] **Step 6: Run both test files, then `pnpm --filter @bobbykim/manguito-cms-cli typecheck` and `lint`.** All pass, including the existing reload tests (`adds link constraints again before the push on a schema reload`, `keeps running when a reload throws…`). Run the new tests red under their MUTATIONs.
- [ ] **Step 7: Write `.changeset/dev-reload-queue.md`** (`'@bobbykim/manguito-cms-cli': patch`): saves close together in `manguito dev` run one reload at a time, and a burst of saves runs at most one more.
- [ ] **Step 8: Commit** `fix(cli): run one dev reload at a time`.

### Task 5: One schema loader (#72)

**Files:**

- Modify: `packages/cli/src/utils/registry.ts` (add `parseProjectSchemas`; `loadWorkingRegistry` uses it; fix its docstring)
- Modify: `packages/cli/src/commands/build.ts`, `dev.ts` (remove `parseAllSchemas`), `migrate.ts`, `start.ts`, `validate.ts`
- Test: `packages/cli/src/utils/__tests__/registry.test.ts` (create); `packages/cli/tests/{build,validate,migrate,start}.test.ts`
- Modify: `.changeset/dev-reload-queue.md`

**Interfaces:**

- Produces: `export function parseProjectSchemas(cwd: string, config: ResolvedManguitoConfig): Result<SchemaRegistry>`.
  - It walks `resolveSchemaConfig(cwd, config)` and parses each file, `roles.json` and `routes.json` (both under `resolve(cwd, config.schema.base_path)`).
  - It collects every error and never prints or exits. On success it returns `buildSchemaRegistry(...)`.

- [ ] **Step 1: Pin today's output before refactoring.** These are characterization tests: they PASS on the current code. Add them to each command's test file with its existing core mocks:
  - **build.** A failing `parseSchema` makes stderr contain `Schema parse errors` and exits 1. A success with 1 content, 1 enum and 0 others prints `Schemas parsed (1 content types, 0 paragraph types, 0 taxonomy types, 1 enum types)`.
  - **validate.** A success prints `Schemas valid (1 content types, 0 paragraph types, 0 taxonomy types)`; a parse failure prints `Validation errors`.
  - **migrate and start.** A parse failure prints `Schema errors prevented seeding system tables.` and exits 1.
  - **version.** `loadWorkingRegistry` prints `Schema parse errors` naming the command. Use the existing `version-create.test.ts` temp project if that's simpler.

  MUTATION for each: the refactored command prints a different heading or count.

  The command tests mock core. The real `buildSchemaRegistry` returns `all_schemas` equal to the schemas it was given (PLAN-QUALITY rule 4). Make the mocked one do the same, so the count tests hold both before the refactor (counts from the parsed list) and after it (counts from the registry).
- [ ] **Step 2: Run them.** All PASS on the current code.
- [ ] **Step 3: Write `registry.test.ts`** for `parseProjectSchemas`, mocking core.
  - **Both failures (Review Focus 5).** `parseSchema` failing for one file and `loadSchemaFile` failing for `roles.json`: the result is `{ ok: false }` with both errors. MUTATION: return after the schema-file errors.
  - **Absolute walk.** It calls `walkSchemaDirectory` with an absolute `base_path` (`resolve(cwd, 'schemas')`). MUTATION: pass `config.schema`.
  - **Success.** It returns `{ ok: true, value }` from `buildSchemaRegistry`.
- [ ] **Step 4: Run it.** It FAILS: no export.
- [ ] **Step 5: Implement `parseProjectSchemas`; switch the six call sites.**
  - Each command keeps its own reaction: heading, `printGuidedError`, exit or return.
  - Each keeps its own extra checks: `checkRegistry`, version model, deprecations.
  - build and validate compute their counts from `registry.all_schemas` (it keeps every parsed schema, duplicates included).
  - Delete `dev.ts`'s `parseAllSchemas` and the now-unused imports.
- [ ] **Step 6: Run the whole cli suite** (`pnpm --filter @bobbykim/manguito-cms-cli test`), then `typecheck` and `lint`. All pass. Run the new tests red under their MUTATIONs.
- [ ] **Step 7: Extend the cli changeset.** Add: every command parses schemas through one loader, and the output is unchanged.
- [ ] **Step 8: Commit** `refactor(cli): parse project schemas through one loader`.

### Task 6: Whole-branch gates

- [ ] **Step 1:** From the repo root, run `pnpm lint && pnpm build:packages && pnpm typecheck && pnpm test && pnpm smoke`. Every one must pass.
- [ ] **Step 2:** `git grep -n "parseAllSchemas\|61 characters"` returns nothing outside `docs/superpowers/`.

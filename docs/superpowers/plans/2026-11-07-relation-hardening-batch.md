# Relation Hardening Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the small items of issue #57 in one PR: the delete that its own paragraph blocks, keyboard reordering for paragraph lists, presence checks, relation read order and de-duplication, the missing tests, and the listed cleanup.

**Architecture:** Each task is self-contained and lands as its own commit on one branch, `fix/relation-hardening-batch`, opened as one PR that closes the listed #57 items. Tasks touch `packages/api` (delete path, read paths, presence checks, tests), `packages/admin` (paragraph reorder, form state), `packages/cli` and `packages/db` (tests), and `packages/test-utils` (shared seeding). No schema, migration or public API shape changes.

**Tech Stack:** TypeScript strict, Vitest, Hono, Drizzle (raw `sql`), Postgres 16, Vue 3 + `@vue/test-utils`.

**Spec:** [issue #57](https://github.com/bobbykim89/manguito-cms/issues/57), the unchecked items as of master `9ae8e54` (2026-11-07). Out of scope, each its own later PR: "Concurrent saves can double links" (needs a migration with a clean-up step), "Constraint names can still collide past 63 characters" (needs drizzle's naming in db codegen), "Chip labels load whole items" (needs a lighter read endpoint).

## Global Constraints

- Conventional commits, `type(scope): subject`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every new test carries a `// MUTATION:` comment naming the wrong implementation it fails against, and each task verifies red under that mutation before committing (PLAN-QUALITY rule 1).
- Route integration tests import the BUILT api: rebuild with `pnpm turbo run build --filter=@bobbykim/manguito-cms-api` before running them.
- Run tests through the package script so `.env.test` loads: `pnpm --filter <pkg> test -- <file>`. The test database must be up (`pnpm db:test:up`).
- Gates for every task (rule 7): `pnpm lint`, `pnpm typecheck`, and the package's tests. The final task also runs `pnpm build:packages`, the full `pnpm test` and `pnpm smoke`.
- Changesets: `@bobbykim/manguito-cms-api` patch and `@bobbykim/manguito-cms-admin` patch (behaviour fixes); none for test-only, cli-test or db-test changes.

## Review Focus

1. Deleting an item whose **nested** own paragraph (one level, ADR core/0005) holds the required reference back to it: must delete, like a direct one. Pinned in Task 1.
2. Deleting an item that **both** its own paragraph and another item's paragraph refer to: must still be 409, counting only the other item. Pinned in Task 1.
3. A schema field literally named `constructor` or `toString` (valid snake_case), absent from a PATCH body: must be treated as absent. Pinned in Task 3.
4. A many-to-many list stored with a repeated id **and** distinct ids: reads must drop only the repeat and keep first-position order. Pinned in Task 4.
5. Moving the last paragraph item later, or the first earlier: must not exist as an action, and focus must stay on the moved item. Pinned in Task 2.

---

### Task 1: Delete an item whose own paragraph refers back to it

The in-use pre-check (`findRequiredReferrers` in `packages/api/src/references-in-use.ts`) counts the item's own paragraph rows as uses, and both delete routes delete the item's row before its paragraphs, so RESTRICT refuses it too. Exclude own paragraph rows from the count; when an own paragraph does refer back, delete the paragraphs first.

**Files:**
- Modify: `packages/api/src/relations.ts` (new export `ownParagraphRowIds`)
- Modify: `packages/api/src/references-in-use.ts` (`findRequiredReferrers` return shape)
- Modify: `packages/api/src/routes/admin/content.ts` (both `app.delete` handlers; new module-level `deleteOwnParagraphs`, replacing the two `for (const f of paragraphFieldDefs)` delete loops)
- Test: `packages/api/src/__tests__/relation-cardinality.delete.integration.test.ts`

**Interfaces:**
- Produces: `ownParagraphRowIds(db: DrizzlePostgresInstance, registry: SchemaRegistry, fields: ParsedField[], itemId: string): Promise<string[]>` in `relations.ts`: ids of every paragraph row the item owns, direct and nested one level.
- Produces: `findRequiredReferrers(db, registry, targetType, id): Promise<{ others: ReferrerCount[]; fromOwnParagraphs: boolean }>`. `others` keeps today's `ReferrerCount[]` and excludes rows in `ownParagraphRowIds`; `fromOwnParagraphs` is true when one of those own rows references the item.
- Produces: `deleteOwnParagraphs(db: DrizzlePostgresInstance, registry: SchemaRegistry, fields: ParsedField[], itemId: string): Promise<MediaDelta[]>` in `content.ts`, used by both delete routes.

- [ ] **Step 1: Write the failing tests** in a new `describe('an item whose own paragraph refers back to it', ...)`. Build its registry through `parseOrThrow` + `buildSchemaRegistry`, as the file's `selfRegistry` does: taxonomy `taxonomy--rcdelown_node` (label `Node`) with a one-to-many paragraph field `blocks` → `paragraph--rcdelown_block` (label `Block`), which has a required one-to-one reference `back` (label `Back`) → `taxonomy--rcdelown_node` and a one-to-one paragraph field `inner` → `paragraph--rcdelown_inner`, which has a required reference `back` → the node type. Create its tables with `tableSql`, and drop them in `afterAll`.
  - `it('deletes it, with its paragraphs, when only its own paragraph refers back')`: insert node N, a block row (parent N) with `back = N`. Expect `DELETE` 200, N's row and the block row gone. `// MUTATION: count own paragraph rows as uses (today's findRequiredReferrers). The delete is a 409.`
  - `it('deletes it when the reference back is in a nested paragraph')`: block row (parent N) with `back` = another node M; inner row (parent = block row id) with `back = N`. Expect 200, N, block and inner rows gone. `// MUTATION: collect only direct paragraph rows in ownParagraphRowIds. The nested row counts as a use: 409.`
  - `it('still refuses while another item's paragraph refers to it, counting only that one')`: N with an own block referring to N; node M with a block referring to N. Expect 409 with message `'This item is still used by 1 item: 1 in Block (Back). Remove it from those first.'`, and N's row still present. `// MUTATION: skip paragraph owners whenever own rows exist. The other item's use is missed.`

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm turbo run build --filter=@bobbykim/manguito-cms-api && pnpm --filter @bobbykim/manguito-cms-api test -- src/__tests__/relation-cardinality.delete.integration.test.ts`
Expected: the first three new tests FAIL with status 409.

- [ ] **Step 3: Implement `ownParagraphRowIds`, the new `findRequiredReferrers` return, and `deleteOwnParagraphs`.** In each delete route, refuse on `others.length > 0` as now. When `fromOwnParagraphs` is true, call `deleteOwnParagraphs` before `repo.delete`; otherwise keep the row-first order and call it after. Count own and other rows in one query per paragraph owner with `count(*) FILTER (WHERE id = ANY(${ownIds}::uuid[]))`. Comment the trade-off in the route: a use added between the check and the delete, in the own-reference case, now leaves the item without its paragraphs.

- [ ] **Step 4: Run the file and confirm everything passes**

Same command as Step 2. Expected: all tests PASS, including the existing `maps a foreign-key violation...` and `a required reference to its own type` tests.

- [ ] **Step 5: Verify red under each test's mutation**, then restore. Rebuild the api before each run. Also apply "always delete paragraphs first" and confirm the existing `maps a foreign-key violation the pre-check cannot see to 409, touching nothing` fails: it guards the row-first order this task keeps for the ordinary case.

- [ ] **Step 6: Gates and commit**

Run: `pnpm lint && pnpm typecheck`
```bash
git commit -m "fix(api): delete an item whose own paragraph refers back to it"
```

### Task 2: Keyboard reordering for paragraph lists

`ParagraphEmbed`'s one-to-many list reorders by drag only. Give each item header move-earlier and move-later buttons, as `ReferenceSelect` has since #80, with focus following the moved item.

**Files:**
- Modify: `packages/admin/src/components/fields/ParagraphEmbed.vue`
- Test: `packages/admin/src/components/fields/__tests__/ParagraphEmbed.test.ts`

**Interfaces:**
- Consumes: `moveItem<T>(list: readonly T[], from: number, to: number): T[] | null` from `packages/admin/src/utils/move-item.ts` (returns null when there is nothing to move).

- [ ] **Step 1: Write the failing tests** in a new `describe('ParagraphEmbed, one-to-many reordering', ...)`, mounting with three items `{ order: 0..2 }`:
  - `it('moves an item earlier or later, renumbering order')`: click `Move item 2 earlier` → emits `[[item2, item1, item3]]` with `order` 0, 1, 2. `// MUTATION: emit the list unchanged, or skip renumbering order.`
  - `it('offers no move past either end')`: no `Move item 1 earlier`, no `Move item 3 later`, and a one-item list has no move buttons. `// MUTATION: render both buttons on every item.`
  - `it('keeps focus on the moved item, on its other button at an end')`: a parent with a real `v-model`, mounted with `attachTo: document.body`. Focus and click `Move item 3 earlier` twice; focus is then on `Move item 1 later`. `// MUTATION: drop the focus step.`
  - `it('hides the move buttons when disabled')`: with `disabled`, no move buttons. `// MUTATION: render them regardless of disabled (Remove is already hidden when disabled).`

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test -- src/components/fields/__tests__/ParagraphEmbed.test.ts`
Expected: the new tests FAIL (no such buttons).

- [ ] **Step 3: Add the buttons to the item header** (`v-if="!disabled && i > 0"` / `i < safeValue.length - 1`), with `aria-label` `Move item ${i + 1} earlier` / `later`, 24px targets as in `ReferenceSelect`, `data-move` attributes and a `data-item-index` on each item. Add `moveParagraph(index: number, step: -1 | 1)`, which uses `moveItem`, renumbers `order`, emits, and after `nextTick` focuses the moved item's same-direction button, or its other one.

- [ ] **Step 4: Run and confirm they pass** (same command).

- [ ] **Step 5: Verify red under each mutation, then restore.**

- [ ] **Step 6: Changeset, gates, commit**

Create `.changeset/paragraph-keyboard-reorder.md` (`"@bobbykim/manguito-cms-admin": patch`). Run `pnpm lint && pnpm typecheck`.
```bash
git commit -m "feat(admin): reorder paragraph list items from the keyboard"
```

### Task 3: Presence checks with `Object.hasOwn`

`field.name in body` is true for prototype keys, so a field named `constructor` counts as present when absent. Same for `errorHandler`'s `in ERROR_STATUS_MAP`.

**Files:**
- Modify: `packages/api/src/relation-input.ts` (`checkRelationInput`, `paragraphItemsIn`, `collectReferences`)
- Modify: `packages/api/src/field-values.ts` (`emptyValuesToNull`, `checkFieldValues`)
- Modify: `packages/api/src/routes/admin/content.ts` (`valuesForPublishCheck`, `persistRelationFields`)
- Modify: `packages/api/src/middleware/error.ts` (`errorHandler`)
- Test: `packages/api/src/__tests__/field-values.test.ts`, `packages/api/src/middleware/__tests__/error.test.ts`

- [ ] **Step 1: Write the failing tests**
  - In `field-values.test.ts`, `it('treats a field named constructor as absent when the body leaves it out')`: a content type with a required text field `constructor`; `checkFieldValues(fields, {}, registry)` → `[]`. `// MUTATION: keep f.name in body. Object.prototype.constructor reads as a present, non-text value: "must be text".`
  - In `error.test.ts`, `it('hides an error whose code is a prototype key')`: an error with `code: 'toString'` → 500 `INTERNAL_ERROR`, generic message. `// MUTATION: keep in ERROR_STATUS_MAP. toString is then "deliberate" and its message is sent.`
- [ ] **Step 2: Run and confirm they fail**: `pnpm --filter @bobbykim/manguito-cms-api test -- src/__tests__/field-values.test.ts src/middleware/__tests__/error.test.ts`
- [ ] **Step 3: Replace each `x in obj` presence check listed under Files with `Object.hasOwn(obj, x)`.** Get the list from `grep -n " in body\| in out\| in ERROR_STATUS_MAP" packages/api/src -r`.
- [ ] **Step 4: Run and confirm they pass** (same command), then verify red under each mutation.
- [ ] **Step 5: Gates, commit**: `pnpm lint && pnpm typecheck`.
```bash
git commit -m "fix(api): presence checks ignore prototype keys"
```

### Task 4: Relation reads: stable paragraph order, links once each, parallel edit reads

**Files:**
- Modify: `packages/api/src/relations.ts` (`resolveRelationField`, `resolveRelationBareIds`; new export `firstOfEach`)
- Modify: `packages/api/src/routes/admin/content.ts` (`loadParagraphRows`, `loadRelationsForEdit`)
- Test: `packages/api/src/__tests__/relation-cardinality.read.integration.test.ts`

**Interfaces:**
- Produces: `firstOfEach<T>(items: T[], key: (item: T) => string): T[]` in `relations.ts`: keeps each key's first item, in order.

- [ ] **Step 1: Write the failing tests** in `relation-cardinality.read.integration.test.ts`:
  - `it('orders paragraph rows with the same position by id, on every read')`: two `cards` rows for one post, both `order: 0`, inserted with the larger id first. Expect public `?include=cards` and the admin edit read to list them by ascending id. `// MUTATION: drop the id tiebreaker from ORDER BY "order". Rows with the same position then come back in storage order.`
  - `it('reads a link stored twice once, keeping first-position order')`: insert link rows for `tags` directly: (A, order 0), (B, order 1), (A, order 2). Expect the admin edit read, the public id read and `?include=tags` to give `[A, B]`. `// MUTATION: skip firstOfEach in any one of the three reads.`
- [ ] **Step 2: Rebuild the api, run, and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `ORDER BY "order" ASC, id ASC` in the two paragraph queries of `relations.ts` and in `loadParagraphRows`.
  - `firstOfEach` applied per item to the three junction reads (`resolveRelationField`, `resolveRelationBareIds`, and the junction branch of `loadRelationsForEdit`).
  - `loadRelationsForEdit` runs its per-field reads with `Promise.all`. That last change has no new test: the existing edit-read tests in the write and read suites cover its results.
- [ ] **Step 4: Rebuild, run and confirm they pass; verify red under each mutation.**
- [ ] **Step 5: Changeset, gates, commit**

Create `.changeset/relation-read-order.md` (`"@bobbykim/manguito-cms-api": patch`) covering Tasks 1, 3 and 4. Run `pnpm lint && pnpm typecheck`.
```bash
git commit -m "fix(api): stable paragraph order; read each link once; parallel edit reads"
```

### Task 5: GraphQL runtime tests for relation shapes

**Files:**
- Create: `packages/api/src/__tests__/relation-cardinality.graphql.integration.test.ts`

**Interfaces:**
- Consumes: `makeCardinalityFixture`, `createFixtureTables`, `dropFixtureTables`, `insertTag`, `insertPost`, `insertParagraph`, `seedTestUsers` from `./relation-cardinality.fixture`. Consumes `createCmsApp` from `../app`, `createLocalAdapter` from `../storage/adapters/local`, and `singleQueryName` from `../graphql/naming`. Configure `graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true }`, as `graphql.integration.test.ts`'s `makeGraphqlApp` does.

- [ ] **Step 1: Write the tests** (prefix `rcgql`):
  - `it('resolves a one-to-one paragraph to an object')`: query `${singleQueryName(fx.names.post)}(slug: …) { link { url } }` → `link` equals `{ url: 'u' }`. `// MUTATION: resolve a 'one' paragraph as a list (before #50). link is then an array.`
  - `it('returns links in their saved order')`: insert `tags` rows with the saved order the reverse of id order; query `tags { id }` → saved order. `// MUTATION: drop junctionOrderBy from resolveRelationField.`
- [ ] **Step 2: Rebuild the api and run**: `pnpm --filter @bobbykim/manguito-cms-api test -- src/__tests__/relation-cardinality.graphql.integration.test.ts`. Expected: PASS (behaviour exists). Then verify red under each mutation.
- [ ] **Step 3: Gates, commit**: `pnpm lint && pnpm typecheck`.
```bash
git commit -m "test(api): GraphQL resolves one-to-one paragraphs and link order"
```

### Task 6: Missing API route tests

**Files:**
- Modify: `packages/api/src/__tests__/relation-cardinality.delete.integration.test.ts`
- Modify: `packages/api/src/__tests__/relation-cardinality.write.integration.test.ts`

- [ ] **Step 1: Add the tests.** Each passes against today's code.
  - Delete file, `it('maps a foreign-key violation on a taxonomy delete to 409, touching nothing')`: mirror the content version with a table outside the registry referencing the tag. Expect 409 with `IN_USE_RACE_MESSAGE`'s text, and the tag row and its `tag_link` row kept. `// MUTATION: delete the taxonomy item's paragraphs before its row. Its link row is then gone.`
  - Write file, `it('a taxonomy PATCH with the wrong shape is refused and erases nothing')`: a tag with `tag_link`; PATCH `tag_link: [{ url: 'x' }]` → 422, and the `tag_link` row is kept. `// MUTATION: drop relationInputError from the taxonomy PATCH.`
  - Extend `rejects a list with 422 and stores nothing`: also assert that no post row exists with the sent slug. `// MUTATION: run the relation check after the insert.`
  - Write file, `it('refuses null for a one-to-many paragraph with 422, keeping the stored cards')`: post with one card; PATCH `cards: null` → 422 `VALIDATION_ERROR` naming `cards`; one card row remains. `// MUTATION: map null to an empty list for a 'many' paragraph.`
- [ ] **Step 2: Rebuild, run both files, and confirm they pass; verify red under each mutation.**
- [ ] **Step 3: Gates, commit**: `pnpm lint && pnpm typecheck`.
```bash
git commit -m "test(api): taxonomy delete race and PATCH shape; null and list refusals store nothing"
```

### Task 7: CLI and db test gaps

**Files:**
- Modify: `packages/cli/tests/build.test.ts`, `packages/cli/tests/dev.test.ts`
- Modify: `packages/db/src/migrations/__tests__/on-delete-change.integration.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: CLI tests.**
  - `build.test.ts`, `it('prints schema deprecations')`: `findSchemaDeprecations` returns one deprecation → stderr contains its `message`. `// MUTATION: drop printSchemaDeprecations from runBuild.`
  - The same test in `dev.test.ts`. `// MUTATION: drop it from loadValidatedSchema.`
- [ ] **Step 2: Isolate the on-delete assertion.** The second migration, as drizzle-kit 0.31.10 generates it (checked 2026-11-07 by generating it from this test's own `registry(false)` → `registry(true)`), is: `DROP CONSTRAINT "content_od_post_owner_taxonomy_od_tag_id_fk"`, `ALTER COLUMN "owner" SET NOT NULL`, then `ADD CONSTRAINT "content_od_post_owner_taxonomy_od_tag_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."taxonomy_od_tag"("id") ON DELETE restrict ON UPDATE no action`. Replace `toMatch(/ON DELETE restrict/i)` with two assertions:
  - `toMatch(/ADD CONSTRAINT "content_od_post_owner_taxonomy_od_tag_id_fk" FOREIGN KEY \("owner"\)[^;]*ON DELETE restrict/)`;
  - `toMatch(/ALTER COLUMN "owner" SET NOT NULL/)`.

  `// MUTATION (in core): keep SET NULL for required references. The FK statement then reads ON DELETE set null, failing the first assertion, while the NOT NULL one still passes.`
- [ ] **Step 3: Add `.tmp-*/` to `.gitignore`**, replacing `.tmp-globalsetup/`, so `packages/db/tests/.tmp-on-delete`, `.tmp-migrations` and `.tmp-preview` are ignored.
- [ ] **Step 4: Run** `pnpm --filter @bobbykim/manguito-cms-cli test -- tests/build.test.ts tests/dev.test.ts` and `pnpm --filter @bobbykim/manguito-cms-db test -- src/migrations/__tests__/on-delete-change.integration.test.ts`. Expected: PASS; then verify red under each mutation.
- [ ] **Step 5: Gates, commit**: `pnpm lint && pnpm typecheck`.
```bash
git commit -m "test(cli,db): deprecations printed by build and dev; isolate the on-delete FK assertion"
```

### Task 8: Cleanup

**Files:**
- Modify: `packages/test-utils/src/db.ts` (new export `seedRoleUsers`), `packages/test-utils/src/index.ts`
- Modify: `globalSetup.ts`, `packages/api/tests/integration.test.ts`, `packages/api/src/__tests__/relation-cardinality.fixture.ts` (`seedTestUsers` becomes a re-export or is replaced by `seedRoleUsers`)
- Modify: `packages/api/src/routes/admin/content.ts`, `packages/api/src/relations.ts` (use `paragraphTypeOf` from `relation-input.ts`)
- Modify: `packages/admin/src/utils/taxonomy-form.ts` → rename to `packages/admin/src/utils/form-state.ts` exporting `initialFormState`; `TaxonomyFormView.vue`, `ContentFormView.vue`; rename the test to `form-state.test.ts`
- Modify (comments only): `packages/api/src/__tests__/relation-cardinality.fixture.ts` header, `packages/core/src/cardinality.ts`, `packages/core/src/errors.ts`

**Interfaces:**
- Produces: `seedRoleUsers(db: DrizzlePostgresInstance): Promise<void>` in `@bobbykim/manguito-cms-test-utils`. It runs `seedSystemTables(db, testParsedSchema)`, then deletes and re-inserts each `testRoleUsers` user, as `seedTestUsers` does today. test-utils already has core and db as devDependencies (`packages/test-utils/package.json`).
- Produces: `initialFormState(fields: ParsedField[], source?: Record<string, unknown>): Record<string, unknown>` (today's `initialTaxonomyForm`, renamed). `ContentFormView.initForm` calls it and then sets `slug`.

- [ ] **Step 1: Move the seeding** into `seedRoleUsers`; replace the three copies with calls to it. Keep `globalSetup.ts`'s other steps. Run `pnpm test` (full; globalSetup changes). Expected: PASS.
- [ ] **Step 2: Paragraph-type lookup**: replace each `registry.paragraph_types[comp.ref]` lookup in `content.ts` (`loadParagraphRows`, `loadRelationsForEdit`, `persistRelationFields`, `deleteOwnParagraphs`) and `relations.ts` (`nestedParagraphFields`) with `paragraphTypeOf(field, registry)`. Get the list from `grep -n "paragraph_types\[comp.ref\]" packages/api/src -r`. Leave `codegen/routes.ts` alone (it takes an optional registry).
- [ ] **Step 3: Form state**: rename the util and its test; `ContentFormView.initForm` builds fields with `initialFormState(allFields.value, source)` and adds `slug`. The existing taxonomy-form test cases move over unchanged.
- [ ] **Step 4: Comments**:
  - the fixture header no longer says files run in parallel (`api/vitest.config.ts` sets `fileParallelism: false`);
  - `cardinality.ts` says the entry re-exports only the cardinality rule, which has no Node imports;
  - `ITEM_IN_USE` moves out of the `// Phase 5 — media` group in `errors.ts`, into a group of its own.
- [ ] **Step 5: Full gates**: `pnpm lint && pnpm build:packages && pnpm typecheck && pnpm test && pnpm smoke`. Expected: all pass. No new tests: these are behaviour-preserving moves, covered by the existing suites (the seeding by every suite that authenticates, the form state by `form-state.test.ts` and the `TaxonomyFormView` tests).
- [ ] **Step 6: Commit**
```bash
git commit -m "chore: share test-user seeding, the paragraph lookup and form state; fix stale comments"
```

### After Task 8

Run `/code-review` on the branch, fix the Critical and Important findings, then open one PR against master that closes the #57 items above, lists any review finding left open, and names the three out-of-scope items as still open in #57.

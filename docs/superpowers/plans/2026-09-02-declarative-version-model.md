# Declarative Version Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the derived rename-history version model in `packages/core/src/versions/` with three optional declarations on a field — `column`, `removed`, `fallback` — so a field's storage column is stated rather than folded out of a history.

**Architecture:** The parser gains three optional keys on `RawFieldBase` (the base every field schema extends) and applies them at `buildParsedField`, the single builder-dispatch site. Everything downstream then *reads* instead of computing: the union registry becomes the current schema itself (retention is a tombstone, so there is nothing to merge), and each live version's projection is a read of that version's own schema files. A completeness check — every column a live version exposes must exist in the union — replaces the `AMBIGUOUS_RENAME` heuristic and its `drops` confirmation mechanism.

**Tech Stack:** TypeScript strict, zod 3 (schema validation), Vitest. No new dependencies (`packages/core`'s dependency bar is deliberately high — see `docs/adr/core/0006`).

**Spec:** [`docs/superpowers/specs/2026-09-02-declarative-version-model-design.md`](../specs/2026-09-02-declarative-version-model-design.md)

## Global Constraints

- **Layer boundary:** `packages/core` imports nothing from `db`, `api`, `admin` or `cli`. Every file in this plan is under `packages/core/src/`.
- **No new dependencies** in `packages/core`.
- **TypeScript only.** Never create a `.js` file.
- **Never throw for an expected failure.** Use the `Result<T>` type: `{ ok: true; value: T } | { ok: false; errors: ParseError[] }`, defined in `packages/core/src/parser/loader.ts`. Collect every error rather than stopping at the first.
- **Parser output must be serializable plain objects** — no class instances, no `Map`/`Set` on a `ParsedField`, `SchemaRegistry`, or `VersionModel`.
- **Factory functions over classes** for public API; named function declarations for top-level exports, arrow functions for callbacks.
- **Run tests with the package script**, never bare `vitest`: `pnpm --filter @bobbykim/manguito-cms-core test`. The script is `dotenv -e .env.test -- vitest run`; invoking `vitest` directly skips the env wrapper and aborts with a misleading `DB_URL not set in .env.test`. Narrow to one file by appending a path relative to `packages/core`, e.g. `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/projections.test.ts`.
- **Also run lint** before each commit: `pnpm --filter @bobbykim/manguito-cms-core lint`. An unused import is an eslint error here and has slipped through review before.
- **Baseline at the start of this plan:** 15 test files, 249 passing, 2 todo; lint clean. Never finish a task with fewer passing than you started, minus any test the task deliberately deletes.
- **Commit style:** commitizen conventional commits — `type(scope): subject`, scope `core`.
- **Never commit to `master`.** All work lands on the branch `feat/declarative-version-model`.
- **No changeset in this plan.** Nothing outside `packages/core/src/versions` imports the version model (verified). Note for whoever wires the first consumer: this changes core's published surface *breakingly* (four `ParseErrorCode` members and two exported types are removed), and core must be bumped and published before any package imports it.

---

## File Structure

**Deliberate deviation from the spec's deliverables list.** The design doc names `src/registry/fieldTypeRegistry.ts` as a file to change, on the reasoning that it hardcodes `column_name: raw.name` in nine places. This plan does **not** touch it. The nine builders all funnel through one dispatch site — `buildParsedField` in `src/parser/parseSchema.ts` — and the rule is identical for every field type, so the override is applied once there. Editing nine builders would give nine chances to forget it, and a builder that forgot would put the field on the wrong column silently. Two tests in Task 2 (`image` with its foreign key, `enum` with its check constraint) pin that the generic override preserves everything else the builders set.

**Modified — parser and registry (the declarations):**

- `src/registry/columns.ts` — **new.** Home for `isColumnBacked`, moved out of `versions/union.ts` so the parser can use it without importing from `versions/`.
- `src/registry/types.ts` — `ParsedField` gains optional `removed?: true` and `fallback?: unknown`.
- `src/parser/validators.ts` — `RawFieldBase` gains `column?`, `removed?`, `fallback?`. One place, inherited by all 12 field schemas.
- `src/parser/parseSchema.ts` — `buildParsedField` applies the declarations; two new validation helpers.
- `src/parser/loader.ts` — `ParseErrorCode` gains five members, loses four.

**Modified — the version model (now reads instead of computing):**

- `src/versions/union.ts` — **deleted.** The union is the current registry; there is nothing left to compute.
- `src/versions/fold.ts` — **deleted.** No column is derived any more.
- `src/versions/projections.ts` — reads each version's own schema files.
- `src/versions/validate.ts` — rename/window/ambiguity/drops checks replaced by the completeness and orphan checks.
- `src/versions/compute.ts` — assembles the model; validation now runs *after* projections, which the completeness check reads.
- `src/versions/types.ts` — `PendingChanges` and `VersionHistory` deleted.
- `src/versions/load.ts` — stops reading `pending.json` / `history.json`; snapshot discovery unchanged.
- `src/index.ts` — export surface adjusted.

**Tests:**

- `src/parser/__tests__/field-declarations.test.ts` — **new.** The three keys and their five errors.
- `src/versions/__tests__/fixtures.ts` — `FieldSpec` gains the three keys; the two empty-declaration constants go.
- `src/versions/__tests__/{fold,union}.test.ts` — **deleted** with their modules.
- `src/versions/__tests__/{projections,validate,compute,load,fixtures}.test.ts` — rewritten per task.
- `src/versions/__tests__/rename-shapes.test.ts` — **new.** Shift, swap and chain: the cases the derived model could not handle, pinned as the evidence the redesign achieved its purpose.

**Documentation:**

- `packages/core/CONTEXT.md` — versioning glossary rewritten.

---

## Task 1: Share `isColumnBacked` out of the versions module

The predicate that decides whether a field has a storage column currently lives in `src/versions/union.ts`. Task 2 needs it in the parser, and the parser must not import from `versions/`. Move it first, on its own, so the move is verifiably behaviour-free.

**Files:**
- Create: `packages/core/src/registry/columns.ts`
- Modify: `packages/core/src/versions/union.ts` (delete the function and its export, import it instead)
- Modify: `packages/core/src/versions/projections.ts:4` (import from the new home)
- Modify: `packages/core/src/versions/validate.ts` (import from the new home)
- Test: `packages/core/src/versions/__tests__/union.test.ts` (import path only, if it imports the predicate)

**Interfaces:**
- Consumes: nothing.
- Produces: `isColumnBacked(field: { db_column: DbColumn | null }): boolean` from `src/registry/columns.ts`. The parameter is **structural on purpose** — callers pass either a full `ParsedField` or a `BuiltField` mid-construction inside the parser, and both have a `db_column`.

- [ ] **Step 1: Create the new module**

```typescript
// packages/core/src/registry/columns.ts
import type { DbColumn } from './types.js'

/**
 * Whether a field has a storage column of its own.
 *
 * Two kinds do not: a paragraph field has no column at all (the association
 * lives on the paragraph table via parent_id/parent_type/parent_field), and a
 * many-to-many reference has none either (the junction table owns the
 * association). For both, the field's name already IS its identity — there is
 * no column to declare, project, or retain.
 *
 * The parameter is structural rather than `ParsedField` so the parser can call
 * it on a `BuiltField` before the `ParsedField` around it exists.
 */
export function isColumnBacked(field: { db_column: DbColumn | null }): boolean {
  const col = field.db_column
  return col !== null && col.column_name !== '' && !col.junction
}
```

- [ ] **Step 2: Point the three existing callers at it**

In `src/versions/union.ts`, delete the `isColumnBacked` declaration and its doc comment, and add:

```typescript
import { isColumnBacked } from '../registry/columns.js'
```

In `src/versions/projections.ts`, replace `import { isColumnBacked } from './union.js'` with:

```typescript
import { isColumnBacked } from '../registry/columns.js'
```

In `src/versions/validate.ts`, replace its `isColumnBacked` import from `./union.js` the same way. Check whether `union.js` is still imported for anything else in that file before deleting the whole import line.

- [ ] **Step 3: Fix any test that imported the predicate from `union.js`**

Run: `grep -rn "isColumnBacked" packages/core/src`
Every hit must import from `../registry/columns.js` (or `../../registry/columns` from a `__tests__` directory) except the declaration itself.

- [ ] **Step 4: Verify the move changed nothing**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: 249 passed, 2 todo — **identical to baseline.** A pure move must not change a single result. If any test fails, the move was not pure; fix it rather than updating the test.

Run: `pnpm --filter @bobbykim/manguito-cms-core lint`
Expected: no output (clean). This catches an `import type { ParsedField }` in `union.ts` that is now unused.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "refactor(core): move isColumnBacked to registry/columns"
```

---

## Task 2: The parser accepts `column`, `removed` and `fallback`

Mechanics only — the keys are read and applied. Rejecting a *misused* declaration is Task 3; this task is about what a correct one does.

**Files:**
- Modify: `packages/core/src/parser/validators.ts:59-63` (`RawFieldBase`)
- Modify: `packages/core/src/registry/types.ts:76-89` (`ParsedField`)
- Modify: `packages/core/src/parser/parseSchema.ts:217-263` (`buildParsedField`)
- Test: `packages/core/src/parser/__tests__/field-declarations.test.ts` (create)

**Interfaces:**
- Consumes: `isColumnBacked` from `src/registry/columns.js` (Task 1).
- Produces:
  - `RawField` (already exported from `validators.ts`) gains optional `column?: string`, `removed?: boolean`, `fallback?: unknown` on every member of the union.
  - `ParsedField` gains optional `removed?: true` and `fallback?: unknown`.
  - A tombstone's `ParsedField` invariants, relied on by Tasks 5 and 6: `removed === true`, `required === false`, `nullable === true`, `validation.required === false`, and `db_column.nullable === true`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/parser/__tests__/field-declarations.test.ts
import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'
import type { ParsedContentType } from '../parseSchema'

// A content type wrapping the given raw fields in the single tab
// ContentTypeRawSchema requires. Fields are `unknown[]` because several tests
// deliberately pass shapes the validators must reject.
function contentType(fields: unknown[]): unknown {
  return {
    name: 'content--blog_post',
    label: 'Blog Post',
    type: 'content-type',
    default_base_path: 'blog',
    only_one: false,
    fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields } }],
  }
}

function parseOk(fields: unknown[]): ParsedContentType {
  const result = parseSchema(contentType(fields), 'content-type', 'schemas/content-types/blog.json')
  if (!result.ok) throw new Error(`expected parse to succeed: ${JSON.stringify(result.errors)}`)
  return result.schema as ParsedContentType
}

describe('field declarations — column', () => {
  it('defaults the column to the field name when "column" is absent', () => {
    const type = parseOk([{ name: 'title', label: 'Title', type: 'text/plain', required: true }])
    expect(type.fields[0]!.db_column!.column_name).toBe('title')
  })

  it('uses an explicit "column" as the storage column, leaving the name as the exposed key', () => {
    const type = parseOk([
      { name: 'title', label: 'Title', type: 'text/plain', required: true, column: 'blog_title' },
    ])
    const field = type.fields[0]!
    // This is the whole point of the redesign: name and column diverge because
    // the schema SAID so, with no history to fold.
    expect(field.name).toBe('title')
    expect(field.db_column!.column_name).toBe('blog_title')
  })

  it('keeps the declared column on a media field, whose builder also sets a foreign key', () => {
    // Guards against applying the override in a way that drops the rest of the
    // builder's db_column. Nine builders produce a column; the override is
    // applied once, generically, so it must preserve every other property.
    const type = parseOk([
      { name: 'hero', label: 'Hero', type: 'image', required: false, column: 'hero_image' },
    ])
    const col = type.fields[0]!.db_column!
    expect(col.column_name).toBe('hero_image')
    expect(col.column_type).toBe('uuid')
    expect(col.foreign_key).toEqual({ table: 'media', column: 'id', on_delete: 'SET NULL' })
  })

  it('keeps the declared column on an enum field, preserving its check constraint', () => {
    const type = parseOk([
      { name: 'state', label: 'State', type: 'enum', required: true, values: ['a', 'b'], column: 'old_state' },
    ])
    const col = type.fields[0]!.db_column!
    expect(col.column_name).toBe('old_state')
    expect(col.check_constraint).toEqual(['a', 'b'])
  })
})

describe('field declarations — removed (tombstone)', () => {
  it('retains the column and marks the field removed', () => {
    const type = parseOk([
      { name: 'title', label: 'Title', type: 'text/plain', required: true },
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, removed: true },
    ])
    const tombstone = type.fields[1]!
    expect(tombstone.removed).toBe(true)
    // The column still exists — that is what "retained" means.
    expect(tombstone.db_column!.column_name).toBe('blog_desc')
  })

  it('forces a tombstone nullable even when the field was authored required', () => {
    // Rows created after the removal cannot populate the column, so NOT NULL
    // would be unsatisfiable. `required: true` here is rejected by Task 3; this
    // test pins the nullability rule independently of that check, using a
    // required-by-default type.
    const type = parseOk([
      { name: 'flag', label: 'Flag', type: 'boolean', required: false, removed: true },
    ])
    const tombstone = type.fields[0]!
    // Boolean columns are normally NOT NULL — false is the natural empty value.
    // A tombstoned boolean is the one case that must still be nullable.
    expect(tombstone.db_column!.nullable).toBe(true)
    expect(tombstone.nullable).toBe(true)
    expect(tombstone.required).toBe(false)
    expect(tombstone.validation.required).toBe(false)
  })

  it('composes "column" with "removed" — a field renamed and then removed', () => {
    // The tombstone must retain the column the OLDER version exposes, not the
    // name the field was last known by.
    const type = parseOk([
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, column: 'description', removed: true },
    ])
    expect(type.fields[0]!.db_column!.column_name).toBe('description')
    expect(type.fields[0]!.removed).toBe(true)
  })
})

describe('field declarations — fallback', () => {
  it('carries a fallback value onto the parsed field', () => {
    const type = parseOk([
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, removed: true, fallback: '' },
    ])
    expect(type.fields[0]!.fallback).toBe('')
  })

  it('carries a falsy fallback rather than treating it as absent', () => {
    const type = parseOk([
      { name: 'count', label: 'Count', type: 'integer', required: false, removed: true, fallback: 0 },
    ])
    expect(type.fields[0]!.fallback).toBe(0)
    expect('fallback' in type.fields[0]!).toBe(true)
  })
})

describe('field declarations — absence is invisible', () => {
  it('omits both keys entirely on an ordinary field', () => {
    // Not `removed: false` / `fallback: undefined`. Every schema written before
    // versioning existed must parse to exactly what it parsed to before, so
    // that serialized output and deep-equal assertions elsewhere are unaffected.
    const type = parseOk([{ name: 'title', label: 'Title', type: 'text/plain', required: true }])
    expect('removed' in type.fields[0]!).toBe(false)
    expect('fallback' in type.fields[0]!).toBe(false)
  })

  it('rejects a non-snake_case column', () => {
    const result = parseSchema(
      contentType([{ name: 'title', label: 'Title', type: 'text/plain', required: true, column: 'Blog Title' }]),
      'content-type',
      'schemas/content-types/blog.json'
    )
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/field-declarations.test.ts`
Expected: FAIL. The `column` cases fail because zod strips the unrecognised key (its objects are non-strict), so `column_name` stays `'title'`; the `removed`/`fallback` cases fail on `undefined`; the `rejects a non-snake_case column` case fails because a stripped key cannot be invalid. Only the two default-behaviour tests pass.

- [ ] **Step 3: Add the three keys to `RawFieldBase`**

In `src/parser/validators.ts`, replace `RawFieldBase`:

```typescript
// Properties shared across every field type.
const RawFieldBase = z.object({
  name: snakeCaseName,
  label: z.string().min(1),
  required: z.boolean(),

  // ─── Version declarations ───────────────────────────────────────────────────
  //
  // A field's storage column is STATED here, never derived from a rename
  // history. All three are optional and default to the pre-versioning
  // behaviour, so every schema authored before versioning existed keeps its
  // exact meaning.

  /** Storage column. Defaults to `name`. Stating it is how a rename works: the name changes, the column does not. */
  column: snakeCaseName.optional(),
  /** Tombstone — the column is retained for older live versions, and this version does not expose it. */
  removed: z.boolean().optional(),
  /** Value served for rows created after the removal. Meaningful only on a tombstone. */
  fallback: z.unknown().optional(),
})
```

- [ ] **Step 4: Add the two optional keys to `ParsedField`**

In `src/registry/types.ts`, append to the `ParsedField` type (after `ui_component`):

```typescript
  /**
   * Tombstone: this version retains the column but does not expose it.
   * `true` or ABSENT — never `false`. An ordinary field must parse to exactly
   * the object it parsed to before versioning existed.
   */
  removed?: true
  /**
   * Value served in place of null for a retained column. Declared on the
   * tombstone in the current schema, but consumed by the OLDER versions'
   * projections — they are the ones still exposing the column.
   */
  fallback?: unknown
```

- [ ] **Step 5: Apply the declarations in `buildParsedField`**

In `src/parser/parseSchema.ts`, add the import:

```typescript
import { isColumnBacked } from '../registry/columns'
```

Then replace the body of `buildParsedField` from `const { name, label } = rawField` to the end of the function:

```typescript
  const { name, label } = rawField
  const built = build(rawField, { ownerTableName })
  const { validation, ui_component } = built
  // Source of truth for `required` is the builder's validation output, not the raw
  // field: every builder mirrors raw.required here except `programmatic`, which
  // hardcodes `false` — an authored `required: true` on a programmatic field must
  // still resolve to false (no write path exists for a computed value).
  const required = validation.required

  // ─── Version declarations ───────────────────────────────────────────────────
  //
  // Applied once here rather than in each of the nine builders that set a
  // column: the rule is the same for every field type, and a builder that
  // forgot it would put the field on the wrong column silently.
  //
  // Only column-backed fields are touched. A declaration on any other kind is
  // rejected by checkFieldDeclarations, not quietly ignored here — ignoring a
  // `column` override would produce a wrong contract rather than a smaller one.
  const tombstone = rawField.removed === true
  let db_column = built.db_column

  if (isColumnBacked(built)) {
    db_column = {
      ...db_column!,
      column_name: rawField.column ?? db_column!.column_name,
      // A tombstone is always nullable, overriding the builder — including
      // `boolean`, the one type whose column is otherwise always NOT NULL.
      // Rows written after the removal cannot populate the column.
      ...(tombstone && { nullable: true }),
    }
  }

  return {
    ok: true,
    value: {
      name,
      label,
      field_type: rawField.type,
      // Nothing writes a tombstone, so it can be neither required nor NOT NULL.
      required: tombstone ? false : required,
      nullable: tombstone ? true : !required,
      order,
      validation: tombstone ? { ...validation, required: false } : validation,
      db_column,
      ui_component,
      // Omitted entirely when absent, never set to `false`/`undefined`: an
      // ordinary field must be byte-identical to its pre-versioning shape.
      ...(tombstone && { removed: true as const }),
      ...(rawField.fallback !== undefined && { fallback: rawField.fallback }),
    },
  }
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/field-declarations.test.ts`
Expected: PASS, all 10.

- [ ] **Step 7: Run the whole suite and lint**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: 259 passed, 2 todo (249 baseline + 10 new).

If an existing test fails, read it before changing it. The likely cause is a `toEqual` on a whole `ParsedField` — which should still pass, because both new keys are omitted when absent. A failure there means Step 5 set a key it should have omitted.

Run: `pnpm --filter @bobbykim/manguito-cms-core lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): accept column, removed and fallback on a field"
```

---

## Task 3: Reject a misused declaration

Three per-field errors and one cross-field error. Each is a case where silently ignoring the declaration would produce a **wrong** contract rather than a smaller one.

**Files:**
- Modify: `packages/core/src/parser/loader.ts:31-45` (`ParseErrorCode` — add five members)
- Modify: `packages/core/src/parser/parseSchema.ts` (two new helpers; wire into `buildParsedField` and the three `checkDuplicateFieldNames` call sites at lines 312, 378, 405)
- Test: `packages/core/src/parser/__tests__/field-declarations.test.ts` (extend)

**Interfaces:**
- Consumes: `isColumnBacked`, `RawField`, `BuiltField`, `ParseError` (all already in scope in `parseSchema.ts` or imported in Task 2).
- Produces: five `ParseErrorCode` members — `DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `FALLBACK_WITHOUT_TOMBSTONE`, `VERSION_COLUMN_MISSING`, `ORPHANED_TOMBSTONE`. The last two are raised in Task 6; they are added here so `ParseErrorCode` is edited once.
- Produces: the guarantee Task 6 depends on when it deletes `validateModelStructure` — **no registry the parser produces can contain two fields of one type on one column.**

> **Note on the spec:** the design doc names four new codes and describes rejecting a `fallback` on a live field in prose without naming a code. This task names it `FALLBACK_WITHOUT_TOMBSTONE`, making five. `UNRENAMEABLE_FIELD_KIND` is reused, not added — it already exists, and its only remaining caller becomes this check.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/parser/__tests__/field-declarations.test.ts`:

```typescript
// Reuses contentType() from the top of this file.
function parseErrors(fields: unknown[]): Array<{ code: string; message: string }> {
  const result = parseSchema(contentType(fields), 'content-type', 'schemas/content-types/blog.json')
  if (result.ok) throw new Error('expected parse to fail')
  return result.errors.map((e) => ({ code: e.code, message: e.message }))
}

describe('field declarations — misuse is rejected', () => {
  it('rejects "column" on a paragraph field, which has no column at all', () => {
    const errors = parseErrors([
      {
        name: 'cards', label: 'Cards', type: 'paragraph',
        ref: 'paragraph--photo_card', rel: 'one-to-many', required: false,
        column: 'old_cards',
      },
    ])
    expect(errors.map((e) => e.code)).toContain('UNRENAMEABLE_FIELD_KIND')
  })

  it('rejects "removed" on a many-to-many reference, whose junction table owns the association', () => {
    const errors = parseErrors([
      {
        name: 'tags', label: 'Tags', type: 'reference',
        target: 'taxonomy--tag', rel: 'many-to-many', required: false,
        removed: true,
      },
    ])
    expect(errors.map((e) => e.code)).toContain('UNRENAMEABLE_FIELD_KIND')
  })

  it('accepts "column" on a one-to-one reference, which does have an FK column', () => {
    // The rejection above must be about having no column, not about being a
    // reference. Without this test the check could reject all references and
    // still look correct.
    const type = parseOk([
      {
        name: 'author', label: 'Author', type: 'reference',
        target: 'content--person', rel: 'one-to-one', required: false,
        column: 'writer',
      },
    ])
    expect(type.fields[0]!.db_column!.column_name).toBe('writer')
  })

  it('rejects a tombstone that is also required', () => {
    const errors = parseErrors([
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: true, removed: true },
    ])
    const err = errors.find((e) => e.code === 'TOMBSTONE_REQUIRED')
    expect(err).toBeDefined()
    expect(err!.message).toContain('blog_desc')
  })

  it('rejects a fallback on a live field', () => {
    const errors = parseErrors([
      { name: 'title', label: 'Title', type: 'text/plain', required: false, fallback: 'x' },
    ])
    expect(errors.map((e) => e.code)).toContain('FALLBACK_WITHOUT_TOMBSTONE')
  })

  it('rejects two fields resolving to one column', () => {
    const errors = parseErrors([
      { name: 'title', label: 'Title', type: 'text/plain', required: false, column: 'blog_title' },
      { name: 'blog_title', label: 'Old', type: 'text/plain', required: false },
    ])
    const err = errors.find((e) => e.code === 'DUPLICATE_COLUMN')
    expect(err).toBeDefined()
    // The message must name both fields and the column, or the author cannot
    // tell which two of thirty fields collided.
    expect(err!.message).toContain('title')
    expect(err!.message).toContain('blog_title')
  })

  it('does not report a duplicate column for two fields with no storage column', () => {
    // A paragraph field's `name` is not a column, so two of them cannot collide
    // on one. Without the hasStorageColumn filter, a text field with
    // column: 'b' and a paragraph field named 'b' would be a false positive.
    const type = parseOk([
      { name: 'a', label: 'A', type: 'text/plain', required: false, column: 'b' },
      { name: 'b', label: 'B', type: 'paragraph', ref: 'paragraph--photo_card', rel: 'one-to-many', required: false },
    ])
    expect(type.fields).toHaveLength(2)
  })

  it('reports a duplicate column in a taxonomy type too', () => {
    // Task 6 deletes validateModelStructure on the strength of this check
    // covering every registry the parser can produce — content AND taxonomy.
    const result = parseSchema(
      {
        name: 'taxonomy--tag', label: 'Tag', type: 'taxonomy-type',
        fields: [
          { name: 'title', label: 'Title', type: 'text/plain', required: false, column: 'tag_title' },
          { name: 'tag_title', label: 'Old', type: 'text/plain', required: false },
        ],
      },
      'taxonomy-type',
      'schemas/taxonomy-types/tag.json'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('DUPLICATE_COLUMN')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/field-declarations.test.ts`
Expected: FAIL. The rejection tests fail because the parse *succeeds* (`expected parse to fail`); `accepts "column" on a one-to-one reference` and the two no-false-positive tests already pass.

- [ ] **Step 3: Add the five error codes**

In `src/parser/loader.ts`, add to the `ParseErrorCode` union, alongside the existing `VERSION_*` members:

```typescript
  | 'DUPLICATE_COLUMN'
  | 'TOMBSTONE_REQUIRED'
  | 'FALLBACK_WITHOUT_TOMBSTONE'
  | 'VERSION_COLUMN_MISSING'
  | 'ORPHANED_TOMBSTONE'
```

Leave the four codes this plan retires (`AMBIGUOUS_RENAME`, `RENAME_CHAIN_BROKEN`, `VERSION_MODEL_INCONSISTENT`, `VERSION_RETENTION_UNSUPPORTED`) in place for now — they are still raised by `validate.ts` until Task 6, and removing them here would not compile.

- [ ] **Step 4: Add the per-field check**

In `src/parser/parseSchema.ts`, add above `buildParsedField`:

```typescript
// ─── Version declaration validation ─────────────────────────────────────────
//
// Each of these is a case where ignoring the declaration would produce a WRONG
// contract, not merely a smaller one: a dropped `column` override puts the
// field on the wrong column, and an unsatisfiable tombstone would emit a NOT
// NULL column nothing can ever populate.
function checkFieldDeclarations(
  rawField: RawField,
  built: BuiltField,
  sourceFile: string,
  schemaName: string
): ParseError[] {
  const errors: ParseError[] = []
  const tombstone = rawField.removed === true

  if (!isColumnBacked(built) && (rawField.column !== undefined || tombstone)) {
    const declared = rawField.column !== undefined ? '"column"' : '"removed"'
    errors.push({
      file: sourceFile,
      code: 'UNRENAMEABLE_FIELD_KIND',
      message:
        `Field "${rawField.name}" in "${schemaName}" declares ${declared}, but a ${rawField.type} ` +
        `field has no storage column of its own — its name already is its identity, so there is ` +
        `nothing to rename or retain. Remove the declaration.`,
    })
  }

  if (tombstone && rawField.required) {
    errors.push({
      file: sourceFile,
      code: 'TOMBSTONE_REQUIRED',
      message:
        `Field "${rawField.name}" in "${schemaName}" is marked both "removed" and "required". ` +
        `A tombstone retains a column nothing writes any more, so a required tombstone can never ` +
        `be satisfied. Set "required": false, or remove "removed" to bring the field back.`,
    })
  }

  if (rawField.fallback !== undefined && !tombstone) {
    errors.push({
      file: sourceFile,
      code: 'FALLBACK_WITHOUT_TOMBSTONE',
      message:
        `Field "${rawField.name}" in "${schemaName}" declares a "fallback" but is not marked ` +
        `"removed": true. A fallback is the value served for rows created after a removal, so it ` +
        `is meaningful only on a tombstone. Add "removed": true, or remove the fallback.`,
    })
  }

  return errors
}
```

`BuiltField` must be imported as a type in `parseSchema.ts` — extend the existing `../registry/fieldTypeRegistry` import:

```typescript
import {
  fieldTypeRegistry,
  machineNameToTableName,
  type AnyFieldBuilder,
  type BuiltField,
} from '../registry/fieldTypeRegistry'
```

- [ ] **Step 5: Wire the per-field check into `buildParsedField`**

Immediately after `const built = build(rawField, { ownerTableName })`, insert:

```typescript
  const declErrors = checkFieldDeclarations(rawField, built, sourceFile, ownerTableName)
  if (declErrors.length > 0) return { ok: false, errors: declErrors }
```

`ownerTableName` is used as the schema name in the message. It is the table name (`content_blog_post`), not the machine name — close enough to locate the schema, and it is the only name `buildParsedField` receives. Do not add a parameter for this.

- [ ] **Step 6: Add the duplicate-column check**

In `src/parser/parseSchema.ts`, add directly below `checkDuplicateFieldNames`:

```typescript
// Whether a raw field will end up with a storage column, decided from the raw
// shape because this check runs before the builders do. Mirrors
// isColumnBacked's rule at the raw level: paragraph and programmatic fields
// have no column, and a many-to-many reference's association lives in a
// junction table.
function hasStorageColumn(f: RawField): boolean {
  if (f.type === 'paragraph' || f.type === 'programmatic') return false
  if (f.type === 'reference' && f.rel === 'many-to-many') return false
  return true
}

// Two fields resolving to one column would have db codegen emit a single
// column for both and the API serve one stored value under two names. The
// duplicate-NAME check above does not catch it: the names differ, only the
// columns collide — which is exactly what a half-finished rename looks like.
function checkDuplicateColumns(
  fields: RawField[],
  sourceFile: string,
  schemaName: string
): ParseError[] {
  const owner = new Map<string, string>()
  const errors: ParseError[] = []

  for (const f of fields) {
    if (!hasStorageColumn(f)) continue
    const column = f.column ?? f.name
    const first = owner.get(column)
    if (first !== undefined) {
      errors.push({
        file: sourceFile,
        code: 'DUPLICATE_COLUMN',
        message:
          `Fields "${first}" and "${f.name}" in schema "${schemaName}" both resolve to column ` +
          `"${column}". One column backs exactly one field. If "${f.name}" replaced "${first}", ` +
          `delete the old field instead of keeping both; if they are genuinely different fields, ` +
          `give one an explicit "column".`,
      })
      continue
    }
    owner.set(column, f.name)
  }

  return errors
}
```

- [ ] **Step 7: Call it at all three sites**

At `parseSchema.ts:312` (content, on the tab-flattened list), `:378` (paragraph) and `:405` (taxonomy), each currently reads:

```typescript
  const dupErrors = checkDuplicateFieldNames(flatRawFields, sourceFile, v.name)
```

Extend each to append the column errors, keeping the existing variable and its use:

```typescript
  const dupErrors = [
    ...checkDuplicateFieldNames(flatRawFields, sourceFile, v.name),
    ...checkDuplicateColumns(flatRawFields, sourceFile, v.name),
  ]
```

The paragraph and taxonomy sites use `v.fields` rather than `flatRawFields` — use whichever list that site already passes.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/field-declarations.test.ts`
Expected: PASS, all 18.

- [ ] **Step 9: Run the whole suite and lint**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: 267 passed, 2 todo.

`parseSchema.errors.test.ts` is the file most likely to break — check whether any test there asserts an exact `errors.length` on a schema that now also trips a new check. If one does, the fix is to assert the code is *present* rather than to assert a total; a count assertion that a new check breaks was over-specified.

Run: `pnpm --filter @bobbykim/manguito-cms-core lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): reject a misused column, removed or fallback declaration"
```

---

## Task 4: The union becomes the current registry

`buildUnionRegistry` merged every live snapshot and folded each field's column. With retention stated as a tombstone, there is nothing left to merge: the current schema already contains every column any live version needs, or Task 6's completeness check rejects the model. The function becomes the identity, so it goes.

**Files:**
- Delete: `packages/core/src/versions/union.ts`
- Delete: `packages/core/src/versions/__tests__/union.test.ts`
- Modify: `packages/core/src/versions/compute.ts`
- Modify: `packages/core/src/versions/types.ts` (the `VersionModel.union` doc comment)
- Test: `packages/core/src/versions/__tests__/compute.test.ts` (the union assertions move here)

**Interfaces:**
- Consumes: `ParsedField.removed` (Task 2).
- Produces: `VersionModel.union === input.current` by reference. Task 6 relies on this; so will 2b.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/versions/__tests__/compute.test.ts` — check the file's existing imports and reuse its fixture helpers:

```typescript
describe('computeVersionModel — the union is current', () => {
  it('returns current itself as the union, by reference', () => {
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const result = computeVersionModel({ current, snapshots: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Not merely deep-equal: retention is stated, so there is no merge step
    // that could produce a copy. 2b consumes this as an ordinary SchemaRegistry.
    expect(result.value.union).toBe(current)
  })

  it('keeps a tombstone in the union as a nullable column', () => {
    // The tombstone is what makes "the union is current" safe: the retained
    // column is IN current, so db codegen still emits it.
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snap = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const result = computeVersionModel({ current, snapshots: [snap] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const fields = result.value.union.content_types['content--blog_post']!.fields
    const retained = fields.find((f) => f.db_column?.column_name === 'blog_desc')
    expect(retained).toBeDefined()
    expect(retained!.db_column!.nullable).toBe(true)
    expect(retained!.removed).toBe(true)
  })

  it('leaves a non-tombstone field\'s own nullability alone', () => {
    // The falsifiable half of the test above: forcing nullable must apply to
    // tombstones only. A blanket `nullable: true` over the union would pass
    // that test and make every required column optional.
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title', required: true },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snap = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title', required: true },
          { name: 'blog_desc', type: 'text/rich' },
        ]),
      ]),
    }
    const result = computeVersionModel({ current, snapshots: [snap] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const title = result.value.union.content_types['content--blog_post']!.fields
      .find((f) => f.name === 'title')!
    expect(title.db_column!.nullable).toBe(false)
    expect(title.required).toBe(true)
  })
})
```

`makeContentType` needs the `removed` key — that is Step 2.

- [ ] **Step 2: Add the three keys to the test fixtures**

In `packages/core/src/versions/__tests__/fixtures.ts`, extend `FieldSpec` and `toRawField`:

```typescript
export type FieldSpec = {
  name: string
  type?: string
  required?: boolean
  ref?: string
  rel?: string
  // ─── Version declarations, passed straight through to the raw field ───────
  // Divergence between a field's name and its column is now DECLARED, so a
  // fixture states it the same way a schema author would. Nothing is
  // hand-forged onto a ParsedField: it still goes through parseSchema.
  column?: string
  removed?: boolean
  fallback?: unknown
}
```

In `toRawField`, add the three keys to **both** returned shapes (the paragraph branch and the default branch), omitting each when absent:

```typescript
  const declarations = {
    ...(f.column !== undefined && { column: f.column }),
    ...(f.removed !== undefined && { removed: f.removed }),
    ...(f.fallback !== undefined && { fallback: f.fallback }),
  }
```

then spread `...declarations` into each returned object. The paragraph branch needs them too — Task 3's `UNRENAMEABLE_FIELD_KIND` test in `rename-shapes.test.ts` (Task 8) constructs exactly that case through the fixtures.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/compute.test.ts`
Expected: FAIL — `computeVersionModel` still requires `history` and `pending`, so the two-argument call does not type-check and the run aborts on a TypeScript error.

- [ ] **Step 4: Delete `union.ts` and its test**

```bash
git rm packages/core/src/versions/union.ts packages/core/src/versions/__tests__/union.test.ts
```

Before deleting `union.test.ts`, read it. Any assertion there about *retention* or *nullability* that is not already covered by Step 1's tests must be carried over to `compute.test.ts` — those are real requirements, and the module going away does not retire them. Assertions about the fold, rename windows, or `columnOf` do retire.

- [ ] **Step 5: Rewrite `compute.ts`**

```typescript
// packages/core/src/versions/compute.ts
import type { Result } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { VersionModel, VersionSnapshot } from './types.js'
import { validateVersionModel } from './validate.js'
import { buildProjections } from './projections.js'

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
}): Result<VersionModel> {
  const { current, snapshots } = input

  // Current is one past the highest cut; v1 when nothing has been cut.
  const highest = snapshots.reduce((max, s) => Math.max(max, versionNumber(s.version)), 0)
  const currentVersion = `v${highest + 1}`
  // `live` is documented oldest-first, so the order comes from the version
  // NUMBER, never the caller's array order — a direct call with [v2, v1] must
  // not produce live: ['v2','v1','v3']. Deduplicated for the same reason.
  const live = [
    ...new Set(snapshots.map((s) => s.version).sort((a, b) => versionNumber(a) - versionNumber(b))),
    currentVersion,
  ]

  // The union IS current. Retention is stated as a tombstone rather than
  // derived by merging snapshots, so a column an older live version still
  // serves is already in current — and checkUnionCompleteness below is what
  // makes that true, by rejecting any model where it is not. That check is the
  // whole of what the merge used to paper over.
  const union = current

  // Built BEFORE validation, unlike the derived model, which validated first
  // on the grounds that building an invalid model produces plausible-looking
  // wrong output. A projection is now a pure read of one version's own schema
  // files: it cannot be wrong, only incomplete — and detecting that is exactly
  // what the completeness check reads the projections for.
  const projections = buildProjections({ current, currentVersion, snapshots })

  const errors = validateVersionModel({ current, currentVersion, snapshots, union, projections })
  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, value: { current: currentVersion, live, union, projections } }
}
```

This will not compile until Tasks 5 and 6 change `buildProjections` and `validateVersionModel`. That is expected — the remaining steps of this task only remove the *old* union path.

- [ ] **Step 6: Update the `VersionModel.union` doc comment**

In `src/versions/types.ts`, replace the `union` field's comment (the one whose `LIMITATION:` paragraph describes retention's boundary and `VERSION_RETENTION_UNSUPPORTED`) with:

```typescript
  /**
   * Every column any live version needs, keyed by column — which is the
   * CURRENT registry itself, `=== current` by reference.
   *
   * Retention is stated (a tombstone), not derived by merging snapshots, so
   * there is nothing to merge: a column an older live version still serves is
   * in current as a tombstone, or `VERSION_COLUMN_MISSING` rejects the model.
   * That also removes the derived model's retention gaps — a type current
   * deleted, and a paragraph type's own column — because the author is now
   * *required* to keep them rather than the model trying to reconstruct them.
   *
   * Feeds db codegen and drift detection. A tombstone appears here as an
   * ordinary nullable column; consumers that render or expose fields must skip
   * `removed` fields, which is why the api and admin filter on it.
   */
  union: SchemaRegistry
```

- [ ] **Step 7: Commit (compilation still broken — say so in the message)**

```bash
git add -A packages/core/src
git commit -m "refactor(core): drop the union merge, the union is now current

buildUnionRegistry merged every live snapshot and folded each field's
column. With retention stated as a tombstone there is nothing to merge,
so the function was the identity and is gone.

Does not compile on its own: compute.ts now calls buildProjections and
validateVersionModel with their Task 5/6 signatures."
```

A deliberately non-compiling intermediate commit is acceptable here because the alternative is one unreviewable commit spanning five modules. Tasks 5 and 6 restore the build. Do **not** push until Task 6 is green.

---

## Task 5: Projections read each version's own schema

`buildProjections` called `columnOf` per field to fold a column out of the rename history. Now every field states its column, so a projection is a read. Two things need care: a tombstone is excluded from the version that declares it, and a `fallback` is declared on **current's** tombstone but consumed by the **older** versions' projections.

**Files:**
- Modify: `packages/core/src/versions/projections.ts` (rewrite)
- Test: `packages/core/src/versions/__tests__/projections.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ParsedField.removed` / `.fallback` (Task 2); `isColumnBacked` from `../registry/columns.js` (Task 1).
- Produces: `buildProjections(input: { current: SchemaRegistry; currentVersion: string; snapshots: VersionSnapshot[] }): Record<string, VersionProjection>`. `history` and `pending` are gone from the signature. `VersionProjection` itself is unchanged.

- [ ] **Step 1: Write the failing tests**

Rewrite `packages/core/src/versions/__tests__/projections.test.ts`. Keep its existing imports of `makeContentType` / `makeTaxonomyType` / `makeRegistry`, drop `EMPTY_HISTORY` / `EMPTY_PENDING`.

```typescript
import { describe, it, expect } from 'vitest'
import { buildProjections } from '../projections'
import { makeContentType, makeTaxonomyType, makeRegistry } from './fixtures'

describe('buildProjections — a renamed field', () => {
  it('exposes the old name in the old version and the new name in current, over one column', () => {
    // The redesign's central case. v1's own schema file says `blog_title`;
    // current says `title` with column `blog_title`. One column, two names,
    // and nothing folded.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'blog_title' }])]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ])
    expect(projections['v2']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title' },
    ])
  })
})

describe('buildProjections — a tombstone', () => {
  it('excludes the tombstone from current while the older version still exposes it', () => {
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields.map((f) => f.exposed_as))
      .toEqual(['title', 'blog_desc'])
    // Current retains the column but does not serve it.
    expect(projections['v2']!.types['content--blog_post']!.fields.map((f) => f.exposed_as))
      .toEqual(['title'])
  })

  it('attaches a fallback declared on current to the OLDER version that still exposes the column', () => {
    // The subtlety worth its own test. The fallback lives on current's
    // tombstone, because that is what knows the column stopped being written.
    // The version that NEEDS it is v1 — the one still serving the column to
    // rows created since. Reading the fallback off each projection's own
    // registry would leave it permanently inert: v1's snapshot predates the
    // tombstone and has no fallback on it, and current never exposes the
    // column at all.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true, fallback: '' },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    const v1Desc = projections['v1']!.types['content--blog_post']!.fields
      .find((f) => f.column_name === 'blog_desc')
    expect(v1Desc).toEqual({ column_name: 'blog_desc', exposed_as: 'blog_desc', fallback: '' })
  })

  it('keys the fallback by column, so a field renamed and then removed still matches', () => {
    // v1 exposes column `description` as `description`. Current's tombstone is
    // named `blog_desc` but declares column `description`. Keying the fallback
    // by NAME would miss it; keying by column matches.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'description', type: 'text/rich' }])]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'blog_desc', type: 'text/rich', column: 'description', removed: true, fallback: 'gone' },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'description', exposed_as: 'description', fallback: 'gone' },
    ])
  })
})

describe('buildProjections — shape', () => {
  it('omits fallback entirely when none is declared', () => {
    // Not `fallback: undefined`. The zero-config case must deep-equal cleanly
    // in tests and over the wire.
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'title', exposed_as: 'title' },
    ])
  })

  it('projects taxonomy types alongside content types', () => {
    const current = makeRegistry([
      makeContentType('content--blog_post', [{ name: 'title' }]),
      makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
    ])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(Object.keys(projections['v1']!.types).sort()).toEqual(['content--blog_post', 'taxonomy--tag'])
  })

  it('excludes fields with no storage column', () => {
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'cards', type: 'paragraph', ref: 'paragraph--photo_card', rel: 'one-to-many' },
      ]),
    ])
    const projections = buildProjections({ current, currentVersion: 'v1', snapshots: [] })
    expect(projections['v1']!.types['content--blog_post']!.fields.map((f) => f.exposed_as)).toEqual(['title'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/projections.test.ts`
Expected: FAIL — `buildProjections` still requires `live`, `history` and `pending`, so the calls do not type-check.

- [ ] **Step 3: Rewrite `projections.ts`**

```typescript
// packages/core/src/versions/projections.ts
import type { SchemaRegistry } from '../parser/validate.js'
import type { VersionProjection, VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

/**
 * Fallbacks declared on CURRENT's tombstones, keyed `"<type>.<column>"`.
 *
 * A fallback is declared where the removal is declared — on current's
 * tombstone, which is what knows the column stopped being written. It is
 * consumed by the OLDER versions' projections: they are the ones still serving
 * that column, to rows created since the removal. Current never exposes it.
 *
 * Keyed by COLUMN, not name: a field renamed and then removed carries both
 * `column` and `removed`, so its name need not match the name any older
 * version exposes the column under.
 */
function collectFallbacks(current: SchemaRegistry): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [typeName, type] of [
    ...Object.entries(current.content_types),
    ...Object.entries(current.taxonomy_types),
  ]) {
    for (const f of type.fields) {
      if (f.fallback === undefined || !isColumnBacked(f)) continue
      out.set(`${typeName}.${f.db_column!.column_name}`, f.fallback)
    }
  }
  return out
}

/**
 * What each live version exposes: per type, each column and the name THAT
 * version exposes it under, plus any fallback.
 *
 * Each version is read from its OWN schema files — a snapshot for a cut
 * version, the working schema for current. No computation spans versions,
 * because every field states its column: that is the entire difference from
 * the derived model, which folded a rename history per field.
 *
 * A tombstone is excluded from the version that declares it — it retains a
 * column for OLDER versions and is not part of this version's contract. Older
 * snapshots have no tombstone for it and go on exposing it.
 */
export function buildProjections(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
}): Record<string, VersionProjection> {
  const { current, currentVersion, snapshots } = input
  const byVersion: Array<{ version: string; registry: SchemaRegistry }> = [
    ...snapshots,
    { version: currentVersion, registry: current },
  ]

  const fallbacks = collectFallbacks(current)
  const out: Record<string, VersionProjection> = {}

  for (const { version, registry } of byVersion) {
    const types: VersionProjection['types'] = {}

    for (const [typeName, type] of [
      ...Object.entries(registry.content_types),
      ...Object.entries(registry.taxonomy_types),
    ]) {
      const fields = type.fields
        .filter((f) => isColumnBacked(f) && f.removed !== true)
        .map((f) => {
          const column_name = f.db_column!.column_name
          const fallback = fallbacks.get(`${typeName}.${column_name}`)
          // Omitted entirely rather than set undefined, so the zero-config
          // case deep-equals cleanly in tests and over the wire.
          return fallback === undefined
            ? { column_name, exposed_as: f.name }
            : { column_name, exposed_as: f.name, fallback }
        })
      types[typeName] = { fields }
    }

    out[version] = { version, types }
  }

  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/projections.test.ts`
Expected: PASS, all 7.

The rest of the suite still fails to compile — `validate.ts` is Task 6.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "refactor(core): read each version's projection from its own schema"
```

---

## Task 6: The completeness and orphan checks

This is where the model becomes sound. Two new checks replace four old ones, and a fifth old check is deleted as subsumed.

**Kept:** `FIELD_TYPE_CHANGED_WHILE_LIVE` (rewritten to read stated columns instead of folded ones).
**Replaced by `VERSION_COLUMN_MISSING`:** `checkAmbiguousRenames` (`AMBIGUOUS_RENAME`), `checkUnretainableLiveSurface` (`VERSION_RETENTION_UNSUPPORTED`), and `validateRenameChain` (`RENAME_CHAIN_BROKEN`).
**Moved to the parser in Task 3:** `checkUnrenameableFieldKind` (`UNRENAMEABLE_FIELD_KIND`).
**Deleted as subsumed:** `validateModelStructure` (`VERSION_MODEL_INCONSISTENT`). Both halves of it are now parser-enforced. Its union half — two fields of one type on one column — is Task 3's `DUPLICATE_COLUMN`, and the union is current, a registry the parser produced. Its projection half — one column exposed under two names in one version — cannot arise either: a projection's fields come from a single registry, and that registry's duplicates were caught the same way. Snapshots go through `parseSchema` too, so they are covered.
**New:** `VERSION_COLUMN_MISSING`, `ORPHANED_TOMBSTONE`.

**Files:**
- Modify: `packages/core/src/versions/validate.ts` (rewrite)
- Modify: `packages/core/src/parser/loader.ts` (remove the four retired codes)
- Test: `packages/core/src/versions/__tests__/validate.test.ts` (rewrite)

**Interfaces:**
- Consumes: `VersionProjection` (unchanged), `ParsedField.removed`, `isColumnBacked`.
- Produces: `validateVersionModel(input: { current: SchemaRegistry; currentVersion: string; snapshots: VersionSnapshot[]; union: SchemaRegistry; projections: Record<string, VersionProjection> }): ParseError[]`. Note it now takes the *built* `union` and `projections`, which is why `compute.ts` builds them first. `validateModelStructure` and `validateRenameChain` are no longer exported.

- [ ] **Step 1: Write the failing tests**

Rewrite `packages/core/src/versions/__tests__/validate.test.ts`. Drive it through `computeVersionModel` rather than calling the checks directly — the checks read built projections, and testing through the public entry point is what caught 2a's broken feedback loop.

```typescript
import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeRegistry } from './fixtures'
import type { VersionSnapshot } from '../types'

function snapshot(version: string, schemas: Parameters<typeof makeRegistry>[0]): VersionSnapshot {
  return { version, registry: makeRegistry(schemas) }
}

function errorsOf(current: ReturnType<typeof makeRegistry>, snapshots: VersionSnapshot[]) {
  const result = computeVersionModel({ current, snapshots })
  if (result.ok) return []
  return result.errors.map((e) => ({ code: e.code, message: e.message }))
}

describe('VERSION_COLUMN_MISSING', () => {
  it('fires when a forgotten column override leaves a live version exposing nothing', () => {
    // v1 exposes column `blog_title`. Current renamed the field to `title` but
    // forgot `"column": "blog_title"`, so current's only column is `title` and
    // v1's column has vanished from the union.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    const err = errors.find((e) => e.code === 'VERSION_COLUMN_MISSING')
    expect(err).toBeDefined()
    // Both fixes must appear, verbatim enough to paste. 2a shipped an error
    // whose suggested fix did not suppress it; the two tests below prove each
    // of these actually does.
    expect(err!.message).toContain('"column": "blog_title"')
    expect(err!.message).toContain('"removed": true')
  })

  it('is suppressed by declaring the column — the first fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('is suppressed by a tombstone — the second fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_title', removed: true },
        ]),
      ]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('fires when current deleted a type a live version still exposes, naming the type', () => {
    // The derived model refused this with VERSION_RETENTION_UNSUPPORTED
    // because it could not reconstruct a deleted type. Stating retention turns
    // it into an ordinary completeness failure with an actionable fix.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'title' }]),
        makeContentType('content--old_thing', [{ name: 'x' }]),
      ])]
    )
    const err = errors.find((e) => e.code === 'VERSION_COLUMN_MISSING')
    expect(err).toBeDefined()
    expect(err!.message).toContain('content--old_thing')
  })

  it('does not fire for a field no live version ever exposed', () => {
    // A field added to current only. Nothing older exposes it, so there is
    // nothing to be complete about.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }, { name: 'subtitle' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('does not fire in the zero-config case', () => {
    const errors = errorsOf(makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]), [])
    expect(errors).toEqual([])
  })
})

describe('ORPHANED_TOMBSTONE', () => {
  it('fires for a tombstone no live version exposes', () => {
    // The residue of a retirement: v1's directory was deleted, but the
    // tombstone retaining its column was not. It is a column nothing can read.
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_desc', type: 'text/rich', removed: true },
        ]),
      ]),
      []
    )
    const err = errors.find((e) => e.code === 'ORPHANED_TOMBSTONE')
    expect(err).toBeDefined()
    expect(err!.message).toContain('blog_desc')
  })

  it('does not fire while a live version still exposes the column', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_desc', type: 'text/rich', removed: true },
        ]),
      ]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ])]
    )
    expect(errors).toEqual([])
  })
})

describe('FIELD_TYPE_CHANGED_WHILE_LIVE', () => {
  it('fires when a live version exposes a column current now types differently', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', type: 'integer' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'title', type: 'text/plain' }])])]
    )
    const err = errors.find((e) => e.code === 'FIELD_TYPE_CHANGED_WHILE_LIVE')
    expect(err).toBeDefined()
    expect(err!.message).toContain('title')
  })

  it('matches by column, not by name, so a renamed field is still checked', () => {
    // v1 exposes column `blog_title` as text/plain. Current exposes the same
    // column as `title`, typed integer. Matching by NAME would miss it
    // entirely — `blog_title` no longer exists as a name.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', type: 'integer', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title', type: 'text/plain' }])])]
    )
    expect(errors.map((e) => e.code)).toContain('FIELD_TYPE_CHANGED_WHILE_LIVE')
  })

  it('does not fire when the type is unchanged', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })
})

describe('errors accumulate', () => {
  it('reports every failure rather than stopping at the first', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }]),
        makeContentType('content--other', [{ name: 'a' }]),
      ]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'blog_title' }]),
        makeContentType('content--other', [{ name: 'old_a' }]),
      ])]
    )
    expect(errors.filter((e) => e.code === 'VERSION_COLUMN_MISSING')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/validate.test.ts`
Expected: FAIL — `computeVersionModel` and `validateVersionModel` signatures do not yet line up, so the file does not compile.

- [ ] **Step 3: Rewrite `validate.ts`**

Replace the file wholesale:

```typescript
// packages/core/src/versions/validate.ts
import type { ParseError } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { VersionProjection, VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Every content and taxonomy type in a registry, as [name, fields] pairs. */
function typeEntries(registry: SchemaRegistry): Array<[string, ParsedField[]]> {
  return [
    ...Object.entries(registry.content_types),
    ...Object.entries(registry.taxonomy_types),
  ].map(([name, type]) => [name, type.fields])
}

/** Per type, its column-backed fields keyed by column. Tombstones included — they hold a real column. */
function fieldsByColumn(registry: SchemaRegistry): Map<string, Map<string, ParsedField>> {
  const out = new Map<string, Map<string, ParsedField>>()
  for (const [typeName, fields] of typeEntries(registry)) {
    const byColumn = new Map<string, ParsedField>()
    for (const f of fields) {
      if (!isColumnBacked(f)) continue
      byColumn.set(f.db_column!.column_name, f)
    }
    out.set(typeName, byColumn)
  }
  return out
}

// ─── VERSION_COLUMN_MISSING ─────────────────────────────────────────────────
//
// Every column a live version's projection exposes must exist in the union.
//
// This is what the derived model needed AMBIGUOUS_RENAME's heuristic for, and
// it is strictly stronger: it checks a PRESENCE — is this column in the union?
// — instead of interpreting an ABSENCE — did this name disappear because of an
// undeclared rename, or an intentional deletion? There is nothing to guess, so
// there is nothing to confirm either, which is why `pending.json`'s `drops`
// array has no successor.
//
// It is also what makes `union === current` sound, and what closes the derived
// model's two retention gaps: a type current deleted, and a paragraph type's
// own column, are no longer things the model tries to reconstruct — the author
// is required to keep them, and told so here.
function checkUnionCompleteness(input: {
  union: SchemaRegistry
  projections: Record<string, VersionProjection>
  currentVersion: string
}): ParseError[] {
  const { union, projections, currentVersion } = input
  const errors: ParseError[] = []
  const unionColumns = fieldsByColumn(union)

  for (const [version, projection] of Object.entries(projections)) {
    // Current's projection is a read of the union itself, so it is complete by
    // construction — checking it would be vacuous.
    if (version === currentVersion) continue

    for (const [typeName, type] of Object.entries(projection.types)) {
      const columns = unionColumns.get(typeName)

      if (columns === undefined) {
        // The whole type is gone from current. Reported once per type rather
        // than once per field: the fix is the same for all of them.
        errors.push({
          file: `schemas/versions/${version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${version} exposes type "${typeName}", which the current schema no longer ` +
            `defines. Every column a live version serves must still exist. Keep "${typeName}" in the ` +
            `current schema with its fields marked "removed": true, or retire ${version} by deleting ` +
            `schemas/versions/${version}.`,
        })
        continue
      }

      for (const f of type.fields) {
        if (columns.has(f.column_name)) continue
        errors.push({
          file: `schemas/versions/${version}`,
          code: 'VERSION_COLUMN_MISSING',
          message:
            `Live version ${version} exposes column "${f.column_name}" on "${typeName}" (as ` +
            `"${f.exposed_as}"), which the current schema neither exposes nor retains. Either add ` +
            `"column": "${f.column_name}" to the field that replaced it, or add a field ` +
            `{ "name": "${f.exposed_as}", "removed": true } to retain the column while ${version} ` +
            `is live.`,
        })
      }
    }
  }

  return errors
}

// ─── ORPHANED_TOMBSTONE ─────────────────────────────────────────────────────
//
// A tombstone emits a real column into the union, so one that NO live version
// exposes is a column nothing can ever read — the residue of a retirement
// whose tombstone was not deleted alongside the snapshot directory.
//
// Rejecting it is what keeps retirement from silently accumulating dead
// columns, and it is only checkable because retention is stated: the derived
// model could not tell a deliberately retained column from one left over,
// which is exactly why its history could never be pruned.
function checkOrphanedTombstones(input: {
  current: SchemaRegistry
  projections: Record<string, VersionProjection>
  currentVersion: string
}): ParseError[] {
  const { current, projections, currentVersion } = input
  const errors: ParseError[] = []

  // Every (type, column) some version OTHER than current exposes.
  const exposed = new Set<string>()
  for (const [version, projection] of Object.entries(projections)) {
    if (version === currentVersion) continue
    for (const [typeName, type] of Object.entries(projection.types)) {
      for (const f of type.fields) exposed.add(`${typeName}.${f.column_name}`)
    }
  }

  for (const [typeName, fields] of typeEntries(current)) {
    for (const f of fields) {
      if (f.removed !== true || !isColumnBacked(f)) continue
      if (exposed.has(`${typeName}.${f.db_column!.column_name}`)) continue
      errors.push({
        file: current.schemas[typeName]?.source_file ?? '',
        code: 'ORPHANED_TOMBSTONE',
        message:
          `Field "${f.name}" on "${typeName}" is marked "removed": true, retaining column ` +
          `"${f.db_column!.column_name}", but no live version exposes that column any more. It is a ` +
          `column nothing can read. Delete the field — that shrinks the union and lets db codegen ` +
          `drop the column.`,
      })
    }
  }

  return errors
}

// ─── FIELD_TYPE_CHANGED_WHILE_LIVE ──────────────────────────────────────────
//
// One column cannot hold two types, so a live version's contract cannot change
// type under its consumers. Matched by COLUMN, not by name: a renamed field's
// old name no longer exists, and matching by name would miss precisely the case
// versioning exists to handle.
function checkFieldTypeChangedWhileLive(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
}): ParseError[] {
  const { current, snapshots } = input
  const errors: ParseError[] = []
  const currentByType = fieldsByColumn(current)

  for (const snap of snapshots) {
    for (const [typeName, snapColumns] of fieldsByColumn(snap.registry)) {
      const currentColumns = currentByType.get(typeName)
      if (!currentColumns) continue // the whole type is gone — VERSION_COLUMN_MISSING's concern

      for (const [col, oldField] of snapColumns) {
        const currentField = currentColumns.get(col)
        if (!currentField) continue // absent — VERSION_COLUMN_MISSING's concern, not this one's
        if (currentField.field_type === oldField.field_type) continue

        errors.push({
          file: `schemas/versions/${snap.version}`,
          code: 'FIELD_TYPE_CHANGED_WHILE_LIVE',
          message:
            `Column "${col}" on "${typeName}" is exposed by live version ${snap.version} as ` +
            `${oldField.field_type}, but the current schema now types it ${currentField.field_type}. ` +
            `A live version's contract cannot change type under its consumers — retire ` +
            `${snap.version} first, or keep the field's type stable and introduce the change as a ` +
            `new column instead.`,
        })
      }
    }
  }

  return errors
}

// ─── validateVersionModel ───────────────────────────────────────────────────

/**
 * Takes the BUILT union and projections, unlike the derived model's validator,
 * which ran first and rebuilt what it needed. A projection is now a pure read
 * of one version's own schema files — it cannot be wrong, only incomplete, and
 * checking that is what reading the built projections is for.
 */
export function validateVersionModel(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  union: SchemaRegistry
  projections: Record<string, VersionProjection>
}): ParseError[] {
  return [
    ...checkUnionCompleteness(input),
    ...checkOrphanedTombstones(input),
    ...checkFieldTypeChangedWhileLive(input),
  ]
}
```

- [ ] **Step 4: Remove the four retired error codes**

In `src/parser/loader.ts`, delete these members of `ParseErrorCode`:

```typescript
  | 'AMBIGUOUS_RENAME'
  | 'RENAME_CHAIN_BROKEN'
  | 'VERSION_RETENTION_UNSUPPORTED'
  | 'VERSION_MODEL_INCONSISTENT'
```

Then confirm nothing still references them:

Run: `grep -rn "AMBIGUOUS_RENAME\|RENAME_CHAIN_BROKEN\|VERSION_RETENTION_UNSUPPORTED\|VERSION_MODEL_INCONSISTENT" packages/core/src`
Expected: no hits. Any hit is either dead code from a module this plan deletes (remove it) or a test asserting a retired behaviour (delete that test — the behaviour is genuinely retired, and the tests written in Step 1 cover its replacement).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/validate.test.ts src/versions/__tests__/compute.test.ts src/versions/__tests__/projections.test.ts`
Expected: PASS.

`fold.ts` still exists and still compiles at this point; only `compute.ts` no longer calls it. `load.test.ts` may still fail — that is Task 7.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): replace the rename checks with a completeness check

Every column a live version's projection exposes must exist in the
union. That checks a presence rather than interpreting an absence, so
AMBIGUOUS_RENAME's heuristic and its drops confirmation both go, and
VERSION_RETENTION_UNSUPPORTED's two gaps close: the author is now
required to keep a deleted type, and told so.

validateModelStructure is subsumed by the parser's DUPLICATE_COLUMN
now that the union is a registry the parser produced."
```

---

## Task 7: Delete the derived machinery

Nothing calls `fold.ts` or reads `pending.json` / `history.json` any more. Remove them, and the exported types that only described them.

**Files:**
- Delete: `packages/core/src/versions/fold.ts`, `packages/core/src/versions/__tests__/fold.test.ts`
- Modify: `packages/core/src/versions/types.ts` (delete `PendingChanges`, `VersionHistory`)
- Modify: `packages/core/src/versions/load.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/versions/__tests__/fixtures.ts`, `fixtures.test.ts`, `load.test.ts`

**Interfaces:**
- Produces: `loadVersionModel(config: ResolvedSchemaConfig, current: SchemaRegistry): Result<VersionModel>` — signature unchanged, so no caller is affected. Core's exported types lose `PendingChanges` and `VersionHistory`.

- [ ] **Step 1: Delete the fold and its tests**

```bash
git rm packages/core/src/versions/fold.ts packages/core/src/versions/__tests__/fold.test.ts
```

- [ ] **Step 2: Delete the two declaration-file types**

In `src/versions/types.ts`, delete the `PendingChanges` and `VersionHistory` type declarations and their doc comments. Also update the module header comment, which currently ends *"a rename makes them diverge, and the fold in fold.ts is what recovers the column from a label"* — replace that clause with:

```typescript
// A field has a public name (`ParsedField.name`) and a storage column
// (`db_column.column_name`). They are identical unless the schema SAYS
// otherwise: a field declares `column` to keep its storage put while its name
// changes. Nothing is derived, so nothing needs recovering.
```

- [ ] **Step 3: Simplify `load.ts`**

Delete: the `z` / `ZodError` imports, `EMPTY_PENDING`, `EMPTY_HISTORY`, `RenameSchema`, `FallbacksSchema`, `PendingChangesSchema`, `VersionHistorySchema`, `PENDING_HINT`, `HISTORY_HINT`, `shapeErrors`, `loadOptionalJson`, and the `PendingChanges` / `VersionHistory` type imports.

Keep unchanged: `discoverSnapshotDirs`, `walkSnapshotFolders`, `wrapAsSnapshotInvalid`, `loadSnapshot`. In particular keep `walkSnapshotFolders` taking `folders` from `config.folders` — hardcoding the default folder names would make every snapshot read as silently empty in any project that renames a folder.

Replace `loadVersionModel` with:

```typescript
/**
 * Reads the snapshot directories under `versions/` and hands them to
 * computeVersionModel. Absent `versions/` means nothing has been cut yet: an
 * identity model at v1, computed with no snapshots.
 *
 * There are no declaration files to read. Under the derived model this also
 * loaded `pending.json` and `history.json`; retention and renames are now
 * stated on the fields themselves, so the snapshot directories are the whole
 * of what `versions/` holds.
 */
export function loadVersionModel(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionModel> {
  const versionsDir = path.join(config.base_path, 'versions')

  if (!directoryExists(versionsDir)) {
    return computeVersionModel({ current, snapshots: [] })
  }

  const snapshots: VersionSnapshot[] = []
  const errors: ParseError[] = []

  for (const { version, dir } of discoverSnapshotDirs(versionsDir)) {
    const result = loadSnapshot(version, dir, config.folders, current)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    snapshots.push(result.value)
  }

  if (errors.length > 0) return { ok: false, errors }

  return computeVersionModel({ current, snapshots })
}
```

A leftover `pending.json` or `history.json` is now simply ignored. Do **not** add a check for one: `loadVersionModel` has never been in a published release (core is at 0.3.0, whose exports predate the version model), so no project can have those files. There is nothing to migrate.

- [ ] **Step 4: Update the export surface**

In `src/index.ts`, remove `PendingChanges` and `VersionHistory` from the `./versions/types.js` type export block, keeping `VersionSnapshot`, `VersionProjection` and `VersionModel`.

- [ ] **Step 5: Update the test fixtures**

In `src/versions/__tests__/fixtures.ts`, delete `EMPTY_HISTORY` and `EMPTY_PENDING` along with their `PendingChanges` / `VersionHistory` type import. The `column` / `removed` / `fallback` keys added in Task 4 stay.

Run: `grep -rn "EMPTY_HISTORY\|EMPTY_PENDING" packages/core/src`
Expected: no hits. Fix each remaining importer — the constants are gone because the concept is.

- [ ] **Step 6: Update `load.test.ts` and `fixtures.test.ts`**

Read both. In `load.test.ts`, delete any test that writes a `pending.json` or `history.json` into a temp directory and asserts on its effect, or that asserts a shape error from one — those behaviours are retired. **Keep** every test about snapshot discovery, snapshot parse failures wrapping as `VERSION_SNAPSHOT_INVALID`, the absent-`versions/` identity case, and especially the `config.folders` test: that one guards a Critical defect found in 2a review, and the code it guards is unchanged.

Delete specifically: `reads pending.json when present and applies a declared rename` (line ~169), the entire `describe('malformed pending.json / history.json shapes')` block (~209-282), and `surfaces a parse error for a malformed history.json rather than defaulting it away` (~283). Keep the four above it.

Then add this test in their place — it covers end to end, through the filesystem, what those tests covered through `pending.json`. It uses the file's existing `writeSnapshot(versionDir, fieldName)` helper and `config()`:

```typescript
  it('reads a renamed field from a snapshot and projects both names over one column', () => {
    // The declarative replacement for the deleted pending.json test: the
    // snapshot's own schema file carries the old name, and current declares
    // `column` to keep the storage put. Nothing is folded and no declaration
    // file is involved.
    writeSnapshot(path.join(dir, 'versions', 'v1'), 'old_title')

    const current = makeRegistry([
      makeContentType('content--post', [{ name: 'title', column: 'old_title' }]),
    ])

    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value.current).toBe('v2')
    expect(r.value.projections['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'old_title', exposed_as: 'old_title' },
    ])
    expect(r.value.projections['v2']!.types['content--post']!.fields).toEqual([
      { column_name: 'old_title', exposed_as: 'title' },
    ])
  })

  it('reports VERSION_COLUMN_MISSING when current forgot the column override', () => {
    // The same tree with the override missing. This is the failure a real
    // author hits, reached the way they reach it — through loadVersionModel,
    // not by hand-building a model.
    writeSnapshot(path.join(dir, 'versions', 'v1'), 'old_title')

    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])

    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_COLUMN_MISSING')
  })
```

- [ ] **Step 7: Run the whole suite and lint**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS. Everything compiles again for the first time since Task 4.

Expect the total to be **below** the 267 of Task 3: `fold.test.ts` and `union.test.ts` are gone along with the derived-model tests in `validate.test.ts` and `load.test.ts`. That is the point of the redesign. Note the new total in the commit body.

Run: `pnpm --filter @bobbykim/manguito-cms-core lint`
Expected: clean. This is where an unused import left over from five files' worth of deletion will surface.

Run: `pnpm --filter @bobbykim/manguito-cms-core build`
Expected: succeeds. `tsup` type-checks the public surface, which `vitest` does not fully cover.

- [ ] **Step 8: Commit**

```bash
git add -A packages/core
git commit -m "refactor(core): delete the fold and the declaration files"
```

---

## Task 8: Shift, swap and chain — and the docs

The three cases the derived model could not handle. Under declarations they should be unambiguous by construction, and pinning them is the evidence the redesign achieved its purpose rather than merely relocating the problem.

**Files:**
- Test: `packages/core/src/versions/__tests__/rename-shapes.test.ts` (create)
- Modify: `packages/core/CONTEXT.md`

**Interfaces:**
- Consumes: everything above. Adds no production code.

- [ ] **Step 1: Write the tests**

```typescript
// packages/core/src/versions/__tests__/rename-shapes.test.ts
import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeRegistry } from './fixtures'

// These four shapes are why the version model was redesigned. Under the
// derived model, a chain (a→b, b→c) and a shift (a→b, b→c meaning something
// else entirely) had the SAME declared form, so neither could be folded
// safely and both were refused. Stated columns make each of them a set of
// independent facts with no ordering between them.

function model(currentFields: Parameters<typeof makeContentType>[1], v1Fields: Parameters<typeof makeContentType>[1]) {
  const result = computeVersionModel({
    current: makeRegistry([makeContentType('content--blog_post', currentFields)]),
    snapshots: [{ version: 'v1', registry: makeRegistry([makeContentType('content--blog_post', v1Fields)]) }],
  })
  if (!result.ok) throw new Error(`expected a valid model: ${JSON.stringify(result.errors, null, 2)}`)
  return result.value
}

/** [column, exposed_as] pairs for one version, sorted by column for a stable compare. */
function exposure(m: ReturnType<typeof model>, version: string): Array<[string, string]> {
  return m.projections[version]!.types['content--blog_post']!.fields
    .map((f): [string, string] => [f.column_name, f.exposed_as])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

describe('a shift', () => {
  it('resolves with no ordering dependence', () => {
    // v1:      title, subtitle
    // current: headline (column title), title (column subtitle)
    //
    // The name `title` means DIFFERENT columns in the two versions. The
    // derived model could not express this: `title → headline` and
    // `subtitle → title` applied in either order give different answers, and
    // sharing a tag made them simultaneous with no defined result.
    const m = model(
      [{ name: 'headline', column: 'title' }, { name: 'title', column: 'subtitle' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    expect(exposure(m, 'v1')).toEqual([['subtitle', 'subtitle'], ['title', 'title']])
    expect(exposure(m, 'v2')).toEqual([['subtitle', 'title'], ['title', 'headline']])
  })

  it('gives the same model when the fields are declared in the opposite order', () => {
    // The falsifiable half. Two orderings of the same declarations must give
    // identical models — that is what "no ordering dependence" means, and it
    // is the property the derived model lacked.
    const a = model(
      [{ name: 'headline', column: 'title' }, { name: 'title', column: 'subtitle' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    const b = model(
      [{ name: 'title', column: 'subtitle' }, { name: 'headline', column: 'title' }],
      [{ name: 'title' }, { name: 'subtitle' }]
    )
    expect(exposure(a, 'v1')).toEqual(exposure(b, 'v1'))
    expect(exposure(a, 'v2')).toEqual(exposure(b, 'v2'))
  })
})

describe('a swap', () => {
  it('resolves with no ordering dependence', () => {
    // v1:      a, b
    // current: b (column a), a (column b) — the two names exchanged.
    const m = model(
      [{ name: 'b', column: 'a' }, { name: 'a', column: 'b' }],
      [{ name: 'a' }, { name: 'b' }]
    )
    expect(exposure(m, 'v1')).toEqual([['a', 'a'], ['b', 'b']])
    expect(exposure(m, 'v2')).toEqual([['a', 'b'], ['b', 'a']])
  })
})

describe('a chain', () => {
  it('self-collapses — renaming twice leaves one declaration', () => {
    // a → b → c over two version cycles. There is no chain to fold: you edit
    // the same field's `name` each time, and its `column` never moves. What
    // the author ends up holding is `{ name: 'c', column: 'a' }`.
    const m = model(
      [{ name: 'c', column: 'a' }],
      [{ name: 'a' }]
    )
    expect(exposure(m, 'v1')).toEqual([['a', 'a']])
    expect(exposure(m, 'v2')).toEqual([['a', 'c']])
  })
})

describe('the zero-config case', () => {
  it('yields one live version, an identity projection, and a union equal to current', () => {
    const current = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }, { name: 'body', type: 'text/rich' }])])
    const result = computeVersionModel({ current, snapshots: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.current).toBe('v1')
    expect(result.value.live).toEqual(['v1'])
    expect(result.value.union).toBe(current)
    // Identity: every column exposed under its own name, no fallbacks.
    expect(result.value.projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'title', exposed_as: 'title' },
      { column_name: 'body', exposed_as: 'body' },
    ])
  })
})
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/rename-shapes.test.ts`
Expected: PASS, all 5.

These should pass with **no production change** — they assert a property the design already has. If one fails, do not adjust the test to match: a failure here means the implementation did not actually achieve the redesign's purpose, and the bug is upstream in Tasks 5 or 6.

- [ ] **Step 3: Rewrite the versioning glossary**

In `packages/core/CONTEXT.md`, in the `### Versioning` section:

1. Delete the `>` blockquote notice added when the design was written — it says the glossary describes the superseded derived model, which is no longer true.
2. Delete the **pending.json / history.json** and **Declared drop** entries. Both concepts are gone.
3. Rewrite these entries, keeping the file's existing format (bold term, description, `_Avoid_:` line):
   - **Live version** — drop the clause about a `pending.json` rename making current's projection diverge. Current's projection is now the identity over the union whenever no field declares a `column`.
   - **Cut** — `version:cut` copies the schema folders into `versions/vN/` and bumps. There is **no sealing step**: nothing is appended anywhere, because renames and retention live on the fields.
   - **Snapshot** — unchanged except its last sentence: retirement now deletes the directory outright *and* the author deletes the matching tombstones, which `ORPHANED_TOMBSTONE` requires. Nothing is "never pruned" any more.
   - **Union registry** — the current registry itself, tombstones included. No merging, no column correction, no retention boundary.
   - **Projection** — a read of one version's own schema files.
   - **Fallback** — declared on current's tombstone, consumed by the older versions' projections, keyed by column.
4. Add these entries:
   - **Declared column** — `column` on a field: its storage column, defaulting to `name`. Renaming a field means changing `name` and pinning `column`; the data never moves.
   - **Tombstone** — a field marked `removed: true`. Its column is retained for older live versions and this version does not expose it. Included in db codegen, excluded from projections, the api and the admin panel.

- [ ] **Step 4: Verify the whole package**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Run: `pnpm --filter @bobbykim/manguito-cms-core lint`
Run: `pnpm --filter @bobbykim/manguito-cms-core build`
Expected: all three clean.

Then verify nothing else in the monorepo broke — `packages/db` imports from core:

Run: `pnpm test && pnpm build`
Expected: clean. If `packages/db` fails, the cause is the `ParsedField` change; it should be additive-and-optional, so a failure means Task 2 set a key it should have omitted.

- [ ] **Step 5: Commit**

```bash
git add -A packages/core
git commit -m "test(core): pin shift, swap and chain; rewrite the versioning glossary"
```

---

## Residuals

Recorded, not done here:

- **Core needs a changeset and a release** before any package imports `loadVersionModel`. This plan removes two exported types and four error codes, so it is a breaking change to core's surface.
- **The api must exclude tombstones** from its current-version exposure, and the **admin** from both its runtime forms and `generateFormComponent`. Neither is reachable until versioning is usable (2c/2d), but whichever sub-project first makes tombstones reachable owns this — see the cross-package table in the design doc.
- **`VersionModel.current` is derived, never persisted.** Unchanged from 2a; still worth revisiting when 2c writes the cut.
- **Snapshot cross-reference validation** is deliberately skipped in `loadSnapshot`. Unchanged from 2a.

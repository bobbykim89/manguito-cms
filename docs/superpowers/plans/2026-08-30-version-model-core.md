# Version Model in Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `packages/core/src/versions/` submodule that computes the schema-versioning model — live versions, a union registry, and per-version projections — from frozen snapshots and a rename history.

**Architecture:** A derived layer above the parser, not inside it. `parseSchemas` is untouched and still returns one registry; the version model is computed from `(schemaConfig, currentRegistry)`. Split into a pure core (`computeVersionModel`, every rule, testable on in-memory objects) and a thin IO shell (`loadVersionModel`, reads files) — the same seam the parser already uses between `walkSchemaDirectory` and `parseSchemas`.

**Tech Stack:** TypeScript strict mode, Node 22+, Vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-30-version-model-core-design.md](../specs/2026-08-30-version-model-core-design.md)

## Global Constraints

- **Branch:** work on `feat/version-model-core`. NEVER commit to `master`.
- **`packages/core` only.** Nothing in `db`, `api`, `admin`, or `cli`.
- **Merges inert.** Nothing imports this module yet, so every existing test must pass untouched. Baseline: **core 152 passed + 2 todo (154), 11/11 turbo tasks, `pnpm build` 7/7.**
- **Do not alter any existing test's assertions.**
- **Running tests:** `pnpm --filter @bobbykim/manguito-cms-core test [relative/path]`, paths relative to `packages/core/`. Core has no database dependency, so no Postgres is needed for this plan.
- **No new dependencies.** Nothing here clears the [ADR core/0006](../../adr/core/0006-core-shared-kernel-dependencies.md) bar (current set: zod, yaml, bcryptjs).
- **Parser output must be plain serializable objects** — no class instances ([ADR core/0002](../../adr/core/0002-serializable-parser-output.md)).
- **Internal failures use `Result<T>`**, never exceptions. `Result<T> = { ok: true; value: T } | { ok: false; errors: ParseError[] }`, and `ParseError = { file, code, message, path? }` — both already in `packages/core/src/parser/loader.ts`.
- **Collect all errors, never stop at the first** — matches `walkSchemaDirectory`.
- Factory functions over classes; named function declarations for top-level exports.
- Test imports omit the file extension; source imports include `.js`.
- Conventional commits, `type(scope): subject`. Scope is `core`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/versions/types.ts` | All public types: `PendingChanges`, `VersionHistory`, `VersionProjection`, `VersionModel`, `VersionSnapshot`. |
| `packages/core/src/versions/fold.ts` | The rename fold and its chain validation. The one place a label becomes a column. |
| `packages/core/src/versions/union.ts` | Union registry construction and nullability relaxation. |
| `packages/core/src/versions/projections.ts` | Per-version projection construction. |
| `packages/core/src/versions/validate.ts` | Ambiguity, unrenameable kinds, type changes. |
| `packages/core/src/versions/compute.ts` | `computeVersionModel` — orchestrates the four above, collecting errors. |
| `packages/core/src/versions/load.ts` | `loadVersionModel` — the IO shell: discover snapshots, read JSON, parse snapshots. |
| `packages/core/src/versions/__tests__/fixtures.ts` | Shared registry builders for every test below. |
| `packages/core/src/parser/loader.ts` | Five new `ParseErrorCode` members. |
| `packages/core/src/index.ts` | Public exports. |

Eight tasks. 1 lays the types and fixtures; 2–5 are the four pure rules, each independently testable; 6 orchestrates; 7 adds IO and exports; 8 documents.

**Two decisions the spec does not state, settled here:**

1. **Snapshots are assembled with the CURRENT registry's `routes` and `roles`.** `buildSchemaRegistry(parsedSchemas, parsedRoutes, parsedRoles)` requires all three, but roles and routes are not versioned — a snapshot directory contains only type folders. Passing current's is correct, not a shortcut.
2. **Snapshots are NOT re-run through `validateCrossReferences`.** A snapshot is a frozen artifact that was validated when cut. Re-validating it against *current's* `routes.json` would emit `UNKNOWN_BASE_PATH` the moment someone removes a base path — a false failure on untouched history. Only `parseSchema` failures become `VERSION_SNAPSHOT_INVALID`.

---

### Task 1: Types, error codes, and shared test fixtures

**Files:**
- Create: `packages/core/src/versions/types.ts`
- Create: `packages/core/src/versions/__tests__/fixtures.ts`
- Modify: `packages/core/src/parser/loader.ts` (the `ParseErrorCode` union)
- Test: `packages/core/src/versions/__tests__/fixtures.test.ts`

**Interfaces:**
- Consumes: `SchemaRegistry`, `ParsedSchema`, `ParsedRoutes`, `ParsedRoles` from the parser; `parseSchema`, `buildSchemaRegistry`.
- Produces:
  - `type PendingChanges = { renames: Array<{ type: string; from: string; to: string }>; drops: string[]; fallbacks: Record<string, unknown> }`
  - `type VersionHistory = { renames: Array<{ after: string; type: string; from: string; to: string }>; drops: Array<{ after: string; field: string }>; fallbacks: Record<string, unknown> }`
  - `type VersionSnapshot = { version: string; registry: SchemaRegistry }`
  - `type VersionProjection = { version: string; types: Record<string, { fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }> }> }`
  - `type VersionModel = { current: string; live: string[]; union: SchemaRegistry; projections: Record<string, VersionProjection> }`
  - Fixtures: `makeRegistry(types)`, `EMPTY_HISTORY`, `EMPTY_PENDING`
  - Five new `ParseErrorCode` members.

- [ ] **Step 1: Add the error codes**

In `packages/core/src/parser/loader.ts`, append to the `ParseErrorCode` union, keeping the existing members in place and in order:

```ts
  | 'VERSION_SNAPSHOT_INVALID'
  | 'AMBIGUOUS_RENAME'
  | 'RENAME_CHAIN_BROKEN'
  | 'UNRENAMEABLE_FIELD_KIND'
  | 'FIELD_TYPE_CHANGED_WHILE_LIVE'
```

- [ ] **Step 2: Write the types**

Create `packages/core/src/versions/types.ts`:

```ts
import type { SchemaRegistry } from '../parser/validate.js'

// ─── Version model types ──────────────────────────────────────────────────────
//
// Schema versioning versions the CONTRACT, not the data: one canonical row per
// content item, with each live version applied as a projection at the API edge.
// This module computes what each live version exposes and which column backs it.
//
// A field has a public LABEL (`ParsedField.name`) and a storage KEY
// (`db_column.column_name`). They are identical for every schema the parser
// currently produces; a rename makes them diverge, and the fold in fold.ts is
// what recovers the column from a label.

/** `schemas/versions/pending.json` — HAND-WRITTEN. Declarations since the last cut. */
export type PendingChanges = {
  /** `from`/`to` are LABELS as they appear in the schema files, never columns. */
  renames: Array<{ type: string; from: string; to: string }>
  /** `"<type>.<label>"` — confirms a removal is intentional, not an undeclared rename. */
  drops: string[]
  /** `"<type>.<column_name>"` → the value served when a retained column is null. */
  fallbacks: Record<string, unknown>
}

/** `schemas/versions/history.json` — MACHINE-WRITTEN by `version:cut`. Append-only, never pruned. */
export type VersionHistory = {
  /** `after` names the version this rename followed, e.g. 'v1'. */
  renames: Array<{ after: string; type: string; from: string; to: string }>
  drops: Array<{ after: string; field: string }>
  fallbacks: Record<string, unknown>
}

/** A frozen snapshot, parsed. */
export type VersionSnapshot = {
  version: string
  registry: SchemaRegistry
}

/** What one live version exposes. A type absent from `types` is not exposed by it. */
export type VersionProjection = {
  version: string
  types: Record<string, {
    fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }>
  }>
}

export type VersionModel = {
  /** e.g. 'v2' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /** Every live version's fields merged; feeds db codegen and drift detection. */
  union: SchemaRegistry
  /** Keyed by version name; includes current (an identity projection). */
  projections: Record<string, VersionProjection>
}
```

- [ ] **Step 3: Write the shared fixtures**

Create `packages/core/src/versions/__tests__/fixtures.ts`. Build registries through `parseSchema` rather than hand-writing `ParsedField`s, matching `packages/core/src/parser/__tests__/validate.test.ts`:

```ts
import { parseSchema } from '../../parser/parseSchema'
import { buildSchemaRegistry } from '../../parser/validate'
import type { ParsedSchema, ParsedRoutes, ParsedRoles, SchemaRegistry } from '../../parser/validate'
import type { PendingChanges, VersionHistory } from '../types'

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

export const EMPTY_HISTORY: VersionHistory = { renames: [], drops: [], fallbacks: {} }
export const EMPTY_PENDING: PendingChanges = { renames: [], drops: [], fallbacks: {} }

export type FieldSpec = { name: string; type?: string; required?: boolean }

/**
 * A content type whose fields are plain text unless `type` says otherwise.
 * Goes through parseSchema, so every field gets a real db_column with
 * column_name === name — the pre-divergence state. Divergence is never
 * hand-written: a snapshot uses the OLD label, a rename is declared, and the
 * fold derives the column.
 */
export function makeContentType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'x',
      only_one: false,
      fields: fields.map((f) => ({
        name: f.name,
        label: f.name,
        type: f.type ?? 'text/plain',
        required: f.required ?? false,
      })),
    },
    'content-type',
    `schemas/content-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

/** Same, as a taxonomy type — Task 3's union must treat both maps identically. */
export function makeTaxonomyType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'taxonomy-type',
      fields: fields.map((f) => ({
        name: f.name,
        label: f.name,
        type: f.type ?? 'text/plain',
        required: f.required ?? false,
      })),
    },
    'taxonomy-type',
    `schemas/taxonomy-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

export function makeRegistry(schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, EMPTY_ROUTES, EMPTY_ROLES)
}
```

> A taxonomy type's required properties differ from a content type's — it has no `default_base_path` or `only_one`. Read `packages/core/src/parser/parseSchema.ts` and match what the taxonomy branch actually requires rather than copying the content-type shape.

Task 5 also needs a paragraph field, whose `db_column` must be genuinely `null`. Extend `FieldSpec` with an optional `ref` and emit a paragraph field when `type: 'paragraph'`:

```ts
export type FieldSpec = { name: string; type?: string; required?: boolean; ref?: string; rel?: string }
```

and inside both builders' `fields.map`, emit `{ name, label, type: 'paragraph', ref: f.ref, rel: f.rel ?? 'one-to-many', required }` when `f.type === 'paragraph'`. The field must come from `parseSchema` so its `db_column` is `null` by construction, not hand-forced.

> `parseSchema`'s exact parameter order and success shape (`result.schema` vs `result.value`) must match the real signature at `packages/core/src/parser/parseSchema.ts:459`. Read it and adapt — the shape above follows `dev.ts`'s `parseSchema(file.raw, file.schema_type, file.path)` and `parseResult.schema`, but verify rather than assume.

- [ ] **Step 4: Write the fixture smoke test**

Create `packages/core/src/versions/__tests__/fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeContentType, makeRegistry } from './fixtures'

describe('version test fixtures', () => {
  it('builds a registry whose fields carry real db_columns', () => {
    const reg = makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])])
    const field = reg.content_types['content--post']!.fields[0]!
    expect(field.name).toBe('blog_title')
    expect(field.db_column?.column_name).toBe('blog_title')
  })

  it('honours required', () => {
    const reg = makeRegistry([
      makeContentType('content--post', [{ name: 'a', required: true }, { name: 'b' }]),
    ])
    const [a, b] = reg.content_types['content--post']!.fields
    expect(a!.db_column?.nullable).toBe(false)
    expect(b!.db_column?.nullable).toBe(true)
  })
})
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/fixtures.test.ts`
Expected: PASS. If `parseSchema`'s real shape differs from the fixture's assumption, this is where you find out — fix the fixture, not the test.

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS at the 154 baseline plus your 2 new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/versions packages/core/src/parser/loader.ts
git commit -m "feat(core): add version model types and error codes"
```

---

### Task 2: The rename fold

**Files:**
- Create: `packages/core/src/versions/fold.ts`
- Test: `packages/core/src/versions/__tests__/fold.test.ts`

**Interfaces:**
- Consumes: `VersionHistory`, `PendingChanges` (Task 1); `ParseError` from `../parser/loader.js`.
- Produces:
  - `function versionsOlderThan(version: string, live: string[]): string[]`
  - `function columnOf(input: { label: string; type: string; version: string; live: string[]; history: VersionHistory; pending: PendingChanges; current: string }): string`
  - `function validateRenameChain(input: { history: VersionHistory; pending: PendingChanges; snapshots: VersionSnapshot[]; current: SchemaRegistry; currentVersion: string }): ParseError[]`

**This is the one place an error would be silent rather than loud.** Everything else in the module fails visibly; a wrong fold produces a plausible-looking column and, downstream, a migration that renames real columns out from under real data. Write the retired-version test first.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/fold.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { columnOf } from '../fold'
import { EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'
import type { VersionHistory } from '../types'

const LIVE = ['v1', 'v2', 'v3']

describe('columnOf', () => {
  it('is identity when nothing was renamed', () => {
    expect(
      columnOf({
        label: 'blog_title', type: 'content--post', version: 'v3',
        live: LIVE, history: EMPTY_HISTORY, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('folds a single rename back to the original column', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    // v2 sees 'title'; its column is the pre-rename label.
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v2',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('folds twice to the EARLIEST label, not the intermediate one', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
      ],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })

  it('does not apply a rename that came after the version being folded', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v2', type: 'content--post', from: 'title', to: 'headline' }],
      drops: [], fallbacks: {},
    }
    // v2's own label is 'title' — the after-v2 rename must not touch it.
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v2',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('title')
  })

  it('includes pending renames when folding the current version', () => {
    const pending = {
      renames: [{ type: 'content--post', from: 'title', to: 'headline' }],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: LIVE, history: EMPTY_HISTORY, pending, current: 'v3',
      })
    ).toBe('title')
  })

  it('ignores renames belonging to a different type', () => {
    const history: VersionHistory = {
      renames: [{ after: 'v1', type: 'content--other', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    expect(
      columnOf({
        label: 'title', type: 'content--post', version: 'v3',
        live: LIVE, history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('title')
  })

  // THE regression test for the retirement bug. v1 is retired — its directory is
  // gone and it is no longer live — but history retains the rename that happened
  // after it, so the column must still resolve to the original.
  it('resolves through a RETIRED version’s rename', () => {
    const history: VersionHistory = {
      renames: [
        { after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' },
        { after: 'v2', type: 'content--post', from: 'title', to: 'headline' },
      ],
      drops: [], fallbacks: {},
    }
    // v1 has been retired: live is now v2 and v3 only.
    expect(
      columnOf({
        label: 'headline', type: 'content--post', version: 'v3',
        live: ['v2', 'v3'], history, pending: EMPTY_PENDING, current: 'v3',
      })
    ).toBe('blog_title')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/fold.test.ts`
Expected: FAIL — `Failed to resolve import "../fold"`.

- [ ] **Step 3: Implement the fold**

Create `packages/core/src/versions/fold.ts`:

```ts
import type { ParseError } from '../parser/loader.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import type { SchemaRegistry } from '../parser/validate.js'

// ─── The rename fold ──────────────────────────────────────────────────────────
//
// A field's COLUMN is its label in the earliest version that ever contained it.
// A rename tagged `after: vJ` happened between vJ and vJ+1, so a version vK's
// labels reflect every rename tagged after vJ for all J < K. To recover the
// column behind a label in vK, apply the reverse of exactly those renames,
// newest first.
//
// The comparison is on the version's NUMBER, not on membership in `live` —
// history is never pruned, so a rename tagged after a RETIRED version must
// still apply. Filtering by `live` here would silently produce wrong columns
// for every field renamed during a retired version's life.

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? -1 : n
}

/** Renames that shaped `version`'s labels: those tagged after any OLDER version. */
function renamesBefore(
  version: string,
  history: VersionHistory,
  type: string
): Array<{ from: string; to: string }> {
  const target = versionNumber(version)
  return history.renames
    .filter((r) => r.type === type && versionNumber(r.after) < target)
    .map((r) => ({ from: r.from, to: r.to }))
}

export function columnOf(input: {
  label: string
  type: string
  version: string
  live: string[]
  history: VersionHistory
  pending: PendingChanges
  current: string
}): string {
  const { label, type, version, history, pending, current } = input

  const applied = renamesBefore(version, history, type)

  // pending.json is implicitly tagged "after the newest cut", so it shaped the
  // current version's labels and no earlier one's.
  if (version === current) {
    applied.push(...pending.renames.filter((r) => r.type === type).map((r) => ({ from: r.from, to: r.to })))
  }

  // Unwind newest first: each step maps a later label back to its earlier one.
  let out = label
  for (let i = applied.length - 1; i >= 0; i--) {
    if (applied[i]!.to === out) out = applied[i]!.from
  }
  return out
}
```

`versionsOlderThan` and `validateRenameChain` are added in Steps 5–7; leave them out for now so this step stays one action.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/fold.test.ts`
Expected: PASS — all seven cases, including the retired-version one.

- [ ] **Step 5: Write the failing chain-validation test**

Append to `packages/core/src/versions/__tests__/fold.test.ts`:

```ts
import { validateRenameChain } from '../fold'
import { makeContentType, makeRegistry } from './fixtures'

describe('validateRenameChain', () => {
  it('accepts a rename whose `from` exists in the version it followed', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots,
      current,
      currentVersion: 'v2',
    })
    expect(errors).toEqual([])
  })

  it('reports RENAME_CHAIN_BROKEN when `from` matches no known label', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'nonexistent', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots,
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
    expect(errors[0]!.message).toContain('nonexistent')
  })

  it('reports a rename naming a type that does not exist', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [{ after: 'v1', type: 'content--ghost', from: 'a', to: 'b' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('RENAME_CHAIN_BROKEN')
  })

  it('collects every broken entry rather than stopping at the first', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const errors = validateRenameChain({
      history: {
        renames: [
          { after: 'v1', type: 'content--ghost', from: 'a', to: 'b' },
          { after: 'v1', type: 'content--post', from: 'nope', to: 'title' },
        ],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
      snapshots: [],
      current,
      currentVersion: 'v2',
    })
    expect(errors).toHaveLength(2)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/fold.test.ts -t 'validateRenameChain'`
Expected: FAIL — `validateRenameChain` is not exported.

- [ ] **Step 7: Implement chain validation**

Append to `packages/core/src/versions/fold.ts`:

```ts
/** Every label a registry's type exposes, for chain checking. */
function labelsOf(registry: SchemaRegistry, type: string): Set<string> | null {
  const schema = registry.schemas[type]
  if (!schema || !('fields' in schema)) return null
  return new Set((schema.fields as Array<{ name: string }>).map((f) => f.name))
}

/**
 * A rename's `from` must name a label that actually existed. Checking it here
 * turns a misfiled pending entry — or a hand-edited history — into a loud
 * failure rather than a column that silently resolves to the wrong name.
 */
export function validateRenameChain(input: {
  history: VersionHistory
  pending: PendingChanges
  snapshots: VersionSnapshot[]
  current: SchemaRegistry
  currentVersion: string
}): ParseError[] {
  const { history, pending, snapshots, current, currentVersion } = input
  const errors: ParseError[] = []

  // Every label any live version has ever exposed for a type, plus every `to`
  // a rename produced — a chain step may legitimately reference a label that
  // only ever existed between two cuts.
  const known = new Map<string, Set<string>>()
  const add = (type: string, label: string): void => {
    if (!known.has(type)) known.set(type, new Set())
    known.get(type)!.add(label)
  }

  for (const snap of snapshots) {
    for (const type of Object.keys(snap.registry.schemas)) {
      for (const l of labelsOf(snap.registry, type) ?? []) add(type, l)
    }
  }
  for (const type of Object.keys(current.schemas)) {
    for (const l of labelsOf(current, type) ?? []) add(type, l)
  }
  for (const r of history.renames) add(r.type, r.to)
  for (const r of pending.renames) add(r.type, r.to)

  const check = (
    entry: { type: string; from: string; to: string },
    file: string,
    after: string
  ): void => {
    const labels = known.get(entry.type)
    if (!labels) {
      errors.push({
        file,
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename after ${after} names type "${entry.type}", which no live version defines. ` +
          `Remove the entry, or restore the type.`,
      })
      return
    }
    if (!labels.has(entry.from)) {
      errors.push({
        file,
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename after ${after} maps "${entry.from}" → "${entry.to}" on "${entry.type}", ` +
          `but no version ever exposed a field named "${entry.from}". ` +
          `Check for a typo, or remove the entry.`,
      })
    }
  }

  for (const r of history.renames) check(r, 'schemas/versions/history.json', r.after)
  for (const r of pending.renames) check(r, 'schemas/versions/pending.json', currentVersion)

  return errors
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/fold.test.ts`
Expected: PASS — all eleven cases.

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/versions
git commit -m "feat(core): add the rename fold and chain validation"
```

---

### Task 3: The union registry

**Files:**
- Create: `packages/core/src/versions/union.ts`
- Test: `packages/core/src/versions/__tests__/union.test.ts`

**Interfaces:**
- Consumes: `columnOf` (Task 2); `VersionSnapshot`, `VersionHistory`, `PendingChanges` (Task 1).
- Produces: `function buildUnionRegistry(input: { current: SchemaRegistry; currentVersion: string; snapshots: VersionSnapshot[]; live: string[]; history: VersionHistory; pending: PendingChanges }): SchemaRegistry`

The union is an ordinary `SchemaRegistry` — no new type and no annotation. It differs from a plain merge in exactly one way: **a column no longer in current is forced nullable**, because rows created after the drop cannot populate it.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/union.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildUnionRegistry } from '../union'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

function fieldsOf(reg: ReturnType<typeof makeRegistry>, type: string) {
  return reg.content_types[type]!.fields
}

describe('buildUnionRegistry', () => {
  it('equals current field-for-field when nothing was dropped', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(fieldsOf(union, 'content--post').map((f) => f.name)).toEqual(['a', 'b'])
  })

  it('retains a column an older version exposes that current dropped', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    const names = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(names).toContain('gone')
  })

  it('forces a retained column nullable even if it was required', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--post', [{ name: 'a' }, { name: 'gone', required: true }]),
      ]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    const retained = fieldsOf(union, 'content--post').find((f) => f.db_column?.column_name === 'gone')!
    expect(retained.db_column?.nullable).toBe(true)
  })

  it('leaves a field still in current with its own required', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a', required: true }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(fieldsOf(union, 'content--post')[0]!.db_column?.nullable).toBe(false)
  })

  it('does not duplicate a renamed field — one column, current’s label', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const union = buildUnionRegistry({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    const cols = fieldsOf(union, 'content--post').map((f) => f.db_column?.column_name)
    expect(cols).toEqual(['blog_title'])
  })
})
```

That last case is the one that proves the union keys by **column**, not label: a renamed field must appear once, under its original column, not twice.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/union.test.ts`
Expected: FAIL — `Failed to resolve import "../union"`.

- [ ] **Step 3: Implement it**

Create `packages/core/src/versions/union.ts`. Key points: iterate current first so its ordering wins; key by column via `columnOf`; add retained columns from older snapshots; force retained columns nullable. Field objects are plain data, so build new objects rather than mutating the parsed ones — the current registry is shared with every other consumer and must not be altered.

```ts
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'

// Only column-backed fields participate. Paragraph fields have no column, and
// many-to-many references have none either (the junction table owns the
// association) — both keep the label as their identity.
// Exported: Task 4's projections use the same predicate and must not redeclare it.
export function isColumnBacked(field: ParsedField): boolean {
  const col = field.db_column
  return col !== null && col.column_name !== '' && !col.junction
}

/**
 * Every live version's fields merged, keyed by COLUMN. A column current no
 * longer exposes is retained and forced nullable: rows created after the drop
 * cannot populate it, so a NOT NULL would be unsatisfiable.
 */
export function buildUnionRegistry(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): SchemaRegistry {
  const { current, currentVersion, snapshots, live, history, pending } = input
  if (snapshots.length === 0) return current

  const union: SchemaRegistry = {
    ...current,
    content_types: { ...current.content_types },
    taxonomy_types: { ...current.taxonomy_types },
  }

  for (const [typeName, type] of Object.entries(current.content_types)) {
    const seen = new Set<string>()
    const fields: ParsedField[] = []

    for (const f of type.fields) {
      if (isColumnBacked(f)) {
        seen.add(columnOf({
          label: f.name, type: typeName, version: currentVersion,
          live, history, pending, current: currentVersion,
        }))
      }
      fields.push(f)
    }

    for (const snap of snapshots) {
      const snapType = snap.registry.content_types[typeName]
      if (!snapType) continue
      for (const f of snapType.fields) {
        if (!isColumnBacked(f)) continue
        const col = columnOf({
          label: f.name, type: typeName, version: snap.version,
          live, history, pending, current: currentVersion,
        })
        if (seen.has(col)) continue
        seen.add(col)
        // Retained: present in an older version, absent from current.
        fields.push({
          ...f,
          db_column: { ...f.db_column!, column_name: col, nullable: true },
        })
      }
    }

    union.content_types[typeName] = { ...type, fields }
  }

  return union
}
```

> Taxonomy types need the identical treatment. Rather than duplicating the loop verbatim — which the review rubric treats as a defect — extract the per-type-map body into a local helper and call it for `content_types` and `taxonomy_types`. Paragraph types have no versioned columns of their own here and are left as-is.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/union.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Add a taxonomy test**

Without this, the helper extraction above is untested for half its callers. Append to `packages/core/src/versions/__tests__/union.test.ts`:

```ts
import { makeTaxonomyType } from './fixtures'

it('retains and relaxes a dropped taxonomy column too', () => {
  const snapshots = [{
    version: 'v1',
    registry: makeRegistry([
      makeTaxonomyType('taxonomy--tag', [{ name: 'a' }, { name: 'gone', required: true }]),
    ]),
  }]
  const current = makeRegistry([makeTaxonomyType('taxonomy--tag', [{ name: 'a' }])])
  const union = buildUnionRegistry({
    current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
    history: EMPTY_HISTORY, pending: EMPTY_PENDING,
  })
  const retained = union.taxonomy_types['taxonomy--tag']!.fields
    .find((f) => f.db_column?.column_name === 'gone')!
  expect(retained).toBeDefined()
  expect(retained.db_column?.nullable).toBe(true)
})
```

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/versions
git commit -m "feat(core): build the union registry from live versions"
```

---

### Task 4: Projections

**Files:**
- Create: `packages/core/src/versions/projections.ts`
- Test: `packages/core/src/versions/__tests__/projections.test.ts`

**Interfaces:**
- Consumes: `columnOf` (Task 2); `VersionProjection`, `VersionSnapshot`, `VersionHistory`, `PendingChanges` (Task 1).
- Produces: `function buildProjections(input: { current: SchemaRegistry; currentVersion: string; snapshots: VersionSnapshot[]; live: string[]; history: VersionHistory; pending: PendingChanges }): Record<string, VersionProjection>`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/projections.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProjections } from '../projections'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

describe('buildProjections', () => {
  it('gives current an identity projection', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
    const p = buildProjections({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
      { column_name: 'b', exposed_as: 'b' },
    ])
  })

  it('exposes a renamed field under its OLD label in the old version', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const history = {
      renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ])
    expect(p['v2']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title' },
    ])
  })

  it('attaches a fallback to the right column', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: { renames: [], drops: [], fallbacks: { 'content--post.gone': '' } },
      pending: EMPTY_PENDING,
    })
    const gone = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')!
    expect(gone.fallback).toBe('')
  })

  it('omits a type a version does not define', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--old', [{ name: 'a' }])]),
    }]
    const current = makeRegistry([makeContentType('content--new', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--new']).toBeUndefined()
    expect(p['v2']!.types['content--old']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/projections.test.ts`
Expected: FAIL — `Failed to resolve import "../projections"`.

- [ ] **Step 3: Implement it**

Create `packages/core/src/versions/projections.ts`:

```ts
import type { SchemaRegistry } from '../parser/validate.js'
import type { PendingChanges, VersionHistory, VersionProjection, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'
import { isColumnBacked } from './union.js'

// What each live version exposes: per type, each column and the label THAT
// version exposes it under. The current version's projection is the identity,
// which is why the api layer needs no special case for unversioned projects.
export function buildProjections(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): Record<string, VersionProjection> {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const byVersion: Array<{ version: string; registry: SchemaRegistry }> = [
    ...snapshots,
    { version: currentVersion, registry: current },
  ]

  const out: Record<string, VersionProjection> = {}

  for (const { version, registry } of byVersion) {
    const types: VersionProjection['types'] = {}

    for (const [typeName, type] of [
      ...Object.entries(registry.content_types),
      ...Object.entries(registry.taxonomy_types),
    ]) {
      const fields = type.fields.filter(isColumnBacked).map((f) => {
        const column_name = columnOf({
          label: f.name, type: typeName, version,
          live, history, pending, current: currentVersion,
        })
        const fallback = history.fallbacks[`${typeName}.${column_name}`]
        // `fallback` is omitted entirely rather than set undefined, so the
        // identity case deep-equals cleanly in tests and over the wire.
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

Note `columnOf` takes a single object, not positional arguments — its signature is pinned in Task 2's Produces block.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/projections.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/versions
git commit -m "feat(core): build per-version projections"
```

---

### Task 5: Validation

**Files:**
- Create: `packages/core/src/versions/validate.ts`
- Test: `packages/core/src/versions/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `columnOf` (Task 2); the types from Task 1.
- Produces: `function validateVersionModel(input: { current: SchemaRegistry; currentVersion: string; snapshots: VersionSnapshot[]; live: string[]; history: VersionHistory; pending: PendingChanges }): ParseError[]`

Three checks, all collecting rather than short-circuiting.

**`AMBIGUOUS_RENAME` fires only when all three hold:** a label present in some live version is absent from current; no rename chain maps it forward; and a field of the **same `field_type`** appeared in that type. Drop the third condition and every ordinary field removal becomes a build error. **The negative cases matter more than the positive one** — a false positive blocks routine work.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateVersionModel } from '../validate'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

function withV1(v1Fields: Parameters<typeof makeContentType>[1], currentFields: Parameters<typeof makeContentType>[1]) {
  return {
    snapshots: [{ version: 'v1', registry: makeRegistry([makeContentType('content--post', v1Fields)]) }],
    current: makeRegistry([makeContentType('content--post', currentFields)]),
    currentVersion: 'v2',
    live: ['v1', 'v2'],
  }
}

describe('AMBIGUOUS_RENAME', () => {
  it('fires on drop + same-typed add with no declaration', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('AMBIGUOUS_RENAME')
    expect(errors[0]!.message).toContain('blog_title')
    expect(errors[0]!.message).toContain('title')
  })

  it('does NOT fire when a rename declares it', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire when a drop confirms it', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: {
        renames: [], drops: [{ after: 'v1', field: 'content--post.blog_title' }], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire when the added field is a DIFFERENT type', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'count', type: 'integer' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('does NOT fire on a plain removal with nothing added', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'a' }, { name: 'gone' }], [{ name: 'a' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors).toEqual([])
  })

  it('accepts a drop declared in pending, not only history', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'blog_title' }], [{ name: 'title' }]),
      history: EMPTY_HISTORY,
      pending: { renames: [], drops: ['content--post.blog_title'], fallbacks: {} },
    })
    expect(errors).toEqual([])
  })
})

describe('FIELD_TYPE_CHANGED_WHILE_LIVE', () => {
  it('fires when a column a live version exposes changed type', () => {
    const errors = validateVersionModel({
      ...withV1([{ name: 'a', type: 'text/plain' }], [{ name: 'a', type: 'integer' }]),
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('FIELD_TYPE_CHANGED_WHILE_LIVE')
  })
})

describe('UNRENAMEABLE_FIELD_KIND', () => {
  it('fires when a rename names a paragraph field', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const errors = validateVersionModel({
      snapshots, current, currentVersion: 'v2', live: ['v1', 'v2'],
      history: {
        renames: [{ after: 'v1', type: 'content--post', from: 'cards', to: 'blocks' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(errors.map((e) => e.code)).toContain('UNRENAMEABLE_FIELD_KIND')
  })
})
```

> The paragraph case needs a fixture with a real paragraph field. `makeContentType` only builds plain-text fields, so extend it — add an optional `ref` to `FieldSpec` and emit a `paragraph` field when `type: 'paragraph'` — or add a `makeContentTypeWithParagraph` helper beside it. Whichever you choose, the field must come from `parseSchema` so its `db_column` is genuinely `null`, not hand-forced.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/validate.test.ts`
Expected: FAIL — `Failed to resolve import "../validate"`.

- [ ] **Step 3: Implement it**

Create `packages/core/src/versions/validate.ts` with the three checks. The `AMBIGUOUS_RENAME` message must be actionable — name the file, the type, both candidate labels, and both concrete resolutions:

```ts
        message:
          `Field "${oldLabel}" on "${typeName}" is exposed by ${version} but is gone from the ` +
          `current schema, and a new ${fieldType} field "${newLabel}" appeared. This is either a ` +
          `rename or a removal, and the two cannot be told apart.\n` +
          `  If it was renamed, add to schemas/versions/pending.json:\n` +
          `    { "type": "${typeName}", "from": "${oldLabel}", "to": "${newLabel}" }  (under "renames")\n` +
          `  If it was removed, add to schemas/versions/pending.json:\n` +
          `    "${typeName}.${oldLabel}"  (under "drops")`,
```

A fallback declared for a column no live version exposes is **not** an error — it is inert, and going inert is the normal end of a fallback's life. Do not add a check for it.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/validate.test.ts`
Expected: PASS — all eight cases.

- [ ] **Step 5: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/versions
git commit -m "feat(core): validate renames, drops and type changes across versions"
```

---

### Task 6: `computeVersionModel`

**Files:**
- Create: `packages/core/src/versions/compute.ts`
- Test: `packages/core/src/versions/__tests__/compute.test.ts`

**Interfaces:**
- Consumes: `buildUnionRegistry` (Task 3), `buildProjections` (Task 4), `validateVersionModel` (Task 5), `validateRenameChain` (Task 2).
- Produces:

```ts
export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]   // oldest first
  history: VersionHistory
  pending: PendingChanges
}): Result<VersionModel>
```

Version identity is derived here: `current = v{N+1}` where N is the highest snapshot number, or `v1` when there are no snapshots. `live` is every snapshot version plus current, oldest first.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/compute.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

describe('computeVersionModel', () => {
  it('derives v1 and an identity model when there are no snapshots', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({
      current, snapshots: [], history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v1')
    expect(r.value.live).toEqual(['v1'])
    expect(r.value.union).toBe(current)
    expect(r.value.projections['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
    ])
  })

  it('derives the current version as one past the highest snapshot', () => {
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
      { version: 'v2', registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }])]) },
    ]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = computeVersionModel({ current, snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v3')
    expect(r.value.live).toEqual(['v1', 'v2', 'v3'])
  })

  it('returns collected errors rather than a value when validation fails', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = computeVersionModel({ current, snapshots, history: EMPTY_HISTORY, pending: EMPTY_PENDING })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('AMBIGUOUS_RENAME')
  })

  it('collects errors from BOTH chain validation and model validation', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = computeVersionModel({
      current, snapshots,
      history: {
        renames: [{ after: 'v1', type: 'content--ghost', from: 'a', to: 'b' }],
        drops: [], fallbacks: {},
      },
      pending: EMPTY_PENDING,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('RENAME_CHAIN_BROKEN')
    expect(codes).toContain('AMBIGUOUS_RENAME')
  })
})
```

That last case is the one that pins "collect all errors, never stop at the first" across module boundaries, not just within one check.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/compute.test.ts`
Expected: FAIL — `Failed to resolve import "../compute"`.

- [ ] **Step 3: Implement it**

Create `packages/core/src/versions/compute.ts`:

```ts
import type { Result } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { PendingChanges, VersionHistory, VersionModel, VersionSnapshot } from './types.js'
import { validateRenameChain } from './fold.js'
import { validateVersionModel } from './validate.js'
import { buildUnionRegistry } from './union.js'
import { buildProjections } from './projections.js'

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
  history: VersionHistory
  pending: PendingChanges
}): Result<VersionModel> {
  const { current, snapshots, history, pending } = input

  // Current is one past the highest cut; v1 when nothing has been cut.
  const highest = snapshots.reduce((max, s) => Math.max(max, versionNumber(s.version)), 0)
  const currentVersion = `v${highest + 1}`
  const live = [...snapshots.map((s) => s.version), currentVersion]

  // Validation runs BEFORE the union and projections are built: building them
  // on a model known to be invalid produces plausible-looking wrong output, and
  // the errors are what the caller acts on either way.
  const errors = [
    ...validateRenameChain({ history, pending, snapshots, current, currentVersion }),
    ...validateVersionModel({ current, currentVersion, snapshots, live, history, pending }),
  ]
  if (errors.length > 0) return { ok: false, errors }

  const shared = { current, currentVersion, snapshots, live, history, pending }
  return {
    ok: true,
    value: {
      current: currentVersion,
      live,
      union: buildUnionRegistry(shared),
      projections: buildProjections(shared),
    },
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/compute.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/versions
git commit -m "feat(core): assemble the version model"
```

---

### Task 7: `loadVersionModel` and public exports

**Files:**
- Create: `packages/core/src/versions/load.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/versions/__tests__/load.test.ts`

**Interfaces:**
- Consumes: `computeVersionModel` (Task 6); `walkSchemaDirectory`, `loadSchemaFile`, `parseSchema`, `buildSchemaRegistry` from the parser.
- Produces: `function loadVersionModel(config: ResolvedSchemaConfig, current: SchemaRegistry): Result<VersionModel>`, plus public exports of `loadVersionModel`, `computeVersionModel`, and every type from Task 1.

**Two rules from the plan header apply here and nowhere else:**

1. **Snapshots are assembled with the CURRENT registry's `routes` and `roles`.** `buildSchemaRegistry` requires all three, but roles and routes are not versioned — a snapshot directory contains only type folders. Pass `current.routes` and `current.roles`.
2. **Do NOT run `validateCrossReferences` on a snapshot.** A snapshot was validated when cut; re-validating it against current's `routes.json` would emit `UNKNOWN_BASE_PATH` the moment a base path is removed — a false failure on untouched history. Only `parseSchema` failures become `VERSION_SNAPSHOT_INVALID`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/versions/__tests__/load.test.ts`. This is the only test in the plan that touches the filesystem; use `fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-versions-'))` in `beforeEach` and remove it in `afterEach`.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadVersionModel } from '../load'
import { makeContentType, makeRegistry } from './fixtures'

let dir: string

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-versions-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function config() {
  return {
    base_path: dir,
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
    },
  }
}

describe('loadVersionModel', () => {
  it('returns a single-version identity model when versions/ is absent', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config() as never, current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v1')
    expect(r.value.live).toEqual(['v1'])
    expect(r.value.union).toBe(current)
  })

  it('discovers a snapshot directory and derives v2 as current', () => {
    const v1 = path.join(dir, 'versions', 'v1', 'content-types')
    fs.mkdirSync(v1, { recursive: true })
    fs.writeFileSync(
      path.join(v1, 'content--post.json'),
      JSON.stringify({
        name: 'content--post', label: 'Post', type: 'content-type',
        default_base_path: 'x', only_one: false,
        fields: [{ name: 'a', label: 'a', type: 'text/plain', required: false }],
      })
    )
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config() as never, current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v2')
    expect(r.value.live).toEqual(['v1', 'v2'])
  })

  it('reports VERSION_SNAPSHOT_INVALID for an unparseable snapshot file', () => {
    const v1 = path.join(dir, 'versions', 'v1', 'content-types')
    fs.mkdirSync(v1, { recursive: true })
    fs.writeFileSync(path.join(v1, 'content--post.json'), '{ not valid json')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config() as never, current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_SNAPSHOT_INVALID')
  })

  it('reads pending.json and history.json when present', () => {
    fs.mkdirSync(path.join(dir, 'versions'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'versions', 'pending.json'),
      JSON.stringify({ renames: [], drops: [], fallbacks: { 'content--post.a': 'x' } })
    )
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config() as never, current)
    expect(r.ok).toBe(true)
  })
})
```

> The `config() as never` cast exists because `ResolvedSchemaConfig`'s `folders` shape must match `SchemaFolders` exactly. Read `packages/core/src/config/types.ts` and build a properly typed config instead of casting — a cast here would hide a real mismatch between what this test passes and what `walkSchemaDirectory` expects.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/load.test.ts`
Expected: FAIL — `Failed to resolve import "../load"`.

- [ ] **Step 3: Implement it**

Create `packages/core/src/versions/load.ts`:

- Resolve `versions/` under `config.base_path`. If it does not exist, call `computeVersionModel` with empty snapshots, history and pending, and return.
- Discover snapshot directories matching `/^v\d+$/`, sorted by their numeric part ascending.
- Read `pending.json` and `history.json` with `loadSchemaFile` if present; absent means the empty shapes from Task 1. A file that exists but fails to parse is a `FILE_PARSE_ERROR` — `loadSchemaFile` already produces that.
- For each snapshot directory, build a `ResolvedSchemaConfig` rooted at it, run `walkSchemaDirectory` + `parseSchema` per file, and assemble with `buildSchemaRegistry(schemas, current.routes, current.roles)`. Wrap any failure as `VERSION_SNAPSHOT_INVALID`, preserving the underlying error's message so the author sees the real problem.
- Hand everything to `computeVersionModel`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/load.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 5: Export the public surface**

In `packages/core/src/index.ts`, add to the existing type export block and add a value export, matching the file's existing grouping and comment style:

```ts
export type {
  PendingChanges,
  VersionHistory,
  VersionSnapshot,
  VersionProjection,
  VersionModel,
} from './versions/types.js'

export { loadVersionModel } from './versions/load.js'
export { computeVersionModel } from './versions/compute.js'
```

- [ ] **Step 6: Run the full core suite and the build**

Run: `pnpm --filter @bobbykim/manguito-cms-core test` then `pnpm build`
Expected: core suite PASS; build 7/7. The build matters here — this is the task that changes the package's public surface.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/versions packages/core/src/index.ts
git commit -m "feat(core): load the version model from disk and export it"
```

---

### Task 8: Document the module

**Files:**
- Modify: `packages/core/CONTEXT.md`

**Interfaces:** none.

- [ ] **Step 1: Add the glossary entries**

Read `packages/core/CONTEXT.md` first for its structure. Its terms are `**Term**:` followed by a definition and an `_Avoid_:` line of rejected synonyms; add a `### Versioning` subsection placed where it reads naturally against the existing ones:

```markdown
### Versioning

**Live version**:
A version currently served — every cut snapshot under `schemas/versions/` plus the current working schema. The current version is live and has an identity projection.
_Avoid_: active version, supported version

**Cut**:
Freezing the current schema as a named version. `version:cut` snapshots the schema files into `versions/vN/`, appends `pending.json` to `history.json` tagged with vN, and clears pending. The workflow is cut first, then break things.
_Avoid_: tag, release, freeze

**Union registry**:
An ordinary `SchemaRegistry` holding every live version's fields merged, keyed by column. Feeds db codegen and drift detection. Differs from a plain merge in one way: a column current no longer exposes is retained and forced nullable.
_Avoid_: merged registry, combined schema

**Projection**:
What one live version exposes: per type, each column and the label that version exposes it under, plus any fallback. The current version's projection is the identity.
_Avoid_: view, mapping

**Retained column**:
A column present in the union but absent from the current schema, because an older live version still exposes it. Dropped only when the last version referencing it retires.
_Avoid_: legacy column, orphan column

**pending.json / history.json**:
The two declaration files, distinguished by writer. `pending.json` is hand-written and covers changes since the last cut. `history.json` is machine-written by `version:cut`, append-only, and **never pruned** — column identity folds over it, so retiring a version must not remove its renames.
_Avoid_: changes file, changelog
```

- [ ] **Step 2: Confirm the suite is untouched**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS, unchanged — this task is documentation only.

- [ ] **Step 3: Commit**

```bash
git add packages/core/CONTEXT.md
git commit -m "docs(core): document the version model vocabulary"
```

---

## Exit Criteria

- [ ] `pnpm test` passes 11/11 with **no existing test assertion altered**.
- [ ] `pnpm build` succeeds 7/7.
- [ ] `git diff --name-only master..HEAD` shows nothing outside `packages/core/` and `docs/`.
- [ ] The retired-version fold test exists and passes — it is the one case where a wrong answer would be silent.
- [ ] `loadVersionModel` returns an identity model for a project with no `versions/` directory, and `union` is reference-equal to `current`.
- [ ] No new dependencies in `packages/core/package.json`.

## What the later sub-projects inherit

- **2b — db codegen** consumes `union` as an ordinary `SchemaRegistry`; retention and nullability are already expressed in it.
- **2c — CLI** implements the sealing this module reads: `version:cut` appends `pending.json` to `history.json` tagged with the version being cut, snapshots the schema, and clears pending. `version:diff` prints a projection.
- **2d — versioned REST routes** consume `projections`, generalizing Stage 1.5's per-type `Projectors` into a per-version, per-type structure.
- **2e — GraphQL and retirement** derive retained fields and old labels from `projections`; retirement deletes a snapshot directory and never touches `history.json`.

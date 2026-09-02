# CLI Version Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `version:cut`, `version:diff` and `version:retire` to the CLI, plus the two core exports they need, so schema versioning becomes usable for the first time.

**Architecture:** Core gains one pure function that classifies the difference between two `SchemaRegistry`s keyed by column (`describeSchemaChange`) and one loader extracted from what `loadVersionModel` already does internally (`loadVersionSnapshots`). The CLI composes those into three colon-namespaced commands, keeping handlers thin and every decidable step a pure, directly-tested function — the pattern `build.test.ts` and `dev-routing.ts` already establish.

**Tech Stack:** TypeScript strict, Vitest, commander, `@inquirer/prompts` (already present via `PromptAdapter`). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-02-cli-version-lifecycle-design.md`](../specs/2026-09-02-cli-version-lifecycle-design.md)

## Global Constraints

- **Layer boundaries, never crossed:** `core` imports nothing from `db`, `api`, `admin` or `cli`. `cli` may import from all.
- **No new dependencies** in any package. `packages/core`'s bar is deliberately high (current set: zod, yaml, bcryptjs — see `docs/adr/core/0006`).
- **TypeScript only.** Never create a `.js` source file.
- **Never throw for an expected failure.** Use `Result<T>` = `{ ok: true; value: T } | { ok: false; errors: ParseError[] }` from `packages/core/src/parser/loader.ts`, collecting every error rather than stopping at the first.
- **Parser output must be serializable plain objects** — no class instances, and no `Map`/`Set` reaching a `SchemaChange`, `ParsedField`, `SchemaRegistry` or `VersionModel`. Internal helpers may use them.
- **Factory functions over classes** for public API; pure functions for data transformations; named function declarations for top-level exports, arrow functions for callbacks.
- **Import conventions are deliberately non-uniform:** `packages/core/src/versions/` uses explicit `.js` on relative imports; `packages/core/src/parser/`, `packages/core/src/registry/` and all `__tests__/` use extensionless. **All of `packages/cli/src/` uses explicit `.js`** (`from '../utils/env.js'`). Match the directory you are editing.
- **CLI error convention:** `printGuidedError(message, hint?)` prints to stderr and does **not** exit; the caller then calls `process.exit(1)`. `resolveConfig` exits by itself on failure. Follow `validate.ts`.
- **CLI command naming:** colon-namespaced (`users:promote`), not commander subcommands.
- **`config.schema.base_path` is RELATIVE** (defaults to `'./schemas'`). Every task that touches the filesystem must resolve it against `cwd` exactly once and pass the absolute form onward — see Task 3.
- **Test commands.** Never bare `vitest`; each package's script wraps it in `dotenv -e .env.test`, and skipping that aborts with a misleading "DB_URL not set in .env.test". Use `pnpm --filter @bobbykim/manguito-cms-core test`, `pnpm --filter @bobbykim/manguito-cms-cli test`. Narrow to one file by appending a path relative to that package.
- **Also run lint** before each commit: `pnpm --filter <pkg> lint`. An unused import is an eslint error here and has slipped past review before.
- **The test database runs on port 5435.** If an integration test cannot connect, run `pnpm db:test:up`.
- **Baseline at the start of this plan:** core 225 passed / 2 todo; cli 72 passed; monorepo `pnpm test` 11/11 and `pnpm build` 7/7; lint 7/7. Never finish a task below the baseline minus tests the task deliberately deletes.
- **Commit style:** conventional commits, `type(scope): subject`, scope `core` or `cli`.
- **Never commit to `master`.** All work lands on the branch `docs/cli-version-lifecycle` (already checked out, already holds the spec commit).

---

## File Structure

**Core — new:**
- `packages/core/src/versions/describe.ts` — `describeSchemaChange` and its three output types. Pure; no filesystem, no imports from outside `core`.
- `packages/core/src/versions/__tests__/describe.test.ts`

**Core — modified:**
- `packages/core/src/versions/load.ts` — extract `loadVersionSnapshots`; `loadVersionModel` becomes a two-line composition of it.
- `packages/core/src/index.ts` — export the new function, the loader, and the three types.

**CLI — new:**
- `packages/cli/src/utils/schema-config.ts` — `resolveSchemaConfig(cwd, config)`, the single place `base_path` becomes absolute.
- `packages/cli/src/utils/registry.ts` — `loadWorkingRegistry(cwd, config)`, the exit-on-failure registry build. A sixth inline copy of this preamble is what the plan avoids.
- `packages/cli/src/commands/version.ts` — `registerVersion(program)` and the three handlers.
- `packages/cli/src/commands/version-report.ts` — formats a `SchemaChange` into terminal lines. Pure. `dev-routing.ts` is the precedent for a helper module in `commands/`.
- `packages/cli/src/commands/version-fs.ts` — `copySnapshotFolders`, `retireSnapshotDir`. The only filesystem-mutating code, isolated so it is testable against a temp directory.
- Tests: `packages/cli/src/__tests__/version-report.test.ts`, `version-fs.test.ts`, `version-guards.test.ts`.

**CLI — modified:**
- `packages/cli/src/index.ts` — register the namespace.

**Documentation:**
- `packages/core/CONTEXT.md`, `packages/cli/CONTEXT.md`, and one changeset.

**Deliberately NOT modified:** `dev.ts`, `start.ts`, `migrate.ts`, `validate.ts`, `build.ts`. Each builds the registry inline today. Task 3 adds the shared helper and uses it only in new code; converting those five is a separate pass (see Residuals) because `validate.ts`'s variant deliberately collects every error and continues, so they are not one function.

---

## Task 1: Extract and export `loadVersionSnapshots`

**Files:**
- Modify: `packages/core/src/versions/load.ts` (the `loadVersionModel` function at the end of the file)
- Modify: `packages/core/src/index.ts:127`
- Test: `packages/core/src/versions/__tests__/load.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadVersionSnapshots(config: ResolvedSchemaConfig, current: SchemaRegistry): Result<VersionSnapshot[]>`, exported from `@bobbykim/manguito-cms-core`. Tasks 5-7 call it.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/versions/__tests__/load.test.ts`. It already has `dir`, `config()` and `writeSnapshot(versionDir, fieldName)` helpers plus the `beforeEach`/`afterEach` temp-dir setup — reuse them, and add `loadVersionSnapshots` to the existing import from `'../load'`.

```typescript
describe('loadVersionSnapshots', () => {
  it('returns an empty array when versions/ is absent', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionSnapshots(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([])
  })

  it('returns every snapshot, ordered by numeric version', () => {
    // v10 before v9 lexicographically — the ordering guard that already
    // exists for loadVersionModel must hold for the extracted loader too,
    // because callers read the LAST element as the highest version.
    writeSnapshot(path.join(dir, 'versions', 'v9'), 'a')
    writeSnapshot(path.join(dir, 'versions', 'v10'), 'a')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionSnapshots(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((s) => s.version)).toEqual(['v9', 'v10'])
  })

  it('reads snapshots through config.folders, not hardcoded folder names', () => {
    // Guards a Critical defect found in review: a hardcoded folder name made
    // every snapshot read as silently EMPTY for any project that renamed a
    // schema folder — which would then drop columns from the union.
    const typesDir = path.join(dir, 'versions', 'v1', 'ct')
    fs.mkdirSync(typesDir, { recursive: true })
    fs.writeFileSync(
      path.join(typesDir, 'content--post.json'),
      JSON.stringify({
        name: 'content--post', label: 'Post', type: 'content-type',
        default_base_path: 'x', only_one: false,
        fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields: [
          { name: 'a', label: 'a', type: 'text/plain', required: false },
        ] } }],
      })
    )
    const custom = { ...config(), folders: { ...config().folders, content_types: 'ct' } }
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])

    const r = loadVersionSnapshots(custom, current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.value[0]!.registry.content_types)).toEqual(['content--post'])
  })

  it('reports VERSION_SNAPSHOT_INVALID for an unparseable snapshot file', () => {
    const typesDir = path.join(dir, 'versions', 'v1', 'content-types')
    fs.mkdirSync(typesDir, { recursive: true })
    fs.writeFileSync(path.join(typesDir, 'content--post.json'), '{ not json')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])

    const r = loadVersionSnapshots(config(), current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_SNAPSHOT_INVALID')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/load.test.ts`
Expected: FAIL — `loadVersionSnapshots` is not exported from `'../load'`, so the file does not compile.

- [ ] **Step 3: Extract the function**

In `packages/core/src/versions/load.ts`, replace the whole `loadVersionModel` function with these two:

```typescript
/**
 * Every snapshot under `versions/`, oldest first by NUMERIC version.
 *
 * Split out of loadVersionModel so a caller can reach a snapshot's registry.
 * `VersionModel` deliberately does not carry them — it holds `current`,
 * `live`, `union` and `projections`, and is passed around and consumed by db
 * codegen, so bolting N full registries onto it would make every consumer
 * pay for data only the CLI's diff needs.
 *
 * Absent `versions/` is not an error: it means nothing has been cut yet.
 */
export function loadVersionSnapshots(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionSnapshot[]> {
  const versionsDir = path.join(config.base_path, 'versions')
  if (!directoryExists(versionsDir)) return { ok: true, value: [] }

  const snapshots: VersionSnapshot[] = []
  const errors: ParseError[] = []

  for (const { version, dir } of discoverSnapshotDirs(versionsDir)) {
    // config.folders, never hardcoded names — a snapshot mirrors whatever
    // folder names the live schema tree uses today, including a renamed one.
    const result = loadSnapshot(version, dir, config.folders, current)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    snapshots.push(result.value)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: snapshots }
}

/**
 * Reads the snapshot directories under `versions/` and hands them to
 * computeVersionModel. Absent `versions/` means nothing has been cut yet: an
 * identity model at v1.
 */
export function loadVersionModel(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionModel> {
  const snapshots = loadVersionSnapshots(config, current)
  if (!snapshots.ok) return snapshots
  return computeVersionModel({ current, snapshots: snapshots.value })
}
```

Leave `discoverSnapshotDirs`, `walkSnapshotFolders`, `wrapAsSnapshotInvalid` and `loadSnapshot` untouched.

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, change line 127 to:

```typescript
export { loadVersionModel, loadVersionSnapshots } from './versions/load.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: at least 229 passed, 2 todo (225 baseline + 4 new) — treat the total as indicative. Every pre-existing `loadVersionModel` test must still pass — this is a pure extraction and the composition is behaviour-identical.

Run: `pnpm --filter @bobbykim/manguito-cms-core lint` — clean.
Run: `pnpm --filter @bobbykim/manguito-cms-core build` — succeeds (tsup runs a DTS type-check that vitest does not, and this task changes the public surface).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): export loadVersionSnapshots"
```

---

## Task 2: `describeSchemaChange`

**Files:**
- Create: `packages/core/src/versions/describe.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/versions/__tests__/describe.test.ts` (create)

**Interfaces:**
- Consumes: `isColumnBacked` from `'../registry/columns.js'`; `SchemaRegistry`; `VersionSnapshot`.
- Produces:

```typescript
describeSchemaChange(input: {
  from: VersionSnapshot | null
  to: { version: string; registry: SchemaRegistry }
}): SchemaChange
```

plus the exported types `FieldChange`, `TypeChange`, `SchemaChange`.

> **Correction to the spec.** The spec writes the signature as `describeSchemaChange(from: SchemaRegistry | null, to: SchemaRegistry)`, but `SchemaChange` carries `from: string | null` and `to: string` — the *version names* — which two bare registries cannot supply. The object form above takes `{ version, registry }` on each side, matching `VersionSnapshot`'s existing shape. Same behaviour, complete signature.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/versions/__tests__/describe.test.ts
import { describe, it, expect } from 'vitest'
import { describeSchemaChange } from '../describe'
import { makeContentType, makeTaxonomyType, makeParagraphType, makeRegistry } from './fixtures'
import type { SchemaRegistry } from '../../parser/validate'

function snap(version: string, registry: SchemaRegistry) {
  return { version, registry }
}

const TYPE = 'content--blog_post'

function change(
  fromFields: Parameters<typeof makeContentType>[1] | null,
  toFields: Parameters<typeof makeContentType>[1]
) {
  return describeSchemaChange({
    from: fromFields === null ? null : snap('v1', makeRegistry([makeContentType(TYPE, fromFields)])),
    to: snap('v2', makeRegistry([makeContentType(TYPE, toFields)])),
  })
}

/** The one type's field changes, for a terser assertion. */
function fieldsOf(c: ReturnType<typeof change>) {
  return c.types.find((t) => t.type === TYPE)!.fields
}

describe('describeSchemaChange — the four kinds', () => {
  it('reports a new column as added, with its type', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }, { name: 'views', type: 'integer' }])
    expect(fieldsOf(c)).toEqual([{ kind: 'added', column: 'views', name: 'views', field_type: 'integer' }])
  })

  it('reports a rename as one renamed column, not a drop plus an add', () => {
    // The whole reason the classification is keyed by column. Under a
    // name-keyed implementation this would come back as two entries.
    const c = change([{ name: 'blog_title' }], [{ name: 'title', column: 'blog_title' }])
    expect(fieldsOf(c)).toEqual([
      { kind: 'renamed', column: 'blog_title', from_name: 'blog_title', to_name: 'title' },
    ])
  })

  it('reports a tombstone, carrying its fallback', () => {
    const c = change(
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }],
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich', removed: true, fallback: '' }]
    )
    expect(fieldsOf(c)).toEqual([
      { kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc', fallback: '' },
    ])
  })

  it('omits fallback entirely when the tombstone declares none', () => {
    const c = change(
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }],
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich', removed: true }]
    )
    expect(fieldsOf(c)).toEqual([{ kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc' }])
  })

  it('reports a column brought back from a tombstone as restored', () => {
    // A snapshot can itself contain a tombstone. Without this kind the case
    // matches no other branch and is silently reported as unchanged — a lie.
    const c = change(
      [{ name: 'blog_desc', type: 'text/rich', removed: true }],
      [{ name: 'blog_desc', type: 'text/rich' }]
    )
    expect(fieldsOf(c)).toEqual([{ kind: 'restored', column: 'blog_desc', name: 'blog_desc' }])
  })

  it('reports nothing for an unchanged field', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(fieldsOf(c)).toEqual([])
  })

  it('reports nothing for a field that stayed tombstoned', () => {
    const c = change(
      [{ name: 'gone', removed: true }],
      [{ name: 'gone', removed: true }]
    )
    expect(fieldsOf(c)).toEqual([])
  })
})

describe('describeSchemaChange — identical', () => {
  it('is true when no type or field changed', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(c.identical).toBe(true)
  })

  it('is false when a field changed', () => {
    const c = change([{ name: 'title' }], [{ name: 'headline', column: 'title' }])
    expect(c.identical).toBe(false)
  })

  it('is false when a type was added, even with no field changes elsewhere', () => {
    const c = describeSchemaChange({
      from: snap('v1', makeRegistry([makeContentType(TYPE, [{ name: 'title' }])])),
      to: snap('v2', makeRegistry([
        makeContentType(TYPE, [{ name: 'title' }]),
        makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
      ])),
    })
    expect(c.identical).toBe(false)
    expect(c.types.find((t) => t.type === 'taxonomy--tag')!.status).toBe('added')
  })
})

describe('describeSchemaChange — version names', () => {
  it('carries both version names through', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(c.from).toBe('v1')
    expect(c.to).toBe('v2')
  })

  it('treats a null from as the first cut — every type added, every field added', () => {
    const c = change(null, [{ name: 'title' }, { name: 'views', type: 'integer' }])
    expect(c.from).toBeNull()
    expect(c.to).toBe('v2')
    const t = c.types.find((x) => x.type === TYPE)!
    expect(t.status).toBe('added')
    expect(t.fields.map((f) => f.kind)).toEqual(['added', 'added'])
    expect(c.identical).toBe(false)
  })
})

describe('describeSchemaChange — coverage of the registry', () => {
  it('classifies taxonomy and paragraph types too, not only content types', () => {
    // Paragraph types are part of a snapshot and are covered by the model's
    // completeness check, so a change report that skipped them would tell the
    // author they were freezing less than they are.
    const from = makeRegistry([
      makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
      makeParagraphType('paragraph--card', [{ name: 'caption' }]),
    ])
    const to = makeRegistry([
      makeTaxonomyType('taxonomy--tag', [{ name: 'label', column: 'tag_name' }]),
      makeParagraphType('paragraph--card', [{ name: 'caption' }, { name: 'alt' }]),
    ])
    const c = describeSchemaChange({ from: snap('v1', from), to: snap('v2', to) })

    expect(c.types.find((t) => t.type === 'taxonomy--tag')!.fields).toEqual([
      { kind: 'renamed', column: 'tag_name', from_name: 'tag_name', to_name: 'label' },
    ])
    expect(c.types.find((t) => t.type === 'paragraph--card')!.fields).toEqual([
      { kind: 'added', column: 'alt', name: 'alt', field_type: 'text/plain' },
    ])
  })

  it('ignores fields with no storage column', () => {
    const c = change(
      [{ name: 'title' }],
      [
        { name: 'title' },
        { name: 'cards', type: 'paragraph', ref: 'paragraph--card', rel: 'one-to-many' },
      ]
    )
    expect(fieldsOf(c)).toEqual([])
  })

  it('reports a moved column as a drop of the old plus an add of the new', () => {
    // Changing `column` while keeping `name` is not a rename — it is a
    // different column. Keyed by column, that is honestly two facts. The old
    // column being gone is VERSION_COLUMN_MISSING's business, so only the new
    // one appears here.
    const c = change([{ name: 'title' }], [{ name: 'title', column: 'headline' }])
    expect(fieldsOf(c)).toEqual([
      { kind: 'added', column: 'headline', name: 'title', field_type: 'text/plain' },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/describe.test.ts`
Expected: FAIL — `../describe` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/versions/describe.ts
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField, FieldType } from '../registry/types.js'
import type { VersionSnapshot } from './types.js'
import { isColumnBacked } from '../registry/columns.js'

// ─── Output ───────────────────────────────────────────────────────────────────
//
// What changed between two versions of a schema, keyed by COLUMN rather than
// by name — which is what makes a rename legible as a rename instead of as a
// delete plus an add.
//
// A VALID model admits exactly these four kinds. Two more are unreachable: a
// column the older version exposes that is absent from the newer one is
// already VERSION_COLUMN_MISSING, and a column whose type changed is already
// FIELD_TYPE_CHANGED_WHILE_LIVE. So if the model loads, cutting is always
// safe, and this function never has to report a blocker.

export type FieldChange =
  | { kind: 'added'; column: string; name: string; field_type: FieldType }
  | { kind: 'renamed'; column: string; from_name: string; to_name: string }
  | { kind: 'tombstoned'; column: string; name: string; fallback?: unknown }
  | { kind: 'restored'; column: string; name: string }

export type TypeChange = {
  type: string
  /** `added` when the newer schema defines a type the older did not. `dropped` is unreachable — it is VERSION_COLUMN_MISSING. */
  status: 'present' | 'added'
  /** Empty when the type is unchanged. */
  fields: FieldChange[]
}

export type SchemaChange = {
  /** The version compared against; `null` when nothing has been cut yet. */
  from: string | null
  /** The version the newer schema is (or would become). */
  to: string
  types: TypeChange[]
  /** True when no type or field changed. */
  identical: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Every content, taxonomy and paragraph type, as [name, fields] pairs. */
function typeEntries(registry: SchemaRegistry): Array<[string, ParsedField[]]> {
  return [
    ...Object.entries(registry.content_types),
    ...Object.entries(registry.taxonomy_types),
    ...Object.entries(registry.paragraph_types),
  ].map(([name, type]): [string, ParsedField[]] => [name, type.fields])
}

/** A type's column-backed fields keyed by column. Tombstones included — they hold a real column. */
function byColumn(fields: ParsedField[]): Map<string, ParsedField> {
  const out = new Map<string, ParsedField>()
  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    out.set(f.db_column!.column_name, f)
  }
  return out
}

// ─── describeSchemaChange ─────────────────────────────────────────────────────

/**
 * Classifies the difference between an older version and a newer one.
 *
 * Iterating the NEWER schema's types is complete: a type the older version
 * has and the newer one lacks cannot occur in a valid model, because the
 * completeness check would already have refused it.
 *
 * When a field is both renamed and tombstoned in one step, `tombstoned`
 * wins — it is the salient fact, and its `name` is the newer name, so no
 * information is lost. Same for renamed-and-restored.
 */
export function describeSchemaChange(input: {
  from: VersionSnapshot | null
  to: { version: string; registry: SchemaRegistry }
}): SchemaChange {
  const { from, to } = input
  const fromTypes = new Map(from === null ? [] : typeEntries(from.registry))
  const types: TypeChange[] = []

  for (const [typeName, toFields] of typeEntries(to.registry)) {
    const fromFields = fromTypes.get(typeName)
    const fromByColumn = byColumn(fromFields ?? [])
    const fields: FieldChange[] = []

    for (const [column, toField] of byColumn(toFields)) {
      const fromField = fromByColumn.get(column)

      if (fromField === undefined) {
        fields.push({ kind: 'added', column, name: toField.name, field_type: toField.field_type })
        continue
      }

      const wasTombstone = fromField.removed === true
      const isTombstone = toField.removed === true

      if (!wasTombstone && isTombstone) {
        fields.push({
          kind: 'tombstoned',
          column,
          name: toField.name,
          // Omitted entirely rather than set undefined, so an equality check
          // against the no-fallback case is clean.
          ...(toField.fallback !== undefined && { fallback: toField.fallback }),
        })
        continue
      }

      if (wasTombstone && !isTombstone) {
        fields.push({ kind: 'restored', column, name: toField.name })
        continue
      }

      if (fromField.name !== toField.name) {
        fields.push({ kind: 'renamed', column, from_name: fromField.name, to_name: toField.name })
      }
      // Otherwise unchanged — contributes no entry.
    }

    types.push({
      type: typeName,
      status: fromFields === undefined ? 'added' : 'present',
      fields,
    })
  }

  const identical = types.every((t) => t.status === 'present' && t.fields.length === 0)

  return { from: from?.version ?? null, to: to.version, types, identical }
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, extend the versions block:

```typescript
export type {
  VersionSnapshot,
  VersionProjection,
  VersionModel,
} from './versions/types.js'

export type { FieldChange, TypeChange, SchemaChange } from './versions/describe.js'

export { loadVersionModel, loadVersionSnapshots } from './versions/load.js'
export { computeVersionModel } from './versions/compute.js'
export { describeSchemaChange } from './versions/describe.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/versions/__tests__/describe.test.ts`
Expected: PASS — 15 tests.

Run: `pnpm --filter @bobbykim/manguito-cms-core test` — expect at least 244 passed, 2 todo (229 + 15 new).
Run: `pnpm --filter @bobbykim/manguito-cms-core lint` — clean.
Run: `pnpm --filter @bobbykim/manguito-cms-core build` — succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): classify the change between two schema versions"
```

---

## Task 3: The CLI's absolute schema config and shared registry load

**Files:**
- Create: `packages/cli/src/utils/schema-config.ts`
- Create: `packages/cli/src/utils/registry.ts`
- Test: `packages/cli/src/__tests__/schema-config.test.ts` (create)

**Interfaces:**
- Consumes: `ResolvedManguitoConfig` from `resolveConfig`; core's parsing building blocks.
- Produces:
  - `resolveSchemaConfig(cwd: string, config: ResolvedManguitoConfig): ResolvedSchemaConfig` — the same shape core expects, with `base_path` made **absolute**.
  - `loadWorkingRegistry(cwd: string, config: ResolvedManguitoConfig, command: string): SchemaRegistry` — parses schemas, roles and routes; on any error prints them and calls `process.exit(1)`.

**Why this task exists.** `config.schema.base_path` is **relative** (it defaults to `'./schemas'`). Core's `loadVersionSnapshots` does `path.join(config.base_path, 'versions')`, so passing the raw config works only while `cwd` is the project root, while the CLI's own copy and delete operations need absolute paths. Resolving once, here, makes core's reads and the CLI's writes agree on one root and makes the handlers testable against a temp directory. Five existing commands build the registry inline; this adds the shared helper for new code without converting them (see Residuals).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/schema-config.test.ts
import { describe, it, expect } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { resolveSchemaConfig } from '../utils/schema-config.js'

const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

describe('resolveSchemaConfig', () => {
  it('makes a relative base_path absolute against cwd', () => {
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: './schemas', folders: FOLDERS },
    } as never)
    expect(isAbsolute(out.base_path)).toBe(true)
    expect(out.base_path).toBe(join('/projects/app', 'schemas'))
  })

  it('leaves an already-absolute base_path alone', () => {
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: '/elsewhere/schemas', folders: FOLDERS },
    } as never)
    expect(out.base_path).toBe('/elsewhere/schemas')
  })

  it('passes folders through unchanged, so an override survives', () => {
    const custom = { ...FOLDERS, content_types: 'ct' }
    const out = resolveSchemaConfig('/projects/app', {
      schema: { base_path: './schemas', folders: custom },
    } as never)
    expect(out.folders).toEqual(custom)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/schema-config.test.ts`
Expected: FAIL — `../utils/schema-config.js` does not exist.

- [ ] **Step 3: Write `schema-config.ts`**

```typescript
// packages/cli/src/utils/schema-config.ts
import { resolve } from 'node:path'
import type { ResolvedManguitoConfig, ResolvedSchemaConfig } from '@bobbykim/manguito-cms-core'

/**
 * The schema config core expects, with `base_path` made absolute.
 *
 * `base_path` is authored relative (it defaults to './schemas'), and core
 * joins it directly — so passing the raw config works only while the process
 * cwd is the project root. Resolving it once here means core's reads and the
 * CLI's own writes under `versions/` agree on a single root, and lets a
 * handler be pointed at a temp directory in a test.
 */
export function resolveSchemaConfig(
  cwd: string,
  config: ResolvedManguitoConfig
): ResolvedSchemaConfig {
  return {
    base_path: resolve(cwd, config.schema.base_path),
    folders: config.schema.folders,
  }
}
```

If `ResolvedManguitoConfig` is not exported from core's index, import it from wherever `utils/config.ts` imports it and match that.

- [ ] **Step 4: Write `registry.ts`**

Model this on `build.ts`'s preamble — the exit-on-failure variant. Read `packages/cli/src/commands/build.ts` lines ~40-105 and lift that logic verbatim, changing only the command name in the error title.

```typescript
// packages/cli/src/utils/registry.ts
import { resolve } from 'node:path'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
  type ParseError,
  type ParsedSchema,
  type ParsedRoles,
  type ParsedRoutes,
  type SchemaRegistry,
  type ResolvedManguitoConfig,
} from '@bobbykim/manguito-cms-core'
import { printValidationErrors } from './error.js'
import { resolveSchemaConfig } from './schema-config.js'

/**
 * Parses every schema file, roles.json and routes.json into a SchemaRegistry.
 * Prints all errors and exits 1 on any failure — the exit-on-failure variant
 * that build/start/migrate use, as distinct from `validate`, which
 * deliberately collects everything and keeps going.
 *
 * `command` appears in the error output so the hint names the command the
 * author actually ran.
 */
export function loadWorkingRegistry(
  cwd: string,
  config: ResolvedManguitoConfig,
  command: string
): SchemaRegistry {
  const schema = resolveSchemaConfig(cwd, config)
  const allErrors: ParseError[] = []
  const parsedSchemas: ParsedSchema[] = []

  const walkResult = walkSchemaDirectory(schema)
  if (!walkResult.ok) {
    allErrors.push(...walkResult.errors)
  } else {
    for (const file of walkResult.value) {
      const parseResult = parseSchema(file.raw, file.schema_type, file.path)
      if (!parseResult.ok) {
        allErrors.push(...parseResult.errors)
      } else {
        parsedSchemas.push(parseResult.schema)
      }
    }
  }

  const rolesPath = resolve(schema.base_path, 'roles.json')
  let parsedRoles: ParsedRoles | null = null
  const rolesLoad = loadSchemaFile(rolesPath)
  if (!rolesLoad.ok) {
    allErrors.push(...rolesLoad.errors)
  } else {
    const rolesParse = parseRoles(rolesLoad.value, rolesPath)
    if (!rolesParse.ok) allErrors.push(...rolesParse.errors)
    else parsedRoles = rolesParse.value
  }

  const routesPath = resolve(schema.base_path, 'routes.json')
  let parsedRoutes: ParsedRoutes | null = null
  const routesLoad = loadSchemaFile(routesPath)
  if (!routesLoad.ok) {
    allErrors.push(...routesLoad.errors)
  } else {
    const routesParse = parseRoutes(routesLoad.value, routesPath)
    if (!routesParse.ok) allErrors.push(...routesParse.errors)
    else parsedRoutes = routesParse.value
  }

  if (allErrors.length > 0 || parsedRoles === null || parsedRoutes === null) {
    printValidationErrors(allErrors, 'Schema parse errors', command)
    process.exit(1)
  }

  return buildSchemaRegistry(parsedSchemas, parsedRoutes, parsedRoles)
}
```

Check the exact names and signatures of `walkSchemaDirectory`, `parseRoles`, `parseRoutes` and the `ParsedRoles`/`ParsedRoutes` types against `build.ts`'s imports before writing — if `build.ts` calls `walkSchemaDirectory(config.schema)` with the raw relative config, pass `schema` instead, since it is the absolute equivalent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/schema-config.test.ts`
Expected: PASS — 3 tests.

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` — expect at least 75 passed (72 baseline + 3 new).
Run: `pnpm --filter @bobbykim/manguito-cms-cli lint` — clean.
Run: `pnpm --filter @bobbykim/manguito-cms-cli build` — succeeds.

`loadWorkingRegistry` has no direct test in this task: it calls `process.exit`, which is why the repo tests pure helpers instead. It is exercised end to end by Task 5's `version:diff`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): resolve the schema base path once and share the registry load"
```

---

## Task 4: The change report formatter

**Files:**
- Create: `packages/cli/src/commands/version-report.ts`
- Test: `packages/cli/src/__tests__/version-report.test.ts` (create)

**Interfaces:**
- Consumes: `SchemaChange`, `FieldChange` from `@bobbykim/manguito-cms-core` (Task 2).
- Produces: `formatSchemaChange(change: SchemaChange): string` — the report body, no trailing newline. Pure: no printing, no process access, so it is directly assertable.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/version-report.test.ts
import { describe, it, expect } from 'vitest'
import { formatSchemaChange } from '../commands/version-report.js'
import type { SchemaChange } from '@bobbykim/manguito-cms-core'

const BASE: SchemaChange = { from: 'v2', to: 'v3', types: [], identical: true }

describe('formatSchemaChange', () => {
  it('names both versions in the header', () => {
    const out = formatSchemaChange({ ...BASE, types: [], identical: true })
    expect(out).toContain('v2')
    expect(out).toContain('v3')
  })

  it('says plainly when nothing changed', () => {
    const out = formatSchemaChange({ ...BASE, identical: true })
    expect(out.toLowerCase()).toContain('no changes')
  })

  it('renders each of the four kinds with its own marker', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [
        {
          type: 'content--blog_post',
          status: 'present',
          fields: [
            { kind: 'added', column: 'subtitle', name: 'subtitle', field_type: 'text/plain' },
            { kind: 'renamed', column: 'blog_title', from_name: 'blog_title', to_name: 'title' },
            { kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc', fallback: '' },
            { kind: 'restored', column: 'old_flag', name: 'old_flag' },
          ],
        },
      ],
    })
    expect(out).toContain('content--blog_post')
    // Added shows the field type; a reader needs it to know what was frozen.
    expect(out).toMatch(/\+\s+subtitle.*text\/plain/)
    // Renamed shows the OLD name — the new name is already the row label.
    expect(out).toMatch(/~\s+title.*blog_title/)
    // Tombstoned says the column is retained, which is the consequence.
    expect(out).toMatch(/⊘\s+blog_desc/)
    expect(out).toContain('retained')
    expect(out).toMatch(/restored/i)
  })

  it('marks an added type as new', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [{ type: 'taxonomy--tag', status: 'added', fields: [] }],
    })
    expect(out).toContain('taxonomy--tag')
    expect(out.toLowerCase()).toContain('new type')
  })

  it('shows a type with no changes without inventing field rows', () => {
    const out = formatSchemaChange({
      ...BASE,
      identical: false,
      types: [
        { type: 'content--blog_post', status: 'present', fields: [
          { kind: 'added', column: 'x', name: 'x', field_type: 'text/plain' },
        ] },
        { type: 'taxonomy--tag', status: 'present', fields: [] },
      ],
    })
    expect(out).toContain('taxonomy--tag')
    expect(out).toMatch(/taxonomy--tag[\s\S]*\(no changes\)/)
  })

  it('describes the first cut when from is null', () => {
    const out = formatSchemaChange({
      from: null, to: 'v1', identical: false,
      types: [{ type: 'content--blog_post', status: 'added', fields: [] }],
    })
    // Must not print "vs null".
    expect(out).not.toContain('null')
    expect(out).toContain('v1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-report.test.ts`
Expected: FAIL — `../commands/version-report.js` does not exist.

- [ ] **Step 3: Write the formatter**

```typescript
// packages/cli/src/commands/version-report.ts
import type { FieldChange, SchemaChange } from '@bobbykim/manguito-cms-core'

// One line per changed field. The marker carries the kind so a long report
// stays scannable; the text after it carries the consequence, because the
// author's question is "what am I committing to", not "what is the kind".
function formatField(change: FieldChange): string {
  switch (change.kind) {
    case 'added':
      return `  + ${change.name}  ${change.field_type}  new`
    case 'renamed':
      return `  ~ ${change.to_name}  was "${change.from_name}"  → column ${change.column}`
    case 'tombstoned': {
      const fallback =
        change.fallback === undefined ? '' : `, fallback ${JSON.stringify(change.fallback)}`
      return `  ⊘ ${change.name}  tombstoned  → column ${change.column} retained${fallback}`
    }
    case 'restored':
      return `  ↺ ${change.name}  restored  → column ${change.column} exposed again`
  }
}

/**
 * The change report body, without a trailing newline. Pure — the caller
 * prints it, so this is directly assertable in a test.
 */
export function formatSchemaChange(change: SchemaChange): string {
  const header =
    change.from === null
      ? `Working schema — nothing has been cut yet, so ${change.to} would be the first version`
      : `Working schema vs ${change.from} (highest snapshot) — would become ${change.to}`

  if (change.identical) {
    return `${header}\n\nNo changes.`
  }

  const blocks = change.types.map((type) => {
    const label = type.status === 'added' ? `${type.type}  (new type)` : type.type
    if (type.fields.length === 0) return `${label}\n  (no changes)`
    return [label, ...type.fields.map(formatField)].join('\n')
  })

  return [header, '', ...blocks].join('\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-report.test.ts`
Expected: PASS — 6 tests. If the `+ subtitle.*text/plain` regex fails, the spacing in `formatField` differs from the test's expectation — fix the format string, not the test's intent.

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` and `lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): format a schema change report"
```

---

## Task 5: `version:diff`

**Files:**
- Create: `packages/cli/src/commands/version.ts`
- Modify: `packages/cli/src/index.ts`
- Test: manual verification against the sandbox app (see Step 4)

**Interfaces:**
- Consumes: `loadWorkingRegistry`, `resolveSchemaConfig` (Task 3); `formatSchemaChange` (Task 4); `loadVersionSnapshots`, `computeVersionModel`, `describeSchemaChange` (Tasks 1-2).
- Produces:
  - `registerVersion(program: Command): void` — Tasks 6 and 7 add to this same function.
  - `runVersionDiff(options: { env?: string }, deps: { cwd: string }): Promise<void>`
  - `highestSnapshot(snapshots: VersionSnapshot[]): VersionSnapshot | null` — exported, pure, reused by Tasks 6 and 7 and tested in Task 7.

- [ ] **Step 1: Write `version.ts` with the shared preamble and `version:diff`**

```typescript
// packages/cli/src/commands/version.ts
// manguito version:diff / version:cut / version:retire — the schema version lifecycle
import type { Command } from 'commander'
import {
  loadVersionSnapshots,
  computeVersionModel,
  describeSchemaChange,
  type SchemaRegistry,
  type VersionModel,
  type VersionSnapshot,
  type ResolvedSchemaConfig,
} from '@bobbykim/manguito-cms-core'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { loadWorkingRegistry } from '../utils/registry.js'
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { printValidationErrors, printSuccess } from '../utils/error.js'
import { formatSchemaChange } from './version-report.js'

/**
 * The snapshot the working schema is a successor to: the HIGHEST-numbered
 * one, not the last created. The live set can have gaps once versions are
 * retired, and `current` is derived from the highest.
 *
 * loadVersionSnapshots already returns them ordered by numeric version, so
 * this is the last element — but it is written to not depend on that, because
 * a caller passing an unordered array should still get the right answer.
 */
export function highestSnapshot(snapshots: VersionSnapshot[]): VersionSnapshot | null {
  let best: VersionSnapshot | null = null
  let bestN = -1
  for (const s of snapshots) {
    const n = Number.parseInt(s.version.replace(/^v/, ''), 10)
    if (Number.isNaN(n) || n <= bestN) continue
    best = s
    bestN = n
  }
  return best
}

type VersionContext = {
  schema: ResolvedSchemaConfig
  registry: SchemaRegistry
  snapshots: VersionSnapshot[]
  model: VersionModel
}

/**
 * The preamble every version command shares: env, config, working registry,
 * snapshots, model. Exits 1 with the model's own errors when it is invalid —
 * which is also what makes cutting safe to offer, since a blocker would be
 * failing here rather than appearing after the cut.
 */
async function loadVersionContext(
  options: { env?: string },
  deps: { cwd: string },
  command: string
): Promise<VersionContext> {
  loadEnvFile(options.env)
  const config = await resolveConfig(deps.cwd)
  const schema = resolveSchemaConfig(deps.cwd, config)
  const registry = loadWorkingRegistry(deps.cwd, config, command)

  const snapshots = loadVersionSnapshots(schema, registry)
  if (!snapshots.ok) {
    printValidationErrors(snapshots.errors, 'Snapshot errors', command)
    process.exit(1)
  }

  const model = computeVersionModel({ current: registry, snapshots: snapshots.value })
  if (!model.ok) {
    printValidationErrors(model.errors, 'Version model errors', command)
    process.exit(1)
  }

  return { schema, registry, snapshots: snapshots.value, model: model.value }
}

export function registerVersion(program: Command): void {
  program
    .command('version:diff')
    .description('Show what cutting a new version would freeze')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runVersionDiff(options, { cwd: process.cwd() })
    })
}

export async function runVersionDiff(
  options: { env?: string },
  deps: { cwd: string }
): Promise<void> {
  const ctx = await loadVersionContext(options, deps, 'manguito version:diff')
  const from = highestSnapshot(ctx.snapshots)

  const change = describeSchemaChange({
    from,
    to: { version: ctx.model.current, registry: ctx.registry },
  })

  process.stdout.write(`${formatSchemaChange(change)}\n`)

  if (change.identical) {
    process.stdout.write(`\nNothing to cut — ${ctx.model.current} would expose the same contract.\n`)
    return
  }
  printSuccess(`Cutting now would create ${ctx.schema.base_path}/versions/${ctx.model.current}/`)
}
```

- [ ] **Step 2: Register the namespace**

In `packages/cli/src/index.ts`, add the import beside the others and the call beside the other `register*` calls:

```typescript
import { registerVersion } from './commands/version.js'
```

```typescript
registerVersion(program)
```

- [ ] **Step 3: Run the suite and lint**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` — no new tests here, so the count is unchanged from Task 4. Nothing may regress.
Run: `pnpm --filter @bobbykim/manguito-cms-cli lint` — clean.
Run: `pnpm --filter @bobbykim/manguito-cms-cli build` — succeeds.

- [ ] **Step 4: Verify by hand against the sandbox**

The sandbox app is a real project with real schemas, and this is the first end-to-end exercise of the preamble.

```bash
pnpm --filter @bobbykim/manguito-cms-core build && pnpm --filter @bobbykim/manguito-cms-cli build
cd apps/sandbox && node ../../packages/cli/dist/index.js version:diff
```

Expected: the sandbox has no `schemas/versions/`, so `from` is null — the report says nothing has been cut yet, `v1` would be the first version, every type is `(new type)`, and the final line names `schemas/versions/v1/`. Paste the output into your report.

If it errors, the preamble is wrong; do not paper over it.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): add version:diff"
```

---

## Task 6: `version:cut`

**Files:**
- Create: `packages/cli/src/commands/version-fs.ts`
- Modify: `packages/cli/src/commands/version.ts`
- Test: `packages/cli/src/__tests__/version-fs.test.ts` (create)

**Interfaces:**
- Consumes: `highestSnapshot`, `loadVersionContext` (Task 5); `SchemaFolders` from core.
- Produces:
  - `copySnapshotFolders(input: { fromRoot: string; toDir: string; folders: SchemaFolders }): void` — copies the four type folders. Throws on failure; the handler catches.
  - `runVersionCut(options: { env?: string; yes?: boolean }, deps: { cwd: string; prompt: PromptAdapter }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/version-fs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copySnapshotFolders } from '../commands/version-fs.js'

let root: string
const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-cut-'))
  fs.mkdirSync(path.join(root, 'content-types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'content-types', 'content--post.json'), '{"a":1}')
  fs.mkdirSync(path.join(root, 'taxonomy-types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'taxonomy-types', 'taxonomy--tag.yaml'), 'a: 1')
  // Root-level files that must NOT be copied — a snapshot holds only type folders.
  fs.writeFileSync(path.join(root, 'roles.json'), '{}')
  fs.writeFileSync(path.join(root, 'routes.json'), '{}')
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('copySnapshotFolders', () => {
  it('copies the type folders that exist, including .yaml files', () => {
    const toDir = path.join(root, 'versions', 'v1')
    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'content-types', 'content--post.json'))).toBe(true)
    expect(fs.existsSync(path.join(toDir, 'taxonomy-types', 'taxonomy--tag.yaml'))).toBe(true)
  })

  it('does not copy roles.json or routes.json', () => {
    // Neither is versioned: core assembles every snapshot with CURRENT's
    // roles and routes. They live at the schema root, not in a type folder.
    const toDir = path.join(root, 'versions', 'v1')
    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'roles.json'))).toBe(false)
    expect(fs.existsSync(path.join(toDir, 'routes.json'))).toBe(false)
  })

  it('skips a type folder that does not exist rather than failing', () => {
    // The sandbox has no enum-types folder in some projects; a missing folder
    // contributes zero files, which is core's rule for snapshots too.
    const toDir = path.join(root, 'versions', 'v1')
    expect(() => copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })).not.toThrow()
    expect(fs.existsSync(path.join(toDir, 'enum-types'))).toBe(false)
  })

  it('honours a renamed folder from config.folders', () => {
    fs.mkdirSync(path.join(root, 'ct'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ct', 'content--post.json'), '{"a":1}')
    const toDir = path.join(root, 'versions', 'v1')

    copySnapshotFolders({ fromRoot: root, toDir, folders: { ...FOLDERS, content_types: 'ct' } })

    expect(fs.existsSync(path.join(toDir, 'ct', 'content--post.json'))).toBe(true)
  })

  it('ignores files with an unsupported extension', () => {
    fs.writeFileSync(path.join(root, 'content-types', 'notes.txt'), 'x')
    const toDir = path.join(root, 'versions', 'v1')

    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'content-types', 'notes.txt'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-fs.test.ts`
Expected: FAIL — `../commands/version-fs.js` does not exist.

- [ ] **Step 3: Write `version-fs.ts`**

```typescript
// packages/cli/src/commands/version-fs.ts
import fs from 'node:fs'
import path from 'node:path'
import type { SchemaFolders } from '@bobbykim/manguito-cms-core'

const SUPPORTED = new Set(['.json', '.yaml', '.yml'])

/**
 * Copies the four schema type folders into a snapshot directory.
 *
 * Only the type folders — `roles.json` and `routes.json` sit at the schema
 * root and are deliberately excluded, because neither is versioned: core
 * assembles every snapshot with CURRENT's roles and routes.
 *
 * A missing type folder contributes zero files rather than failing, matching
 * core's rule for reading a snapshot.
 */
export function copySnapshotFolders(input: {
  fromRoot: string
  toDir: string
  folders: SchemaFolders
}): void {
  const { fromRoot, toDir, folders } = input

  for (const folder of Object.values(folders)) {
    const src = path.join(fromRoot, folder)
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue

    const dest = path.join(toDir, folder)
    fs.mkdirSync(dest, { recursive: true })

    for (const entry of fs.readdirSync(src)) {
      if (!SUPPORTED.has(path.extname(entry).toLowerCase())) continue
      fs.copyFileSync(path.join(src, entry), path.join(dest, entry))
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-fs.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add `version:cut` to `version.ts`**

Add to `registerVersion`:

```typescript
  program
    .command('version:cut')
    .description('Freeze the working schema as a new version')
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (options: { env?: string; yes?: boolean }) => {
      await runVersionCut(options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })
```

Add the handler, and the imports it needs (`fs`, `path`, `createPromptAdapter`, `type PromptAdapter`, `printGuidedError`, `copySnapshotFolders`):

```typescript
export async function runVersionCut(
  options: { env?: string; yes?: boolean },
  deps: { cwd: string; prompt: PromptAdapter }
): Promise<void> {
  const ctx = await loadVersionContext(options, deps, 'manguito version:cut')
  const from = highestSnapshot(ctx.snapshots)
  const version = ctx.model.current

  const change = describeSchemaChange({
    from,
    to: { version, registry: ctx.registry },
  })

  if (change.identical) {
    printGuidedError(
      `Nothing has changed since ${from?.version ?? 'the last cut'} — cutting ${version} would freeze an identical contract.`,
      'A live version commits you to retaining every column it exposes. Change the schema first, or run `manguito version:retire <version>` if you meant to shrink the live set.'
    )
    process.exit(1)
  }

  const versionsDir = path.join(ctx.schema.base_path, 'versions')
  const target = path.join(versionsDir, version)

  // Near-unreachable: `current` is one past the highest snapshot, so `target`
  // cannot already be a snapshot directory. But a FILE named `v3` is skipped
  // by snapshot discovery while still blocking mkdir, so it is checked rather
  // than assumed.
  if (fs.existsSync(target)) {
    printGuidedError(
      `${target} already exists.`,
      'A snapshot directory is never overwritten. Remove or rename it, then run version:cut again.'
    )
    process.exit(1)
  }

  process.stdout.write(`${formatSchemaChange(change)}\n\n`)
  const live = [...ctx.model.live.filter((v) => v !== version), version].join(' ')
  process.stdout.write(
    `After cutting, ${live} are live. Every column those versions expose must stay in the\n` +
      `schema — as a live field or a tombstone — until you retire them.\n\n`
  )

  if (options.yes !== true) {
    const ok = await deps.prompt.confirm(`Freeze the working schema as ${version}?`)
    if (!ok) {
      process.stdout.write('Cancelled. Nothing was written.\n')
      return
    }
  }

  // Written to a temp name and renamed, so the snapshot exists whole or not
  // at all: a PARTIAL snapshot parses as a valid but incomplete version,
  // which silently drops columns from the union. The temp name deliberately
  // does not match /^v\d+$/, so a leftover from a crash is invisible to
  // snapshot discovery instead of being read as a broken version.
  const staging = path.join(versionsDir, `.${version}.tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    copySnapshotFolders({ fromRoot: ctx.schema.base_path, toDir: staging, folders: ctx.schema.folders })
    fs.renameSync(staging, target)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    printGuidedError(
      `Failed to write ${target}: ${err instanceof Error ? err.message : String(err)}`,
      'Nothing was left behind — the snapshot is written to a temporary directory and renamed into place only once it is complete.'
    )
    process.exit(1)
  }

  printSuccess(`Froze the working schema as ${version} at ${target}`)
  process.stdout.write(`Live: ${live}.  Working schema is now v${Number.parseInt(version.slice(1), 10) + 1}.\n`)
}
```

- [ ] **Step 6: Run the suite, lint and build**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` — expect at least 86 passed (75 + Task 4's 6 + this task's 5).
Run: `pnpm --filter @bobbykim/manguito-cms-cli lint` and `build` — clean.

- [ ] **Step 7: Verify by hand against the sandbox, then undo**

```bash
pnpm --filter @bobbykim/manguito-cms-cli build
cd apps/sandbox
node ../../packages/cli/dist/index.js version:cut --yes
ls schemas/versions/v1
node ../../packages/cli/dist/index.js version:diff
node ../../packages/cli/dist/index.js version:cut --yes   # must now refuse: identical
rm -rf schemas/versions                                    # leave the sandbox as you found it
```

Expected: the first cut creates `schemas/versions/v1/` with the type folders and no `roles.json`/`routes.json`; `version:diff` then reports no changes; the second cut refuses with the guided error. Paste all of it into your report, and confirm `git status` in `apps/sandbox` is clean afterwards.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): add version:cut"
```

---

## Task 7: `version:retire`

**Files:**
- Modify: `packages/cli/src/commands/version-fs.ts` (add `retireSnapshotDir`)
- Modify: `packages/cli/src/commands/version.ts`
- Test: `packages/cli/src/__tests__/version-guards.test.ts` (create), `version-fs.test.ts` (extend)

**Interfaces:**
- Consumes: `highestSnapshot`, `loadVersionContext` (Task 5).
- Produces:
  - `retireSnapshotDir(versionsDir: string, version: string): void` — renames then deletes.
  - `orphanedTombstoneErrors(input: { registry: SchemaRegistry; snapshots: VersionSnapshot[]; retiring: string }): ParseError[]` — exported, pure, the "name the edits" computation.
  - `runVersionRetire(version: string, options: { env?: string; yes?: boolean }, deps: { cwd: string; prompt: PromptAdapter }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/cli/src/__tests__/version-guards.test.ts
import { describe, it, expect } from 'vitest'
import { highestSnapshot } from '../commands/version.js'
import { orphanedTombstoneErrors } from '../commands/version.js'
import {
  parseSchema,
  buildSchemaRegistry,
  type ParsedSchema,
  type ParsedRoles,
  type ParsedRoutes,
  type SchemaRegistry,
} from '@bobbykim/manguito-cms-core'

// Core publishes only its main entry (`exports` is just "."), so its internal
// test fixtures are not importable here. These build registries through the
// REAL parseSchema, which is the point: a hand-forged db_column would make
// name and column identical and the tests could not tell column-keying from
// name-keying.
const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

type FieldSpec = { name: string; type?: string; removed?: boolean; column?: string }

function makeContentType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'x',
      only_one: false,
      // ContentTypeRawSchema requires fields wrapped in at least one tab.
      fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields: fields.map((f) => ({
        name: f.name,
        label: f.name,
        type: f.type ?? 'text/plain',
        required: false,
        ...(f.column !== undefined && { column: f.column }),
        ...(f.removed !== undefined && { removed: f.removed }),
      })) } }],
    },
    'content-type',
    `schemas/content-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function makeRegistry(schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, EMPTY_ROUTES, EMPTY_ROLES)
}

describe('highestSnapshot', () => {
  it('returns the highest-numbered snapshot, not the last in the array', () => {
    const s = (version: string) => ({ version, registry: makeRegistry([]) })
    expect(highestSnapshot([s('v9'), s('v10'), s('v2')])!.version).toBe('v10')
  })

  it('returns null when nothing has been cut', () => {
    expect(highestSnapshot([])).toBeNull()
  })

  it('ignores a malformed version name rather than ranking it', () => {
    const s = (version: string) => ({ version, registry: makeRegistry([]) })
    expect(highestSnapshot([s('v1'), s('vX')])!.version).toBe('v1')
  })
})

describe('orphanedTombstoneErrors', () => {
  it('names the tombstone that retiring a version would orphan', () => {
    // v1 exposes column blog_desc; current retains it as a tombstone. Retire
    // v1 and nothing exposes that column any more.
    const registry = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snapshots = [
      {
        version: 'v1',
        registry: makeRegistry([
          makeContentType('content--blog_post', [
            { name: 'title' },
            { name: 'blog_desc', type: 'text/rich' },
          ]),
        ]),
      },
    ]

    const errors = orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })
    expect(errors.map((e) => e.code)).toEqual(['ORPHANED_TOMBSTONE'])
    expect(errors[0]!.message).toContain('blog_desc')
  })

  it('returns nothing when another live version still exposes the column', () => {
    const live = (name: string) => makeContentType('content--blog_post', [{ name: 'title' }, { name, type: 'text/rich' }])
    const registry = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snapshots = [
      { version: 'v1', registry: makeRegistry([live('blog_desc')]) },
      { version: 'v2', registry: makeRegistry([live('blog_desc')]) },
    ]

    // v2 still exposes blog_desc, so retiring v1 orphans nothing.
    expect(orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })).toEqual([])
  })

  it('returns nothing when there are no tombstones at all', () => {
    const registry = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]) },
    ]
    expect(orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })).toEqual([])
  })
})
```

Extend `version-fs.test.ts`:

```typescript
describe('retireSnapshotDir', () => {
  it('removes the snapshot directory', () => {
    const versionsDir = path.join(root, 'versions')
    fs.mkdirSync(path.join(versionsDir, 'v1', 'content-types'), { recursive: true })
    fs.writeFileSync(path.join(versionsDir, 'v1', 'content-types', 'a.json'), '{}')

    retireSnapshotDir(versionsDir, 'v1')

    expect(fs.existsSync(path.join(versionsDir, 'v1'))).toBe(false)
  })

  it('leaves nothing that snapshot discovery would read', () => {
    // The rename step uses a name that cannot match /^v\d+$/, so even if the
    // delete failed the leftover is inert rather than a half-deleted version.
    const versionsDir = path.join(root, 'versions')
    fs.mkdirSync(path.join(versionsDir, 'v1'), { recursive: true })

    retireSnapshotDir(versionsDir, 'v1')

    const remaining = fs.readdirSync(versionsDir).filter((e) => /^v\d+$/.test(e))
    expect(remaining).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-guards.test.ts src/__tests__/version-fs.test.ts`
Expected: FAIL — `orphanedTombstoneErrors` and `retireSnapshotDir` do not exist.


- [ ] **Step 3: Add `retireSnapshotDir` to `version-fs.ts`**

```typescript
/**
 * Retires a snapshot by renaming it out of discovery's way first, then
 * deleting the renamed directory.
 *
 * The rename is atomic and the new name cannot match /^v\d+$/, so the version
 * is gone as far as snapshot discovery is concerned the instant it succeeds.
 * If the delete then fails, what is left behind is inert junk rather than a
 * half-deleted version that would parse as valid but incomplete.
 */
export function retireSnapshotDir(versionsDir: string, version: string): void {
  const from = path.join(versionsDir, version)
  const staging = path.join(versionsDir, `.${version}.removing`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.renameSync(from, staging)
  fs.rmSync(staging, { recursive: true, force: true })
}
```

- [ ] **Step 4: Add `orphanedTombstoneErrors` and the handler to `version.ts`**

```typescript
/**
 * The tombstones that retiring `retiring` would orphan — computed BEFORE
 * anything is deleted, by recomputing the model without that snapshot and
 * reading its ORPHANED_TOMBSTONE errors.
 *
 * Removing a snapshot can only ever introduce that one error class: fewer
 * live versions means fewer columns to satisfy and fewer types to compare,
 * so VERSION_COLUMN_MISSING and FIELD_TYPE_CHANGED_WHILE_LIVE cannot newly
 * appear. Every other error is filtered out rather than reported, so a
 * pre-existing problem elsewhere is not blamed on the retirement.
 */
export function orphanedTombstoneErrors(input: {
  registry: SchemaRegistry
  snapshots: VersionSnapshot[]
  retiring: string
}): ParseError[] {
  const remaining = input.snapshots.filter((s) => s.version !== input.retiring)
  const model = computeVersionModel({ current: input.registry, snapshots: remaining })
  if (model.ok) return []
  return model.errors.filter((e) => e.code === 'ORPHANED_TOMBSTONE')
}
```

Register the command:

```typescript
  program
    .command('version:retire <version>')
    .description('Stop serving a cut version and delete its snapshot')
    .option('--env <path>', 'path to .env file to load')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (version: string, options: { env?: string; yes?: boolean }) => {
      await runVersionRetire(version, options, { cwd: process.cwd(), prompt: createPromptAdapter() })
    })
```

And the handler:

```typescript
export async function runVersionRetire(
  version: string,
  options: { env?: string; yes?: boolean },
  deps: { cwd: string; prompt: PromptAdapter }
): Promise<void> {
  if (!/^v\d+$/.test(version)) {
    printGuidedError(`"${version}" is not a version name.`, 'Expected v<number>, for example v1.')
    process.exit(1)
  }

  const ctx = await loadVersionContext(options, deps, 'manguito version:retire')

  if (!ctx.snapshots.some((s) => s.version === version)) {
    const existing = ctx.snapshots.map((s) => s.version).join(', ')
    printGuidedError(
      `${version} is not a cut version.`,
      existing === ''
        ? 'No versions have been cut yet — run `manguito version:cut` first.'
        : `Cut versions: ${existing}.`
    )
    process.exit(1)
  }

  // `current` is derived as highest + 1, so retiring the HIGHEST snapshot
  // renumbers the working schema backwards onto a number that was already
  // published — a consumer pinned to it would silently receive a different
  // contract. A version number has to mean one contract forever.
  const highest = highestSnapshot(ctx.snapshots)
  if (highest !== null && highest.version === version) {
    printGuidedError(
      `${version} is the newest cut version and cannot be retired.`,
      `The working schema is ${ctx.model.current} because ${version} is the highest snapshot — retiring it would renumber the working schema back onto ${version}, and anyone pinned to ${version} would get a different contract. Run \`manguito version:cut\` first; that makes ${version} retirable.`
    )
    process.exit(1)
  }

  const orphans = orphanedTombstoneErrors({
    registry: ctx.registry,
    snapshots: ctx.snapshots,
    retiring: version,
  })

  process.stdout.write(`Retiring ${version} will delete ${path.join(ctx.schema.base_path, 'versions', version)}\n\n`)
  if (orphans.length > 0) {
    process.stdout.write(
      `${orphans.length} tombstone${orphans.length === 1 ? '' : 's'} will be orphaned — their columns are no\n` +
        `longer exposed by any live version. You must then delete these fields:\n\n`
    )
    for (const o of orphans) {
      process.stdout.write(`  ${o.file}\n    ${o.message}\n\n`)
    }
    process.stdout.write(
      'Until you do, `manguito validate` will report ORPHANED_TOMBSTONE. Deleting them\n' +
        'shrinks the union and lets the next migration DROP those columns.\n\n'
    )
  }

  if (options.yes !== true) {
    const ok = await deps.prompt.confirm(`Retire ${version}?`)
    if (!ok) {
      process.stdout.write('Cancelled. Nothing was deleted.\n')
      return
    }
  }

  const versionsDir = path.join(ctx.schema.base_path, 'versions')
  try {
    retireSnapshotDir(versionsDir, version)
  } catch (err) {
    printGuidedError(
      `Failed to retire ${version}: ${err instanceof Error ? err.message : String(err)}`,
      'The snapshot is renamed out of the way before it is deleted, so the version is either fully retired or untouched.'
    )
    process.exit(1)
  }

  printSuccess(`Retired ${version}`)
  if (orphans.length > 0) {
    process.stdout.write(`\nDelete the ${orphans.length} orphaned tombstone field(s) listed above.\n`)
  }
}
```

Add `type ParseError` to the core import and `retireSnapshotDir` to the `version-fs.js` import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-guards.test.ts src/__tests__/version-fs.test.ts`
Expected: PASS — 6 guard tests plus 7 fs tests.

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` — expect at least 94 passed (86 + 6 guard tests + 2 fs tests).
Run: `pnpm --filter @bobbykim/manguito-cms-cli lint` and `build` — clean.

- [ ] **Step 6: Verify the highest-snapshot guard by hand**

```bash
pnpm --filter @bobbykim/manguito-cms-cli build
cd apps/sandbox
node ../../packages/cli/dist/index.js version:cut --yes    # creates v1, working schema becomes v2
node ../../packages/cli/dist/index.js version:retire v1     # must REFUSE — v1 is the highest
rm -rf schemas/versions
```

Expected: the retire refuses, and the hint says cutting first makes `v1` retirable. This is the guard that stops a version number being silently republished — paste the output into your report and confirm `git status` in `apps/sandbox` is clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): add version:retire"
```

---

## Task 8: Documentation and changeset

**Files:**
- Modify: `packages/core/CONTEXT.md` (the `### Versioning` glossary)
- Modify: `packages/cli/CONTEXT.md`
- Create: `.changeset/cli-version-lifecycle.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add to core's versioning glossary**

In `packages/core/CONTEXT.md`, in the `### Versioning` section, add an entry in the file's existing format (bold term, description, `_Avoid_:` line):

```markdown
**Change classification**:
What `describeSchemaChange` produces: per type, the fields that differ between an older version and a newer one, keyed by **column** so a rename reads as a rename rather than as a delete plus an add. A valid model admits exactly four kinds — `added`, `renamed`, `tombstoned`, `restored`. Two more are unreachable: a column the older version exposes that is missing from the newer one is already `VERSION_COLUMN_MISSING`, and a retype is already `FIELD_TYPE_CHANGED_WHILE_LIVE`. So if the model loads, cutting is always safe.
_Avoid_: diff, delta
```

- [ ] **Step 2: Document the commands in the CLI's context**

Read `packages/cli/CONTEXT.md` first and follow whatever structure it already uses. Add the three commands, and these two facts, which are the ones a reader cannot infer:

- **Retirement is two steps, and neither order is valid.** Deleting a tombstone while its version is live is `VERSION_COLUMN_MISSING`; retiring while the tombstone remains is `ORPHANED_TOMBSTONE`. `version:retire` deletes the snapshot and names the fields to delete next — it does not edit schema files, because the CLI writes only to generated locations.
- **`version:retire` refuses the highest-numbered snapshot.** `current` is derived as highest + 1, so retiring it would renumber the working schema onto an already-published number. Cutting first makes it retirable.

- [ ] **Step 3: Write the changeset**

```markdown
---
'@bobbykim/manguito-cms-core': minor
'@bobbykim/manguito-cms-cli': minor
---

Add the schema version lifecycle to the CLI: `version:diff` shows what cutting would freeze, `version:cut` freezes the working schema as a new version after confirmation, and `version:retire <version>` stops serving a cut version.

Core gains two exports the commands need: `describeSchemaChange`, a pure classification of the difference between two schema versions keyed by column (so a rename reads as a rename, not as a delete plus an add), and `loadVersionSnapshots`, extracted from what `loadVersionModel` already did internally so a caller can reach a snapshot's registry.

`version:retire` refuses to retire the highest-numbered snapshot: `current` is derived as highest + 1, so retiring it would renumber the working schema onto an already-published version number, and a consumer pinned to it would silently receive a different contract. Cutting first makes it retirable.
```

- [ ] **Step 4: Verify the whole monorepo**

Run: `pnpm test --force` — expect 11/11 tasks.
Run: `pnpm build` — 7/7.
Run: `pnpm lint` — 7/7.

- [ ] **Step 5: Commit**

```bash
git add -A packages/core/CONTEXT.md packages/cli/CONTEXT.md .changeset
git commit -m "docs(cli): document the version lifecycle commands"
```

---

## Residuals

- **Five commands still build the registry inline** (`dev`, `start`, `migrate`, `validate`, `build`). Task 3 adds `loadWorkingRegistry` and uses it only in new code. Converting the other five is a separate pass, and `validate.ts` is not a candidate: it deliberately collects every error and continues, so it is a different function, not a duplicate.
- **`VersionModel.current` is derived, never persisted.** `version:cut` writes no version marker — the snapshot directories are the truth.
- **A tab whose every field is tombstoned renders as an empty tab in the admin.** Cosmetic; recorded when tombstones were excluded from the admin.
- **2d (versioned routes)** consumes `model.projections` and must build its per-version field-key maps from those rather than from current's fields. **2e (GraphQL)** derives `@deprecated` retained fields from the same projections.

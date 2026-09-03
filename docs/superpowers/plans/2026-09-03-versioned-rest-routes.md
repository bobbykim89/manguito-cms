# Versioned Public REST Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every live version of the public read contract at its own route prefix, driven by the version model's projections, with a retired version answering 410 rather than a bare 404.

**Architecture:** `manguito build` bakes a reduced version model beside the registry; `createCmsApp` takes it as an optional option and registers the content/taxonomy registrator once per live version with version-scoped field-key maps, projectors and repositories, plus one unversioned pass at the latest version and a guarded catch-all that classifies non-live versions. Media and OpenAPI stay unversioned, enforced by splitting the paths module so versioning them is unexpressible.

**Tech Stack:** TypeScript strict, Hono, Vitest, Drizzle/Postgres. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-03-versioned-rest-routes-design.md`](../specs/2026-09-03-versioned-rest-routes-design.md)

## Global Constraints

- **Layer boundaries, never crossed:** `core` imports nothing from `db`, `api`, `admin` or `cli`. `db` imports only from `core`. `api` imports from `core` and `db`. `cli` imports from all. **This plan changes no file in `packages/core`.**
- **No new dependencies** in any package.
- **TypeScript only.** Never create a `.js` source file.
- **HTTP responses always use the envelope** `{ ok, data }` for success and `{ ok, error: { code, message } }` for failure.
- **Never throw for an expected failure** — use `Result<T>` where a Result is in play. The documented exceptions in this area are pre-existing: `createFieldKeyMap` throws at startup on an ambiguous mapping (the server must not boot with one), and a CLI handler prints then calls `process.exit(1)`.
- **Import conventions are deliberately non-uniform:** **all of `packages/api/src/` and `packages/cli/src/` use explicit `.js`** on relative imports. `packages/core/src/parser/` and `registry/` use extensionless. Match the directory you are editing.
- **A fallback substitutes only for `null`/`undefined`.** `0`, `''` and `false` are legitimate stored values.
- **`VersionProjection` shape** (from core, unchanged): `{ version: string; types: Record<string, { fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }> }> }`.
- **The baked model is reduced:** `Omit<VersionModel, 'union'>` — `{ current: string; live: string[]; projections: Record<string, VersionProjection> }`. `union` **is** the current registry, which `createCmsApp` already receives, so baking it would duplicate the whole registry in the bundle.
- **Test commands.** Never bare `vitest` — each package's script wraps it in `dotenv -e .env.test`, and skipping that aborts with a misleading "DB_URL not set in .env.test". Use `pnpm --filter @bobbykim/manguito-cms-api test`, `pnpm --filter @bobbykim/manguito-cms-cli test`. Narrow to one file by appending a path relative to the package.
- **The test database runs on port 5435.** `packages/api`'s integration tests need it: run `pnpm db:test:up` if they cannot connect.
- **Also run lint** before each commit: `pnpm --filter <pkg> lint`. An unused import is an eslint error here and has slipped past review before.
- **`packages/api` resolves `core` through its built `dist`**, so a core change would need a core rebuild. This plan changes no core file, so no rebuild is needed — but `packages/cli` resolves `api` the same way, so **Task 7 needs `pnpm --filter @bobbykim/manguito-cms-api build` first** to see Task 6's new option type.
- **Baseline at the start of this plan:** api 363 passed; cli 96 passed; core 245 passed / 2 todo; monorepo `pnpm test` 11/11, `pnpm build` 7/7, `pnpm lint` 7/7.
- **Commit style:** conventional commits, `type(scope): subject`, scope `api` or `cli`.
- **Never commit to `master`.** All work lands on `docs/versioned-rest-routes` (already checked out, already holds the spec commit).

---

## File Structure

**API — modified:**
- `packages/api/src/paths.ts` — split: `createPublicPaths(prefix)` keeps the fixed surface (media, openapi); `createVersionedPaths(prefix, version)` returns the four schema-driven builders. The type split is what makes versioning media unexpressible.
- `packages/api/src/field-keys.ts` — add `createFieldKeyMapFromProjection`.
- `packages/api/src/projector.ts` — fallback substitution.
- `packages/api/src/routes/content.ts` — parameter type only (`PublicPaths` → `VersionedPaths`).
- `packages/api/src/app.ts` — the `versions?` option, the registration loop, the unversioned pass, the catch-all, the header middleware.

**API — new:**
- `packages/api/src/versions.ts` — `classifyVersion`, `buildVersionSurface`, `deprecationHeaders`. Everything version-aware that is not routing, so `app.ts` stays a composition root.
- Tests: `packages/api/src/__tests__/versions.test.ts`, and cases added to the existing `paths.test.ts`, `field-keys.test.ts`, `projector.test.ts`.
- `packages/api/src/__tests__/versioned-routes.integration.test.ts` — the properties that only a real app and a real database can show.

**CLI — new/modified:**
- `packages/cli/src/codegen/version-model.ts` — writes `.manguito/version-model.ts`.
- `packages/cli/src/commands/build.ts` — compute and bake.
- `packages/cli/src/codegen/server-entries.ts` — import and pass it.

**Documentation:** `packages/api/CONTEXT.md`, one changeset.

**Deliberately NOT modified:** `packages/api/src/routes/media.ts` beyond nothing at all — it already takes `PublicPaths`, which after the split is exactly the fixed surface it uses. No core file.

---

## Task 1: Split the paths module

**Files:**
- Modify: `packages/api/src/paths.ts`
- Modify: `packages/api/src/routes/content.ts:37-45` (parameter type)
- Modify: `packages/api/src/app.ts:72` and its OpenAPI block (~277-304)
- Test: `packages/api/src/__tests__/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PublicPaths = { mediaCollection(): string; mediaItem(): string; openapi(): string }`
  - `type VersionedPaths = { collection(basePath: string): string; item(basePath: string): string; taxonomyCollection(typeName: string): string; taxonomyItem(typeName: string): string }`
  - `createPublicPaths(prefix: string): PublicPaths`
  - `createVersionedPaths(prefix: string, version: string | null): VersionedPaths`
  - `normalizePrefix` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/__tests__/paths.test.ts` (keep its existing `normalizePrefix` and `createPublicPaths` cases; the latter will need its content/taxonomy assertions moved to `createVersionedPaths`):

```typescript
describe('createVersionedPaths', () => {
  it('inserts the version segment after the prefix', () => {
    const p = createVersionedPaths('/api', 'v2')
    expect(p.collection('blog')).toBe('/api/v2/blog')
    expect(p.item('blog')).toBe('/api/v2/blog/:slug')
    expect(p.taxonomyCollection('taxonomy--tag')).toBe('/api/v2/taxonomy/taxonomy--tag')
    expect(p.taxonomyItem('taxonomy--tag')).toBe('/api/v2/taxonomy/taxonomy--tag/:id')
  })

  it('omits the segment entirely when the version is null', () => {
    // The unversioned pass uses this, and its paths must be byte-identical to
    // what the app served before versioning existed — otherwise every existing
    // consumer breaks.
    const p = createVersionedPaths('/api', null)
    expect(p.collection('blog')).toBe('/api/blog')
    expect(p.item('blog')).toBe('/api/blog/:slug')
    expect(p.taxonomyCollection('taxonomy--tag')).toBe('/api/taxonomy/taxonomy--tag')
    expect(p.taxonomyItem('taxonomy--tag')).toBe('/api/taxonomy/taxonomy--tag/:id')
  })

  it('honours a custom prefix', () => {
    const p = createVersionedPaths('/content-api', 'v1')
    expect(p.collection('blog')).toBe('/content-api/v1/blog')
  })
})

describe('createPublicPaths', () => {
  it('keeps only the fixed surface, which never takes a version', () => {
    const p = createPublicPaths('/api')
    expect(p.mediaCollection()).toBe('/api/media')
    expect(p.mediaItem()).toBe('/api/media/:id')
    expect(p.openapi()).toBe('/api/openapi.json')
  })

  it('does not expose the schema-driven builders', () => {
    // The split is the enforcement: versioning media must be unexpressible,
    // not merely discouraged. If these ever reappear here, a caller can
    // accidentally build a versioned media path again.
    const p = createPublicPaths('/api') as Record<string, unknown>
    expect(p['collection']).toBeUndefined()
    expect(p['taxonomyCollection']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/paths.test.ts`
Expected: FAIL — `createVersionedPaths` is not exported, so the file does not compile.

- [ ] **Step 3: Rewrite `paths.ts`**

```typescript
// ─── Public route path construction ───────────────────────────────────────────
//
// The single place public route paths are built. Registrators must not hardcode
// '/api/...': the prefix is configurable (api.prefix), and the schema-driven
// surface carries a version segment.
//
// The two shapes are separate types on purpose. Content and taxonomy are
// schema-driven and therefore versioned; media and the OpenAPI document are
// not — MediaItem is a fixed shape the schema never touches, so a version
// segment would duplicate byte-identical routes per live version. Keeping them
// in different types makes versioning media UNEXPRESSIBLE rather than merely
// discouraged.

export function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return '/api'
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed === '' ? '/api' : trimmed
}

/** The fixed public surface. Never versioned. */
export type PublicPaths = {
  mediaCollection(): string
  mediaItem(): string
  openapi(): string
}

/** The schema-driven public surface. Versioned, or unversioned when `version` is null. */
export type VersionedPaths = {
  collection(basePath: string): string
  item(basePath: string): string
  taxonomyCollection(typeName: string): string
  taxonomyItem(typeName: string): string
}

export function createPublicPaths(prefix: string): PublicPaths {
  return {
    mediaCollection: () => `${prefix}/media`,
    mediaItem: () => `${prefix}/media/:id`,
    openapi: () => `${prefix}/openapi.json`,
  }
}

/**
 * `version` null means no segment — the unversioned pass, whose paths must be
 * byte-identical to what the app served before versioning existed.
 */
export function createVersionedPaths(prefix: string, version: string | null): VersionedPaths {
  const root = version === null ? prefix : `${prefix}/${version}`
  return {
    collection: (basePath) => `${root}/${basePath}`,
    item: (basePath) => `${root}/${basePath}/:slug`,
    taxonomyCollection: (typeName) => `${root}/taxonomy/${typeName}`,
    taxonomyItem: (typeName) => `${root}/taxonomy/${typeName}/:id`,
  }
}
```

- [ ] **Step 4: Update the two consumers**

In `packages/api/src/routes/content.ts`, change the import and the parameter type — this registrator uses only the four schema-driven builders (verified: `collection`, `item`, `taxonomyCollection`, `taxonomyItem`):

```typescript
import type { VersionedPaths } from '../paths.js'
```

and in the signature at line ~42, `paths: PublicPaths` becomes `paths: VersionedPaths`.

`packages/api/src/routes/media.ts` needs **no change** — it already imports `PublicPaths` and uses only `mediaCollection` and `mediaItem`.

In `packages/api/src/app.ts`, replace line ~72 with both:

```typescript
  const publicPaths = createPublicPaths(prefix)
  // Task 6 replaces this single call with a per-version loop. Until then the
  // unversioned shape keeps the app's behaviour identical.
  const versionedPaths = createVersionedPaths(prefix, null)
```

Update the import to `import { normalizePrefix, createPublicPaths, createVersionedPaths } from './paths.js'`, pass `versionedPaths` to `registerPublicContentRoutes`, and in the OpenAPI block (~277-304) use `versionedPaths` for the content and taxonomy entries while `publicPaths` keeps the media and openapi entries.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/paths.test.ts`
Expected: PASS.

Run: `pnpm --filter @bobbykim/manguito-cms-api test` — expect at least 363, and nothing regressed. This is a pure refactor of path construction: every existing integration test asserts against real URLs, so a mistake here shows up immediately as a 404 in an unrelated suite. If one fails, the path shape changed — fix `paths.ts`, not the test.

Run: `pnpm --filter @bobbykim/manguito-cms-api lint` — clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src
git commit -m "refactor(api): split the versioned and fixed public path surfaces"
```

---

## Task 2: `classifyVersion`

**Files:**
- Create: `packages/api/src/versions.ts`
- Test: `packages/api/src/__tests__/versions.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BakedVersionModel = { current: string; live: string[]; projections: Record<string, VersionProjection> }`
  - `type VersionClass = 'not-a-version' | 'live' | 'retired' | 'unknown'`
  - `classifyVersion(segment: string, model: BakedVersionModel): VersionClass`

`BakedVersionModel` is the type Tasks 5, 6 and 7 all use. Define it here, in the module that owns version awareness.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/api/src/__tests__/versions.test.ts
import { describe, it, expect } from 'vitest'
import { classifyVersion, type BakedVersionModel } from '../versions.js'

/** Live v1 and v3 (v2 retired), working schema v4. */
const MODEL: BakedVersionModel = {
  current: 'v4',
  live: ['v1', 'v3', 'v4'],
  projections: {},
}

describe('classifyVersion', () => {
  it('classifies a live version as live', () => {
    expect(classifyVersion('v1', MODEL)).toBe('live')
    expect(classifyVersion('v3', MODEL)).toBe('live')
  })

  it('classifies the current version as live', () => {
    expect(classifyVersion('v4', MODEL)).toBe('live')
  })

  it('classifies a gap below current as retired', () => {
    // v2 is not live and is below v4, so it was cut and later retired.
    expect(classifyVersion('v2', MODEL)).toBe('retired')
  })

  it('classifies a number above current as unknown', () => {
    // v5 was never cut — `current` is highest snapshot + 1, so nothing at or
    // above it can ever have existed.
    expect(classifyVersion('v5', MODEL)).toBe('unknown')
    expect(classifyVersion('v99', MODEL)).toBe('unknown')
  })

  it('classifies a non-version segment as not-a-version', () => {
    // This is what protects /api/media/:id from the catch-all. Without it the
    // catch-all would answer 404 VERSION_NOT_FOUND for every media request.
    expect(classifyVersion('media', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v', MODEL)).toBe('not-a-version')
    expect(classifyVersion('vX', MODEL)).toBe('not-a-version')
    expect(classifyVersion('1', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v1x', MODEL)).toBe('not-a-version')
  })

  it('treats a leading-zero version as its own segment, not a live alias', () => {
    // 'v01' parses to 1 but is not the string 'v1', so it is not live. It is
    // below current, so it reads as retired rather than as v1's contract —
    // which is right: serving v1's data at a URL v1 never published would be
    // worse than a 410.
    expect(classifyVersion('v01', MODEL)).toBe('retired')
  })

  it('handles the single-version zero-config model', () => {
    const solo: BakedVersionModel = { current: 'v1', live: ['v1'], projections: {} }
    expect(classifyVersion('v1', solo)).toBe('live')
    expect(classifyVersion('v2', solo)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/versions.test.ts`
Expected: FAIL — `../versions.js` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/versions.ts
import type { VersionProjection } from '@bobbykim/manguito-cms-core'

// ─── The baked version model ──────────────────────────────────────────────────
//
// What `manguito build` writes into .manguito/version-model.ts and the
// generated server entry passes to createCmsApp.
//
// This is `Omit<VersionModel, 'union'>`. The union IS the current registry
// (`union === current` in core, by reference), and createCmsApp already
// receives that registry — so baking the union too would duplicate the whole
// registry in the generated bundle, and the reference identity that made it
// free in memory does not survive serialization.
export type BakedVersionModel = {
  /** e.g. 'v4' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /** Keyed by version name. */
  projections: Record<string, VersionProjection>
}

export type VersionClass = 'not-a-version' | 'live' | 'retired' | 'unknown'

const VERSION_SEGMENT = /^v\d+$/

function versionNumber(version: string): number {
  return Number.parseInt(version.slice(1), 10)
}

/**
 * What a URL's version segment is.
 *
 * The retired/unknown split is arithmetic on the model alone, with nothing
 * persisted: `current` is the highest snapshot plus one, so a number BELOW it
 * that is not live must have been cut and later retired, while a number at or
 * above it was never cut. A retired version answering 404 would read as "wrong
 * URL" and send a pinned consumer hunting for a typo instead of upgrading.
 *
 * `not-a-version` is load-bearing, not defensive: media stays unversioned, so
 * the catch-all sees `/api/media/:id` too and must fall through for it.
 */
export function classifyVersion(segment: string, model: BakedVersionModel): VersionClass {
  if (!VERSION_SEGMENT.test(segment)) return 'not-a-version'
  if (model.live.includes(segment)) return 'live'
  return versionNumber(segment) < versionNumber(model.current) ? 'retired' : 'unknown'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/versions.test.ts`
Expected: PASS, 7 tests.

Run: `pnpm --filter @bobbykim/manguito-cms-api lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): classify a URL's version segment"
```

---

## Task 3: Build a field-key map from a projection

**Files:**
- Modify: `packages/api/src/field-keys.ts`
- Test: `packages/api/src/__tests__/field-keys.test.ts`

**Interfaces:**
- Consumes: `VersionProjection` from core.
- Produces: `createFieldKeyMapFromProjection(projectionType: { fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }> }, allFields: ParsedField[]): FieldKeyMap`

**Why two arguments.** A projection is already the label↔column mapping, so no `isColumnBacked` filter and no tombstone exclusion are needed — projections exclude both. But `createFieldKeyMap`'s collision check deliberately runs over **every** field's label, not just the column-backed subset: a paragraph, many-to-many or programmatic field's label is written into the same key space as storage columns before `toLabels` runs, so a paragraph field named after another field's column would overwrite that column's value on the row and then be renamed onto the other field's label. A projection contains none of those fields, so that collision would go undetected. Hence `allFields` — the projection supplies the mapping, the registry's fields supply the label space the check needs.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/__tests__/field-keys.test.ts`. It already imports fixtures from `../field-keys.test-fixtures.js` — reuse them, and read that file first to see which typed `ParsedField` literals exist.

```typescript
describe('createFieldKeyMapFromProjection', () => {
  const projection = {
    fields: [
      { column_name: 'blog_title', exposed_as: 'title' },
      { column_name: 'summary', exposed_as: 'summary' },
    ],
  }

  it('maps a label to the column the projection names', () => {
    // The rename case: the projection says v1 exposes column blog_title under
    // the name 'title'. A name-keyed implementation would map title -> title.
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.columnFor('title')).toBe('blog_title')
    expect(map.labelFor('blog_title')).toBe('title')
  })

  it('maps a row back to that version's labels', () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.toLabels({ blog_title: 'Hi', summary: 'S' })).toEqual({ title: 'Hi', summary: 'S' })
  })

  it('maps a request body forward to storage keys', () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect(map.toStorage({ title: 'Hi' })).toEqual({ blog_title: 'Hi' })
  })

  it('reports the projection's labels as the filter and sort surface', () => {
    const map = createFieldKeyMapFromProjection(projection, [])
    expect([...map.labels].sort()).toEqual(['summary', 'title'])
  })

  it('reports diverges when a label differs from its column', () => {
    expect(createFieldKeyMapFromProjection(projection, []).diverges).toBe(true)
    const identity = { fields: [{ column_name: 'title', exposed_as: 'title' }] }
    expect(createFieldKeyMapFromProjection(identity, []).diverges).toBe(false)
  })

  it('still throws when a NON-projected field's label collides with a column', () => {
    // The reason this constructor takes allFields at all. A paragraph field is
    // absent from every projection (it has no column), but its label reaches
    // the same key space as storage columns before toLabels runs — so a
    // paragraph field named 'blog_title' would overwrite that column's value
    // and then be renamed onto 'title'. The projection alone cannot see it.
    const paragraphNamedAfterAColumn = {
      name: 'blog_title',
      label: 'Cards',
      field_type: 'paragraph' as const,
      required: false,
      nullable: true,
      order: 9,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed' as const, ref: 'paragraph--card', rel: 'one-to-many' as const },
    }
    expect(() => createFieldKeyMapFromProjection(projection, [paragraphNamedAfterAColumn])).toThrow(
      /collides with the storage column/
    )
  })

  it('does not throw when allFields is consistent with the projection', () => {
    const ordinaryParagraph = {
      name: 'cards',
      label: 'Cards',
      field_type: 'paragraph' as const,
      required: false,
      nullable: true,
      order: 9,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed' as const, ref: 'paragraph--card', rel: 'one-to-many' as const },
    }
    expect(() => createFieldKeyMapFromProjection(projection, [ordinaryParagraph])).not.toThrow()
  })
})
```

If the inline `ParsedField` literals do not typecheck, `field-keys.test-fixtures.ts` builds fully-typed ones with no cast — add the two there instead and import them, matching that file's existing approach.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-keys.test.ts`
Expected: FAIL — `createFieldKeyMapFromProjection` is not exported.

- [ ] **Step 3: Refactor `field-keys.ts` so both constructors share one core**

Read the existing `createFieldKeyMap` first. Extract its body from the point the two maps are built onwards into a shared internal builder, then express both public constructors in terms of it. The collision check, the `diverges` computation and `remap` must not be duplicated — this is the same logic reached two ways.

```typescript
/**
 * The shared core: given a label↔column mapping and the FULL label space to
 * check against, produce a FieldKeyMap.
 *
 * `allLabels` is every field's label, including fields with no column of their
 * own. That is not tidiness: a paragraph, many-to-many or programmatic field's
 * label is written into the same key space as storage columns before toLabels
 * runs, so one named after another field's column would overwrite that
 * column's value and then be renamed onto the other field's label. Both
 * constructors must pass the complete set.
 */
function buildFieldKeyMap(
  pairs: Array<{ label: string; column: string }>,
  allLabels: string[],
  droppedKeys: Set<string>
): FieldKeyMap {
  // ... the existing body, with labelToColumn/columnToLabel built from `pairs`,
  // the collision loop iterating `allLabels`, and remap skipping `droppedKeys`.
}

/**
 * From a version's projection. The projection is already the label↔column
 * mapping and already excludes tombstones and non-column-backed fields, so
 * there is nothing to filter — but the collision check still needs every
 * field's label, which is why `allFields` is required.
 */
export function createFieldKeyMapFromProjection(
  projectionType: { fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }> },
  allFields: ParsedField[]
): FieldKeyMap {
  const pairs = projectionType.fields.map((f) => ({ label: f.exposed_as, column: f.column_name }))
  const projected = new Set(pairs.map((p) => p.label))
  // A tombstone's column is absent from the projection but present on the row,
  // and remap passes unknown keys through — so it must be actively dropped,
  // exactly as createFieldKeyMap does for the current version.
  const dropped = new Set<string>()
  for (const f of allFields) {
    if (f.removed !== true) continue
    dropped.add(f.name)
    if (f.db_column !== null) dropped.add(f.db_column.column_name)
  }
  // A retained column this version DOES expose must not be dropped.
  for (const p of pairs) dropped.delete(p.column)
  for (const label of projected) dropped.delete(label)

  return buildFieldKeyMap(pairs, allFields.map((f) => f.name), dropped)
}
```

Keep `createFieldKeyMap`'s public behaviour and signature exactly as they are; it is called from `app.ts` and from GraphQL.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-keys.test.ts`
Expected: PASS, including every pre-existing case. `createFieldKeyMap` is heavily tested — if one of its tests fails, the shared extraction changed its behaviour. Fix the extraction, not the test.

Run: `pnpm --filter @bobbykim/manguito-cms-api test` and `lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): build a field key map from a version projection"
```

---

## Task 4: Serve a tombstone's fallback

**Files:**
- Modify: `packages/api/src/projector.ts`
- Test: `packages/api/src/__tests__/projector.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap` (unchanged).
- Produces: `buildProjectors(registry, fieldKeyMaps, fallbacks?)` where `fallbacks?: Record<string, Record<string, unknown>>` is keyed by type name then **label** — the key the value is served under after `toLabels` has run.

**Why keyed by label.** Substitution happens after the row is mapped to labels, so keying by label needs no second lookup. The caller derives it from the projection, which carries both names.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/__tests__/projector.test.ts`, reusing its existing registry and map fixtures:

```typescript
describe('projectRow — fallbacks', () => {
  // Mirrors this file's existing PROJECTORS literal. `divergentTextField`
  // exposes the label 'title' on column 'blog_title', so the fallback is keyed
  // by LABEL — substitution happens after toLabels has run.
  const WITH_FALLBACK: Projectors = {
    post: {
      map: createFieldKeyMap([divergentTextField]),
      nested: [],
      fallbacks: { title: 'no title' },
    },
  }

  it('substitutes the fallback when the retained column is null', () => {
    // A retained column reads null for every row written since the tombstone.
    // Left as null it would tell an older live version's consumer "no value"
    // rather than serving the coherent shape the fallback exists to provide.
    const out = projectRow({ id: 'p1', blog_title: null }, 'post', WITH_FALLBACK)
    expect(out).toEqual({ id: 'p1', title: 'no title' })
  })

  it('substitutes when the column is absent from the row entirely', () => {
    const out = projectRow({ id: 'p1' }, 'post', WITH_FALLBACK)
    expect(out['title']).toBe('no title')
  })

  it('does NOT substitute for 0, empty string or false', () => {
    // The trap. All three are legitimate stored values and replacing them
    // would silently destroy real data.
    const zero: Projectors = {
      post: { map: createFieldKeyMap([divergentTextField]), nested: [], fallbacks: { title: 'FB' } },
    }
    expect(projectRow({ blog_title: 0 }, 'post', zero)['title']).toBe(0)
    expect(projectRow({ blog_title: '' }, 'post', zero)['title']).toBe('')
    expect(projectRow({ blog_title: false }, 'post', zero)['title']).toBe(false)
  })

  it('leaves a column with a real value untouched', () => {
    const out = projectRow({ id: 'p1', blog_title: 'Hi' }, 'post', WITH_FALLBACK)
    expect(out['title']).toBe('Hi')
  })

  it('is a no-op when no fallback is declared for the type', () => {
    // The zero-config path: every existing response must be byte-identical.
    const none: Projectors = { post: { map: createFieldKeyMap([divergentTextField]), nested: [] } }
    expect(projectRow({ id: 'p1', blog_title: null }, 'post', none)).toEqual({ id: 'p1', title: null })
  })
})
```

Add `fallbacks?: Record<string, unknown>` to the `TypeProjector` type so the literals above typecheck.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/projector.test.ts`
Expected: FAIL — `buildProjectors` takes two arguments, so the three-argument calls do not typecheck.

- [ ] **Step 3: Implement**

Add the optional third parameter to `buildProjectors`, carry the per-type fallback record onto each `TypeProjector`, and apply it in `projectRow` immediately after `p.map.toLabels(row)`:

```typescript
  const out = p.map.toLabels(row)

  // A retained column reads null for every row written since the tombstone.
  // Substituting the declared fallback is what lets an older live version keep
  // serving a coherent shape. ONLY for null/undefined: 0, '' and false are
  // legitimate stored values, and replacing them would destroy real data.
  if (p.fallbacks !== undefined) {
    for (const [label, value] of Object.entries(p.fallbacks)) {
      if (out[label] === null || out[label] === undefined) out[label] = value
    }
  }
```

`toLabels` returns a fresh object, so mutating `out` here is safe — the existing comment in `projectRow` says so.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/projector.test.ts`
Expected: PASS.

Run: `pnpm --filter @bobbykim/manguito-cms-api test` and `lint` — clean. Every existing projector test must still pass: with no fallbacks the path is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): serve a retained column's fallback"
```

---

## Task 5: The version-scoped surface

**Files:**
- Modify: `packages/api/src/versions.ts`
- Test: `packages/api/src/__tests__/versions.test.ts`

**Interfaces:**
- Consumes: `classifyVersion`, `BakedVersionModel` (Task 2); `createFieldKeyMapFromProjection` (Task 3); `buildProjectors` (Task 4); `createVersionedPaths` (Task 1).
- Produces:

```typescript
buildVersionSurface(input: {
  version: string | null      // null = the unversioned pass
  projectionVersion: string   // which projection to use; for the unversioned pass, model.current
  prefix: string
  registry: SchemaRegistry
  model: BakedVersionModel
  makeRepo: (typeName: string, tableName: string, sortableColumns: Set<string>) => ContentRepository<Row>
}): {
  paths: VersionedPaths
  fieldKeyMaps: Record<string, FieldKeyMap>
  projectors: Projectors
  repos: Record<string, ContentRepository<Row>>
}
```

`makeRepo` is injected rather than constructed here so this module needs no database import — it stays testable without one, and `app.ts` keeps ownership of repository construction.

**Why repositories are per-version.** `sortableColumnsFor` maps `SORTABLE_FIELDS`' labels through the field-key map to storage columns and bakes the result into each repository as a `sortableColumns` guard. Once the map is per-version, so is that set: a rename moves `title`'s column, so two live versions legitimately sort by different columns. A repository is a closure over a db handle, a table name and that option, so types × versions is a handful of cheap objects.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api/src/__tests__/versions.test.ts`:

```typescript
// A registry whose CURRENT schema exposes column `blog_title` under the name
// `title` — the rename case. Built through core's real parser via the shared
// helper below so `db_column.column_name` genuinely diverges from `name`;
// hand-forging it would make name and column identical and these tests could
// not tell column-keying from name-keying.
const REGISTRY = makeRegistryFixture()   // see the helper at the top of this file

const MODEL: BakedVersionModel = {
  current: 'v2',
  live: ['v1', 'v2'],
  projections: {
    // v1 exposed the column under its own name.
    v1: { version: 'v1', types: { 'content--post': { fields: [
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ] } } },
    // v2 exposes the same column under the new name.
    v2: { version: 'v2', types: { 'content--post': { fields: [
      { column_name: 'blog_title', exposed_as: 'title' },
    ] } } },
  },
}

/** Captures every makeRepo call so the sortable-columns claim is checkable without a database. */
function capturingMakeRepo() {
  const calls: Array<{ typeName: string; tableName: string; sortableColumns: Set<string> }> = []
  const makeRepo = (typeName: string, tableName: string, sortableColumns: Set<string>) => {
    calls.push({ typeName, tableName, sortableColumns })
    return {} as never
  }
  return { calls, makeRepo }
}

describe('buildVersionSurface', () => {
  it('builds paths under the version, and maps from that version's projection', () => {
    const { makeRepo } = capturingMakeRepo()
    const v1 = buildVersionSurface({
      version: 'v1', projectionVersion: 'v1', prefix: '/api',
      registry: REGISTRY, model: MODEL, makeRepo,
    })

    expect(v1.paths.collection('post')).toBe('/api/v1/post')
    // The load-bearing assertion: v1's map resolves v1's LABEL to the column,
    // not current's label. An implementation reading current's fields would
    // give columnFor('blog_title') === undefined here.
    expect(v1.fieldKeyMaps['content--post']!.columnFor('blog_title')).toBe('blog_title')
    expect(v1.fieldKeyMaps['content--post']!.columnFor('title')).toBeUndefined()
  })

  it('gives each version its own map for the same column', () => {
    const { makeRepo } = capturingMakeRepo()
    const shared = { prefix: '/api', registry: REGISTRY, model: MODEL, makeRepo }
    const v1 = buildVersionSurface({ version: 'v1', projectionVersion: 'v1', ...shared })
    const v2 = buildVersionSurface({ version: 'v2', projectionVersion: 'v2', ...shared })

    // One column, two labels — the whole feature, at the map level.
    expect(v1.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('blog_title')
    expect(v2.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('title')
  })

  it('derives sortable columns from THIS version's map, not current's', () => {
    // Why repositories are per-version. SORTABLE_FIELDS includes 'title'; in v2
    // that label maps to column blog_title, in v1 it does not exist as a label
    // at all — so the two versions' guards legitimately differ.
    const a = capturingMakeRepo()
    buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: MODEL, makeRepo: a.makeRepo })
    const b = capturingMakeRepo()
    buildVersionSurface({ version: 'v2', projectionVersion: 'v2', prefix: '/api', registry: REGISTRY, model: MODEL, makeRepo: b.makeRepo })

    const setFor = (calls: typeof a.calls) =>
      [...calls.find((c) => c.typeName === 'content--post')!.sortableColumns].sort()

    expect(setFor(a.calls)).not.toEqual(setFor(b.calls))
    // v2 sorts 'title' by the real column; v1 has no such label so it falls
    // through to the literal, which the repository will then reject.
    expect(setFor(b.calls)).toContain('blog_title')
  })

  it('omits the version segment for the unversioned pass', () => {
    const { makeRepo } = capturingMakeRepo()
    const un = buildVersionSurface({
      version: null, projectionVersion: MODEL.current, prefix: '/api',
      registry: REGISTRY, model: MODEL, makeRepo,
    })
    expect(un.paths.collection('post')).toBe('/api/post')
    // It uses the CURRENT version's projection, so its labels match v2's.
    expect(un.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('title')
  })

  it('builds a repo for every content and taxonomy type', () => {
    const { calls, makeRepo } = capturingMakeRepo()
    buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: MODEL, makeRepo })
    const types = calls.map((c) => c.typeName).sort()
    expect(types).toEqual(Object.keys({ ...REGISTRY.content_types, ...REGISTRY.taxonomy_types }).sort())
  })

  it('falls back to the registry's fields for a type with no projection', () => {
    // Paragraph types have no projection — core's buildProjections iterates
    // content and taxonomy only. Their maps must still be built, from the
    // registry, or nested paragraph projection breaks entirely.
    const { makeRepo } = capturingMakeRepo()
    const s = buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: MODEL, makeRepo })
    for (const paragraphType of Object.keys(REGISTRY.paragraph_types)) {
      expect(s.fieldKeyMaps[paragraphType]).toBeDefined()
    }
  })
})
```

Add `makeRegistryFixture()` at the top of this file: build one content type (with a `column` declaration on `title` so name and column diverge), one taxonomy type and one paragraph type through core's `parseSchema` and `buildSchemaRegistry`, the way `packages/core/src/versions/__tests__/fixtures.ts` does. Core publishes only its main entry, so its internal fixtures are not importable — write the helper here and never hand-forge a `db_column`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/versions.test.ts`
Expected: FAIL — `buildVersionSurface` is not exported.

- [ ] **Step 3: Implement**

Add to `versions.ts`. Derive the fallback record for `buildProjectors` from the projection's `fallback` fields, keyed by type then label:

```typescript
function fallbacksFor(projection: VersionProjection): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [typeName, type] of Object.entries(projection.types)) {
    const perLabel: Record<string, unknown> = {}
    for (const f of type.fields) {
      if (f.fallback !== undefined) perLabel[f.exposed_as] = f.fallback
    }
    if (Object.keys(perLabel).length > 0) out[typeName] = perLabel
  }
  return out
}
```

Then `buildVersionSurface` walks the registry's content and taxonomy types, builds a map per type from `model.projections[projectionVersion].types[typeName]` (falling back to `createFieldKeyMap(type.fields)` for a type the projection omits — a paragraph type, which has no projection), builds projectors with the fallback record, and calls `makeRepo` per content and taxonomy type with `sortableColumnsFor` computed from that version's map.

**Paragraph types have no projection** (core's `buildProjections` iterates content and taxonomy only), so their maps come from the registry as they do today. That is the design's stated boundary, not an oversight — nested paragraph content follows current's shape on every version.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/versions.test.ts`
Expected: PASS.

Run: `pnpm --filter @bobbykim/manguito-cms-api test` and `lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): build a version-scoped route surface"
```

---

## Task 6: Wire the versioned routes into the app

**Files:**
- Modify: `packages/api/src/versions.ts` (add `deprecationHeaders`)
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/__tests__/versioned-routes.integration.test.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `createCmsApp` accepts `versions?: BakedVersionModel`. When absent, behaviour is exactly as today.

- [ ] **Step 1: Write the failing integration test**

Model this on `packages/api/src/__tests__/admin.integration.test.ts` — read it first. It builds a typed `SchemaRegistry` fixture by hand, creates its own uniquely-named tables with raw SQL in `beforeAll`, calls `createCmsApp` directly, and drives it with `app.request(...)`.

**The harness**, written once at the top of the file, following `admin.integration.test.ts`:

- `BLOG_TABLE = 'api_int_ver_blog'` and `BASE_PATH = 'ver-test-blog'` — unique to this suite, as every integration file uses its own names.
- A `ParsedContentType` fixture whose one field is `{ name: 'title', db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true } }` — name and column deliberately divergent, which is the only reason these tests can tell versions apart.
- `beforeAll`: create the table with raw SQL (`id uuid`, `slug varchar`, `published boolean`, `blog_title varchar`, `created_at`, `updated_at`) and insert one published row with `blog_title = 'Hello'`; `afterAll`: drop it.
- `makeApp(model?: BakedVersionModel)` calling `createCmsApp({ storage: createLocalAdapter(), registry: TEST_REGISTRY, db, versions: model })`.
- `TWO_LIVE`: `{ current: 'v3', live: ['v1', 'v3'], projections: { v1: <exposes blog_title as 'blog_title'>, v3: <exposes it as 'title'> } }`. Note `v2` is deliberately **absent** — that gap is what the 410 test needs.

```typescript
it('serves the same row under different field names per version', async () => {
  // THE feature. One row, one column, two contracts. A fixture where the two
  // versions agree would pass under an implementation that ignores versions.
  const app = makeApp(TWO_LIVE)

  const v1 = await (await app.request(`/api/v1/${BASE_PATH}`)).json()
  expect(v1.data[0]).toHaveProperty('blog_title', 'Hello')
  expect(v1.data[0]).not.toHaveProperty('title')

  const v3 = await (await app.request(`/api/v3/${BASE_PATH}`)).json()
  expect(v3.data[0]).toHaveProperty('title', 'Hello')
  expect(v3.data[0]).not.toHaveProperty('blog_title')
})

it('serves the latest shape on the unversioned path', async () => {
  const app = makeApp(TWO_LIVE)
  const body = await (await app.request(`/api/${BASE_PATH}`)).json()
  expect(body.data[0]).toHaveProperty('title', 'Hello')
})

it('sets deprecation headers on the unversioned path when more than one version is live', async () => {
  const res = await makeApp(TWO_LIVE).request(`/api/${BASE_PATH}`)
  expect(res.status).toBe(200)
  expect(res.headers.get('Deprecation')).toBe('true')
  expect(res.headers.get('Link')).toContain('/api/v3')
  expect(res.headers.get('Link')).toContain('rel="successor-version"')
  expect(res.headers.get('Warning')).toMatch(/^299 /)
})

it('sets deprecation headers on an older live version but not on the current one', async () => {
  const app = makeApp(TWO_LIVE)
  const old = await app.request(`/api/v1/${BASE_PATH}`)
  expect(old.headers.get('Deprecation')).toBe('true')
  expect(old.headers.get('Link')).toContain('/api/v3')

  const current = await app.request(`/api/v3/${BASE_PATH}`)
  expect(current.status).toBe(200)
  // A consumer on the current version has made no mistake and must get a
  // clean response — a header here would train people to ignore the header.
  expect(current.headers.get('Deprecation')).toBeNull()
})

it('answers 410 VERSION_RETIRED for a gap below current', async () => {
  const res = await makeApp(TWO_LIVE).request(`/api/v2/${BASE_PATH}`)
  expect(res.status).toBe(410)
  const body = await res.json()
  expect(body.ok).toBe(false)
  expect(body.error.code).toBe('VERSION_RETIRED')
  // Naming the live versions is what makes the response actionable.
  expect(body.error.message).toContain('v1')
  expect(body.error.message).toContain('v3')
})

it('answers 404 VERSION_NOT_FOUND for a version above current', async () => {
  const res = await makeApp(TWO_LIVE).request(`/api/v9/${BASE_PATH}`)
  expect(res.status).toBe(404)
  const body = await res.json()
  expect(body.error.code).toBe('VERSION_NOT_FOUND')
})

it('does not swallow /api/media/:id', async () => {
  // The catch-all matches ${prefix}/:version/*, so it sees this too. 'media'
  // is not version-shaped, so it must fall through to the media route. A 404
  // is fine here — that id does not exist — but the CODE must not be a
  // version error, which is what would prove the catch-all ate the request.
  const res = await makeApp(TWO_LIVE).request('/api/media/00000000-0000-0000-0000-000000000000')
  const body = await res.json().catch(() => ({}))
  expect(body?.error?.code).not.toBe('VERSION_NOT_FOUND')
  expect(body?.error?.code).not.toBe('VERSION_RETIRED')
})

it('omits deprecation headers entirely when only one version is live', async () => {
  // A project that never cut a version must see no new warnings on rebuild.
  const solo: BakedVersionModel = {
    current: 'v1',
    live: ['v1'],
    projections: { v1: { version: 'v1', types: { [TEST_TYPE_NAME]: { fields: [
      { column_name: 'blog_title', exposed_as: 'title' },
    ] } } } },
  }
  const res = await makeApp(solo).request(`/api/${BASE_PATH}`)
  expect(res.status).toBe(200)
  expect(res.headers.get('Deprecation')).toBeNull()
  expect(res.headers.get('Warning')).toBeNull()
})

it('behaves exactly as before when no versions option is passed', async () => {
  // The compatibility guarantee. No version routes, no headers, and the
  // unversioned path serving current's shape — byte-identical to today.
  const app = makeApp(undefined)
  const un = await app.request(`/api/${BASE_PATH}`)
  expect(un.status).toBe(200)
  expect((await un.json()).data[0]).toHaveProperty('title', 'Hello')
  expect(un.headers.get('Deprecation')).toBeNull()
  // /api/v1/... is not registered at all, and no catch-all exists to claim it.
  const v1 = await app.request(`/api/v1/${BASE_PATH}`)
  expect(v1.status).toBe(404)
  expect((await v1.json().catch(() => ({})))?.error?.code).not.toBe('VERSION_NOT_FOUND')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/versioned-routes.integration.test.ts`
Expected: FAIL — `createCmsApp` has no `versions` option, so the call does not typecheck. Start the database first with `pnpm db:test:up` if needed.

- [ ] **Step 3: Add `deprecationHeaders` to `versions.ts`**

```typescript
/**
 * The headers a response carries, or null for none.
 *
 * Two different mistakes get two different messages: the unversioned path
 * FLOATS and will change under the consumer when a version is cut; an older
 * live version is BEHIND. A consumer on the current version's own path has
 * made neither mistake and gets nothing.
 *
 * The unversioned path stays silent while only one version is live. The
 * warning would be technically true — cutting v2 later does move it — but it
 * is not yet actionable risk, and emitting it would nag every project that
 * never opted into versioning the moment it rebuilt.
 */
export function deprecationHeaders(input: {
  requested: string | null   // null = the unversioned path
  model: BakedVersionModel
  successor: string          // the URL to point at
}): Record<string, string> | null {
  const { requested, model, successor } = input
  const link = `<${successor}>; rel="successor-version"`

  if (requested === null) {
    // Silent while only one version is live: the warning would be technically
    // true, since cutting v2 later does move this path, but it is not yet
    // actionable risk and would nag every project that never opted in.
    if (model.live.length <= 1) return null
    return {
      Deprecation: 'true',
      Link: link,
      Warning:
        `299 - "Unversioned path resolves to the latest version (${model.current}) and will ` +
        `change when a new version is cut. Pin a version."`,
    }
  }

  // A consumer on the current version's own path has made no mistake.
  if (requested === model.current) return null

  return { Deprecation: 'true', Link: link }
}
```

The `Warning` header's `299` code is the standard "miscellaneous persistent warning"; the quoted text is part of the field's syntax, not decoration.

- [ ] **Step 4: Wire `app.ts`**

Add `versions?: BakedVersionModel` to the options type. Then, replacing the single registration:

```typescript
  // A project that never cut a version gets the identity model, so the
  // unversioned pass below is the only registration and behaviour is
  // unchanged from before versioning existed.
  const model: BakedVersionModel = options.versions ?? {
    current: 'v1',
    live: ['v1'],
    projections: {},
  }

  const makeRepo = (_typeName: string, tableName: string, sortableColumns: Set<string>) =>
    createDrizzleContentRepository(db, tableName, { sortableColumns })

  // One pass per live version, then one unversioned pass at the latest.
  const passes: Array<{ version: string | null; projectionVersion: string }> = [
    ...(options.versions !== undefined
      ? model.live.map((v) => ({ version: v, projectionVersion: v }))
      : []),
    { version: null, projectionVersion: model.current },
  ]

  for (const pass of passes) {
    const surface = buildVersionSurface({ ...pass, prefix, registry, model, makeRepo })
    const headers = deprecationHeaders({
      requested: pass.version,
      model,
      successor: createVersionedPaths(prefix, model.current).collection(''),
    })
    // Header middleware registers on this pass's exact paths — never a
    // ${prefix}/* wildcard, which would also catch /api/media where "pin a
    // version" is meaningless, and would need a guard kept in sync with the
    // catch-all's.
    if (headers !== null) { /* app.use(each of this pass's paths, mw) */ }
    registerPublicContentRoutes(app, registry, surface.repos, surface.projectors, surface.paths, listRateLimit, programmaticResolver)
  }
```

Then the catch-all, registered **after** every versioned route:

```typescript
  // Registered last. Only ever reached by a request that matched no live
  // version's routes. `not-a-version` falls through, which is what protects
  // /api/media/:id — order-independent rather than dependent on registration
  // sequence.
  if (options.versions !== undefined) {
    app.all(`${prefix}/:version/*`, async (c, next) => {
      const kind = classifyVersion(c.req.param('version'), model)
      if (kind === 'not-a-version' || kind === 'live') return next()
      const live = model.live.join(', ')
      return kind === 'retired'
        ? c.json({ ok: false, error: { code: 'VERSION_RETIRED', message: `Version ${c.req.param('version')} is no longer served. Live versions: ${live}.` } }, 410)
        : c.json({ ok: false, error: { code: 'VERSION_NOT_FOUND', message: `No version ${c.req.param('version')} is served. Live versions: ${live}.` } }, 404)
    })
  }
```

Note `publicRepos` is currently built once for the unversioned surface; the per-version `surface.repos` replaces it inside the loop. Read how `publicRepos` differs from `repos` (relation resolution is wired only for the public read surface) and preserve that distinction per version.

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @bobbykim/manguito-cms-api test` — the new suite green and **nothing regressed**. Existing integration tests build apps without `versions`, so they exercise the unchanged path; a failure there means the unversioned pass is not byte-identical.

Run: `pnpm --filter @bobbykim/manguito-cms-api lint` and `build` — clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): serve every live version at its own prefix"
```

---

## Task 7: Bake the model at build time

**Files:**
- Create: `packages/cli/src/codegen/version-model.ts`
- Modify: `packages/cli/src/commands/build.ts`
- Modify: `packages/cli/src/codegen/server-entries.ts`
- Test: `packages/cli/src/__tests__/version-model-codegen.test.ts` (create)

**Interfaces:**
- Consumes: `loadVersionSnapshots`, `computeVersionModel` from core; `resolveSchemaConfig` from `../utils/schema-config.js`.
- Produces: `generateVersionModel(model: VersionModel, targetDir: string): Promise<void>`, writing `.manguito/version-model.ts` which exports `const versionModel` of the reduced shape.

**Run `pnpm --filter @bobbykim/manguito-cms-api build` first** — `packages/cli` resolves `api` through its built `dist`, so Task 6's new `versions` option is invisible until the api is rebuilt.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/version-model-codegen.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateVersionModel } from '../codegen/version-model.js'
import type { VersionModel } from '@bobbykim/manguito-cms-core'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-vm-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

/** A model whose `union` is a distinctive object, so its absence is checkable. */
function model(projections: VersionModel['projections']): VersionModel {
  return {
    current: 'v2',
    live: ['v1', 'v2'],
    union: { UNION_SENTINEL: true } as never,
    projections,
  }
}

const SIMPLE = { v1: { version: 'v1', types: { 'content--post': { fields: [
  { column_name: 'blog_title', exposed_as: 'blog_title' },
] } } } }

describe('generateVersionModel', () => {
  it('writes a module exporting the reduced model', async () => {
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    expect(src).toContain('export const versionModel')
    expect(src).toContain('"current": "v2"')
    expect(src).toContain('"v1"')
    expect(src).toContain('projections')
  })

  it('omits the union entirely', async () => {
    // union IS the current registry, which is baked separately and which
    // createCmsApp already receives. Including it would duplicate the whole
    // registry in the generated bundle — the sentinel proves it is dropped
    // rather than merely absent from this small fixture.
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    expect(src).not.toContain('UNION_SENTINEL')
    expect(src).not.toContain('"union"')
  })

  it('round-trips every fallback type, including falsy ones', async () => {
    // A fallback is `unknown`. '' , 0 and false must survive serialization as
    // themselves — if any became null, the projector would substitute over a
    // legitimate stored value at runtime.
    const withFallbacks = { v1: { version: 'v1', types: { 'content--post': { fields: [
      { column_name: 'a', exposed_as: 'a', fallback: '' },
      { column_name: 'b', exposed_as: 'b', fallback: 0 },
      { column_name: 'c', exposed_as: 'c', fallback: false },
      { column_name: 'd', exposed_as: 'd', fallback: null },
    ] } } } }
    await generateVersionModel(model(withFallbacks as never), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')

    // Parse back the object literal the codegen embedded and compare exactly.
    const json = src.slice(src.indexOf('{', src.indexOf('export const versionModel')))
    const parsed = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1))
    const fields = parsed.projections.v1.types['content--post'].fields
    expect(fields.map((f: { fallback: unknown }) => f.fallback)).toEqual(['', 0, false, null])
  })

  it('emits a generated-file marker so nobody hand-edits it', async () => {
    await generateVersionModel(model(SIMPLE), dir)
    const src = fs.readFileSync(path.join(dir, 'version-model.ts'), 'utf8')
    expect(src).toMatch(/GENERATED/)
  })
})
```

If the JSON-slicing in the third test is brittle against the codegen's actual formatting, assert on each fallback's serialized form instead (`expect(src).toContain('"fallback": 0')` and so on) — the property that matters is that a falsy fallback survives as itself, not how the assertion reaches it.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/version-model-codegen.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the codegen**

Model it on `packages/cli/src/codegen/registry.ts`, which does the same job for the registry — read it and match its approach to serialization and formatting.

```typescript
// packages/cli/src/codegen/version-model.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VersionModel } from '@bobbykim/manguito-cms-core'

/**
 * Writes .manguito/version-model.ts.
 *
 * The api has no filesystem access to the schema at runtime — in Lambda the
 * schemas/ tree is not deployed — so the model is computed here and baked,
 * exactly as the registry is.
 *
 * `union` is deliberately omitted: it IS the current registry, which is baked
 * separately and which createCmsApp already receives, so including it would
 * duplicate the whole registry in the generated bundle.
 */
export async function generateVersionModel(model: VersionModel, targetDir: string): Promise<void> {
  const reduced = { current: model.current, live: model.live, projections: model.projections }
  const content = [
    '// GENERATED by manguito build — do not edit.',
    "import type { BakedVersionModel } from '@bobbykim/manguito-cms-api'",
    '',
    `export const versionModel: BakedVersionModel = ${JSON.stringify(reduced, null, 2)}`,
    '',
  ].join('\n')
  await writeFile(join(targetDir, 'version-model.ts'), content, 'utf8')
}
```

Export `BakedVersionModel` from `packages/api/src/index.ts` if it is not already public.

- [ ] **Step 4: Compute and bake in `build.ts`**

After the registry is built and `generateSchemaRegistry` runs (~line 124), compute the model and bake it. `build.ts` already holds `cwd` and `config`; use `resolveSchemaConfig(cwd, config)` — the second consumer of 2c's helper — so the snapshot read gets the absolute root:

```typescript
  const schema = resolveSchemaConfig(cwd, config)
  const snapshots = loadVersionSnapshots(schema, registry)
  if (!snapshots.ok) {
    printValidationErrors(snapshots.errors, 'Snapshot errors', 'manguito build')
    process.exit(1)
  }
  const versionModel = computeVersionModel({ current: registry, snapshots: snapshots.value })
  if (!versionModel.ok) {
    printValidationErrors(versionModel.errors, 'Version model errors', 'manguito build')
    process.exit(1)
  }
  await generateVersionModel(versionModel.value, generatedDir)
  printSuccess(`Version model baked (live: ${versionModel.value.live.join(', ')})`)
```

Refusing to build on an invalid model is right: the alternative is deploying an api that serves a contract the model rejects.

- [ ] **Step 5: Pass it in the server entry**

In `packages/cli/src/codegen/server-entries.ts`, add the import beside `schemaRegistry`'s and the option beside `registry:`:

```typescript
import { versionModel } from './version-model.js'
```
```typescript
  versions: versionModel,
```

Apply it to every entry the file generates — `server.ts`, `handler.ts` and `vercel.ts` — not just the first.

- [ ] **Step 6: Verify end to end against the sandbox**

```bash
pnpm --filter @bobbykim/manguito-cms-api build && pnpm --filter @bobbykim/manguito-cms-cli build
cd apps/sandbox
node ../../packages/cli/dist/index.js version:cut --env .env --yes    # creates v1
node ../../packages/cli/dist/index.js build --env .env
cat .manguito/version-model.ts | head -20
rm -rf schemas/versions && node ../../packages/cli/dist/index.js build --env .env
```

`--env .env` is required, not optional: the sandbox's `manguito.config.ts` calls `createPostgresAdapter()` at module scope, so `resolveConfig` cannot import it without `DB_URL`.

Expect the baked model to show `live: ['v1','v2']` after the cut and `['v1']` after the snapshot is removed. Paste both into your report, and confirm `git status --short` leaves the sandbox clean.

- [ ] **Step 7: Run the suites, lint and build**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test` and `lint`; then `pnpm test --force`, `pnpm build` and `pnpm lint` from the repo root — 11/11, 7/7, 7/7.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src packages/api/src
git commit -m "feat(cli): bake the version model for the api"
```

---

## Task 8: Documentation and changeset

**Files:**
- Modify: `packages/api/CONTEXT.md`
- Create: `.changeset/versioned-rest-routes.md`

- [ ] **Step 1: Document the surface**

`packages/api/CONTEXT.md` has a `### Surfaces` section (line 7) and a `### Field identity` section (line 43). Read the file and follow its existing format. Record the three facts a reader cannot infer:

1. **Which surfaces carry a version segment** — content and taxonomy do; media and OpenAPI do not, because `MediaItem` is a fixed shape and one document describes every live version. The paths module is split into two types so versioning media is unexpressible.
2. **The retired/unknown split** — a version number below `current`'s that is not live was cut and retired (410 `VERSION_RETIRED`); at or above it was never cut (404 `VERSION_NOT_FOUND`). Derived from the model alone, nothing persisted.
3. **The boundary, stated plainly** — paragraph types have no projection, and neither programmatic fields nor many-to-many references appear in one, so nested paragraph content, computed fields and junction relations follow **current's** shape on every version. Note the sharp edge: `describeSchemaChange` *does* cover paragraph types, so `version:diff` will report a paragraph rename that the served contract then does not honour.

- [ ] **Step 2: Write the changeset**

api **minor**, cli **minor**. Say what a consumer gains (a stable pinned prefix), what the unversioned path now does (floats to latest, with deprecation headers once more than one version is live), and that a project which never cut a version sees no change.

- [ ] **Step 3: Verify the monorepo**

Run: `pnpm test --force` (11/11), `pnpm build` (7/7), `pnpm lint` (7/7).

- [ ] **Step 4: Commit**

```bash
git add -A packages/api/CONTEXT.md .changeset
git commit -m "docs(api): document the versioned public surface"
```

---

## Residuals

- **Paragraph types, programmatic fields and many-to-many references are not versioned.** The asymmetry with `version:diff` is the sharpest edge; closing it means projecting paragraph types, which the parent design left undesigned and which 2e faces too.
- **One OpenAPI document describes every live version.** A consumer generating a client against a pinned version gets more than that version exposes.
- **The `listRateLimit` middleware instance is shared across versions**, so its counters are global rather than per-version. That is almost certainly what you want, but it is a consequence of registering the same instance N times rather than a decision anyone made.

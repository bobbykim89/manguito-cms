# Nested Projection and Sort Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every read response speak field labels at every nesting depth, and make `?sort_by=<label>` order by the underlying storage column — closing the two correctness gaps Stage 1's top-level-only audit left open.

**Architecture:** Deepen the existing outbound boundary instead of projecting at attach time. A `projectRow` walk replaces the shallow `toLabels` call at each response site; because both broken paths (public reads, admin paragraph population) already call `toLabels` at the right moment, deepening that one function fixes both without touching either resolver. Projectors are precomputed per type at startup. Sorting maps label→column at the route, and the repository validates the column instead of the label.

**Tech Stack:** TypeScript strict mode, Node 22+, Hono, Drizzle ORM + Postgres, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-29-nested-projection-and-sort-mapping-design.md](../specs/2026-08-29-nested-projection-and-sort-mapping-design.md)

## Global Constraints

- **Branch:** work on `docs/stage-1.5-nested-projection`. NEVER commit to `master`.
- **No observable behavior change.** No parser-producible schema diverges (`fieldTypeRegistry` sets `column_name = raw.name` everywhere), so every projection is an identity transform today. Baseline: **320 tests passing, 45 files** in the api package; 11/11 turbo tasks; `pnpm build` clean.
- **Do not alter any existing test's assertions.** Mechanical call-site updates for signature changes are expected and fine. If you believe an existing assertion must change, STOP and report it — do not change it unilaterally.
- **Running tests:** `pnpm --filter @bobbykim/manguito-cms-api test [relative/path] [-t 'name']`, paths relative to `packages/api/`. Do NOT invoke `vitest` / `pnpm vitest` directly — that skips the `dotenv -e .env.test` wrapper, leaves `DB_URL` unset, and aborts the whole run with a misleading "DB_URL not set in .env.test" message. Start Postgres with `pnpm db:test:up` if it is not running.
- **api package only.** Nothing in `core`, `db`, `admin`, or `cli`.
- **GraphQL is already correct and must not change.** It resolves each field individually by column (`resolveFieldValue`, `buildObjectType`) and never calls `toLabels`. Its three `toLabels` calls in `graphql/resolvers.ts` are for the programmatic-resolver record only — leave all three alone.
- **Media is never projected.** A media relation resolves to a row from the `media` system table: fixed columns, no schema fields.
- **Nothing is mutated in place.** `relations.ts` caches resolved target rows by `table:id`, so two parent rows can hold the same nested object. Every projection must produce a fresh object.
- TypeScript strict mode. No JavaScript files. No new dependencies. Factory functions over classes; named function declarations for top-level exports.
- Test imports omit the file extension (`from '../projector'`); source imports include `.js`.
- Conventional commits, `type(scope): subject`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/api/src/projector.ts` | **New.** `isPlainRow`, `TypeProjector`, `Projectors`, `buildProjectors`, `projectRow`. The whole recursive walk lives here. |
| `packages/api/src/field-keys.test-fixtures.ts` | Gains divergent paragraph/target type fixtures for projector tests. |
| `packages/api/src/app.ts` | Paragraph types added to `fieldKeyMaps`; `projectors` built once; `sortableColumns` per repository. |
| `packages/api/src/routes/content.ts` | 5 response sites → `projectRow`; `sort_by` mapped. |
| `packages/api/src/routes/admin/content.ts` | 8 response sites → `projectRow`; 2 publish-validation sites stay shallow. |
| `packages/api/src/routes/query-params.ts` | Correct the false sortable-fields comment. |
| `packages/api/src/repositories/content.ts` | `sortableColumns` option replaces the label allowlist. |

Seven tasks. 1 builds the projector, 2 wires it, 3–4 adopt it, 5 does sorting, 6 proves it end to end, 7 documents it.

**Call-site census (verified — do not guess).** There are **15** `toLabels` calls in the REST routes: 5 in `routes/content.ts` (lines 103, 195, 238, 273, 297) and 10 in `routes/admin/content.ts` (lines 280, 331, 505, 592, 662, 801, 823, 895, 928, 986). **13 become `projectRow`. The two at `admin/content.ts:592` and `:928` stay shallow** — they build `merged` for `checkRequiredFields`, which inspects only top-level required fields. The spec's prose says "thirteen calls, eleven change"; that count was taken before the sites were enumerated. This census is authoritative.

---

### Task 1: The projector module

**Files:**
- Create: `packages/api/src/projector.ts`
- Modify: `packages/api/src/field-keys.test-fixtures.ts`
- Test: `packages/api/src/__tests__/projector.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap`, `createFieldKeyMap`, `isColumnBacked` from `packages/api/src/field-keys.js`; `ParsedField`, `SchemaRegistry` from core.
- Produces:
  - `isPlainRow(v: unknown): v is Record<string, unknown>`
  - `type TypeProjector = { map: FieldKeyMap; nested: Array<{ label: string; target: string }> }`
  - `type Projectors = Record<string, TypeProjector>`
  - `buildProjectors(registry: SchemaRegistry, fieldKeyMaps: Record<string, FieldKeyMap>): Projectors`
  - `projectRow(row: Record<string, unknown>, typeName: string, projectors: Projectors): Record<string, unknown>`
  - Fixtures: `divergentParagraphType`, `divergentTargetType`

- [ ] **Step 1: Add the type fixtures**

Append to `packages/api/src/field-keys.test-fixtures.ts`:

```ts
import type { ParsedContentType, ParsedParagraphType } from '@bobbykim/manguito-cms-core'

// A paragraph type whose single field's label ('title') differs from its
// storage column ('blog_title'). Reuses divergentTextField above.
export const divergentParagraphType: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--card',
  label: 'Card',
  source_file: 'paragraph--card.json',
  system_fields: [],
  fields: [divergentTextField],
  db: { table_name: 'paragraph_card' },
} as ParsedParagraphType

// A reference/junction TARGET type with the same divergence.
export const divergentTargetType: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--category',
  label: 'Category',
  source_file: 'content--category.json',
  only_one: false,
  default_base_path: 'category',
  system_fields: [],
  fields: [divergentTextField],
  ui: { tabs: [] },
  db: { table_name: 'content_category', junction_tables: [] },
  api: {
    default_base_path: 'category',
    http_methods: ['GET'],
    item_path: '/api/category/:slug',
  },
} as ParsedContentType
```

If either type demands a property this fixture omits, add it rather than widening the cast — a shape drift should fail the build.

- [ ] **Step 2: Write the failing test**

Create `packages/api/src/__tests__/projector.test.ts`. Note these tests build `Projectors` by hand rather than through `buildProjectors`, so `projectRow`'s walk is tested in isolation; `buildProjectors` gets its own test in Step 6.

```ts
import { describe, it, expect } from 'vitest'
import { isPlainRow, projectRow, type Projectors } from '../projector'
import { createFieldKeyMap } from '../field-keys'
import { divergentTextField, divergentMediaField } from '../field-keys.test-fixtures'

// 'post' has a divergent text field plus a media field, and three relation
// fields whose targets are 'card' (paragraph) and 'category' (reference).
const PROJECTORS: Projectors = {
  post: {
    map: createFieldKeyMap([divergentTextField, divergentMediaField]),
    nested: [
      { label: 'cards', target: 'card' },
      { label: 'category', target: 'category' },
      { label: 'tags', target: 'category' },
    ],
  },
  card: { map: createFieldKeyMap([divergentTextField]), nested: [] },
  category: { map: createFieldKeyMap([divergentTextField]), nested: [] },
}

describe('isPlainRow', () => {
  it('accepts a plain object', () => {
    expect(isPlainRow({ a: 1 })).toBe(true)
  })

  it('rejects null, arrays and strings', () => {
    expect(isPlainRow(null)).toBe(false)
    expect(isPlainRow([{ a: 1 }])).toBe(false)
    expect(isPlainRow('uuid-1')).toBe(false)
  })

  it('rejects a Date — timestamps are values, not rows', () => {
    expect(isPlainRow(new Date())).toBe(false)
  })
})

describe('projectRow', () => {
  it('maps the top level', () => {
    const out = projectRow({ id: 'p1', blog_title: 'Hi' }, 'post', PROJECTORS)
    expect(out).toEqual({ id: 'p1', title: 'Hi' })
  })

  it('maps paragraph children to the paragraph type labels', () => {
    const out = projectRow(
      { id: 'p1', blog_title: 'Hi', cards: [{ id: 'c1', blog_title: 'One' }] },
      'post',
      PROJECTORS
    )
    expect(out['cards']).toEqual([{ id: 'c1', title: 'One' }])
  })

  it('maps a resolved reference target to the target type labels', () => {
    const out = projectRow(
      { id: 'p1', category: { id: 'k1', blog_title: 'News' } },
      'post',
      PROJECTORS
    )
    expect(out['category']).toEqual({ id: 'k1', title: 'News' })
  })

  it('maps a junction target array element-wise', () => {
    const out = projectRow(
      { id: 'p1', tags: [{ id: 't1', blog_title: 'A' }, { id: 't2', blog_title: 'B' }] },
      'post',
      PROJECTORS
    )
    expect(out['tags']).toEqual([{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }])
  })

  it('leaves a bare id string alone (not ?include=d)', () => {
    const out = projectRow({ id: 'p1', category: 'k1' }, 'post', PROJECTORS)
    expect(out['category']).toBe('k1')
  })

  it('leaves a bare id array alone', () => {
    const out = projectRow({ id: 'p1', tags: ['t1', 't2'] }, 'post', PROJECTORS)
    expect(out['tags']).toEqual(['t1', 't2'])
  })

  it('leaves a resolved media object untouched — media is not in nested', () => {
    const media = { id: 'm1', url: '/uploads/a.png', file_name: 'a.png' }
    const out = projectRow({ id: 'p1', blog_hero_image: media }, 'post', PROJECTORS)
    expect(out['hero']).toEqual(media)
  })

  it('skips null and absent nested values', () => {
    const out = projectRow({ id: 'p1', category: null }, 'post', PROJECTORS)
    expect(out['category']).toBeNull()
    expect(out).not.toHaveProperty('tags')
  })

  it('passes a row through unchanged for an unknown type', () => {
    const row = { id: 'p1', blog_title: 'Hi' }
    expect(projectRow(row, 'nope', PROJECTORS)).toBe(row)
  })

  it('passes a nested value through when its target has no projector', () => {
    const projectors: Projectors = {
      post: { map: createFieldKeyMap([divergentTextField]), nested: [{ label: 'x', target: 'missing' }] },
    }
    const nested = { blog_title: 'raw' }
    const out = projectRow({ id: 'p1', x: nested }, 'post', projectors)
    expect(out['x']).toBe(nested)
  })

  // The property the whole design leans on.
  it('projects a shared nested object independently per parent, without mutating it', () => {
    const shared = { id: 'k1', blog_title: 'News' }
    const a = projectRow({ id: 'p1', category: shared }, 'post', PROJECTORS)
    const b = projectRow({ id: 'p2', category: shared }, 'post', PROJECTORS)

    expect(a['category']).toEqual({ id: 'k1', title: 'News' })
    expect(b['category']).toEqual({ id: 'k1', title: 'News' })
    expect(a['category']).not.toBe(b['category'])
    // The source survives untouched — a second pass would otherwise see 'title'
    // and lose the value.
    expect(shared).toEqual({ id: 'k1', blog_title: 'News' })
  })

  it('does not mutate the top-level source row', () => {
    const row = { id: 'p1', blog_title: 'Hi' }
    projectRow(row, 'post', PROJECTORS)
    expect(row).toEqual({ id: 'p1', blog_title: 'Hi' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/projector.test.ts`
Expected: FAIL — `Failed to resolve import "../projector"`.

- [ ] **Step 4: Write the implementation**

Create `packages/api/src/projector.ts`:

```ts
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { FieldKeyMap } from './field-keys.js'

// ─── Recursive outbound projection ────────────────────────────────────────────
//
// Stage 1 mapped a response row's TOP-LEVEL keys from storage columns to public
// labels. Nested rows — paragraph children, resolved reference and junction
// targets — were attached straight from SELECT * and never mapped, so they
// served column names. This walks them.
//
// Applied at exactly the points that called FieldKeyMap.toLabels before, which
// is why it fixes both the public and admin paths without touching either
// resolver: both already map at the right moment, after relation resolution.
//
// GraphQL does not use this. It resolves each field individually by column
// through resolveFieldValue, so it is already correct at every depth.

/**
 * Is this a resolved row worth recursing into? A relation that was not
 * `?include=`d holds a bare uuid string (or an array of them), and timestamps
 * arrive from the driver as Date instances — neither is a row.
 */
export function isPlainRow(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}

export type TypeProjector = {
  /** This type's own label↔column map. */
  map: FieldKeyMap
  /** Relation fields worth recursing into: the field's LABEL and its target type. */
  nested: Array<{ label: string; target: string }>
}

export type Projectors = Record<string, TypeProjector>

// Media relations resolve to rows of the `media` system table — fixed columns,
// no schema fields — so there is nothing to project and they stay out of `nested`.
const MEDIA_FIELD_TYPES = new Set(['image', 'video', 'file'])

function nestedTargets(fields: ParsedField[]): Array<{ label: string; target: string }> {
  const out: Array<{ label: string; target: string }> = []
  for (const f of fields) {
    if (MEDIA_FIELD_TYPES.has(f.field_type)) continue
    if (f.field_type !== 'paragraph' && f.field_type !== 'reference') continue
    // Both kinds name their target the same way.
    const ref = (f.ui_component as { ref?: string }).ref
    if (!ref) continue
    out.push({ label: f.name, target: ref })
  }
  return out
}

/**
 * Built ONCE at startup, not per request. Covers content, taxonomy and
 * paragraph types, keyed by machine name — the same key space `fieldKeyMaps`
 * uses and the same one a field's `ui_component.ref` points into.
 */
export function buildProjectors(
  registry: SchemaRegistry,
  fieldKeyMaps: Record<string, FieldKeyMap>
): Projectors {
  const projectors: Projectors = {}
  const sources: Array<Record<string, { fields: ParsedField[] }>> = [
    registry.content_types as unknown as Record<string, { fields: ParsedField[] }>,
    registry.taxonomy_types as unknown as Record<string, { fields: ParsedField[] }>,
    registry.paragraph_types as unknown as Record<string, { fields: ParsedField[] }>,
  ]

  for (const source of sources) {
    for (const [typeName, type] of Object.entries(source)) {
      const map = fieldKeyMaps[typeName]
      if (!map) continue
      projectors[typeName] = { map, nested: nestedTargets(type.fields) }
    }
  }

  return projectors
}

/**
 * Storage-keyed row → label-keyed, recursively. Never mutates its input: the
 * relation cache hands the SAME nested object to several parents, so editing in
 * place would project a shared row twice and lose its values on the second pass.
 */
export function projectRow(
  row: Record<string, unknown>,
  typeName: string,
  projectors: Projectors
): Record<string, unknown> {
  const p = projectors[typeName]
  if (!p) return row

  // Top level first: `nested` is keyed by label, so the keys must be labels
  // before the loop below reads them. toLabels returns a fresh object.
  const out = p.map.toLabels(row)

  for (const { label, target } of p.nested) {
    const v = out[label]
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      out[label] = v.map((item) => (isPlainRow(item) ? projectRow(item, target, projectors) : item))
    } else if (isPlainRow(v)) {
      out[label] = projectRow(v, target, projectors)
    }
  }

  return out
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/projector.test.ts`
Expected: PASS — all cases.

- [ ] **Step 6: Add the `buildProjectors` test**

Append to `packages/api/src/__tests__/projector.test.ts`:

Extend the file's EXISTING import lines rather than adding second imports from the same modules — `import { isPlainRow, projectRow, buildProjectors, type Projectors } from '../projector'` and add `divergentParagraphType, paragraphField` to the existing fixtures import. Add one new line: `import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'`.

```ts
describe('buildProjectors', () => {
  // A content type with one paragraph field pointing at 'paragraph--card'.
  const contentType = {
    fields: [divergentTextField, divergentMediaField, { ...paragraphField, ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' } }],
  }
  const registry = {
    content_types: { 'content--post': contentType },
    taxonomy_types: {},
    paragraph_types: { 'paragraph--card': divergentParagraphType },
  } as unknown as SchemaRegistry
  const maps = {
    'content--post': createFieldKeyMap(contentType.fields as never),
    'paragraph--card': createFieldKeyMap(divergentParagraphType.fields),
  }

  it('covers paragraph types, not just content and taxonomy', () => {
    expect(Object.keys(buildProjectors(registry, maps)).sort()).toEqual([
      'content--post',
      'paragraph--card',
    ])
  })

  it('lists the paragraph field as nested, targeting its ref', () => {
    expect(buildProjectors(registry, maps)['content--post']!.nested).toEqual([
      { label: 'cards', target: 'paragraph--card' },
    ])
  })

  it('excludes media fields from nested', () => {
    const labels = buildProjectors(registry, maps)['content--post']!.nested.map((n) => n.label)
    expect(labels).not.toContain('hero')
  })
})
```

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/projector.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS at 320 + your new tests. Nothing imports the projector yet.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/projector.ts packages/api/src/field-keys.test-fixtures.ts packages/api/src/__tests__/projector.test.ts
git commit -m "feat(api): add recursive row projector"
```

---

### Task 2: Wire projectors through startup

**Files:**
- Modify: `packages/api/src/app.ts`
- Modify: `packages/api/src/routes/content.ts` (signature only)
- Modify: `packages/api/src/routes/admin/content.ts` (signature only)
- Test: existing suites (mechanical call-site updates)

**Interfaces:**
- Consumes: `buildProjectors`, `Projectors` from Task 1.
- Produces: registrators take `projectors: Projectors` in place of `fieldKeyMaps: Record<string, FieldKeyMap>`. Final signatures:

```ts
export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  projectors: Projectors,
  paths: PublicPaths,
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver
): void

export function registerAdminContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  projectors: Projectors,
  mediaRepo: MediaRepository,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  db?: DrizzlePostgresInstance,
): void
```

Handlers that need a plain map reach it as `projectors[typeName]!.map` — one object threaded, not two.

- [ ] **Step 0: Move the field-key-map block ABOVE repository construction**

`fieldKeyMaps` is currently built at `app.ts:262`, but the repositories are constructed at `app.ts:135-197` — *before* it. Task 5 passes `sortableColumns` derived from `fieldKeyMaps` at repository construction, which would be a use-before-declaration error.

Move the whole `fieldKeyMaps` block (and the two blocks you add in Steps 1-2) so it sits **above** `const contentRepos = ...`. It depends only on `registry`, which is available from the options at the top of `createCmsApp`, so the move is safe. Run the full api suite after the move alone, before making any other change, to confirm the reorder is inert.

- [ ] **Step 1: Add paragraph field key maps — in a SEPARATE object**

**Do NOT add paragraph types to the existing `fieldKeyMaps`.** That object is passed to `createGraphQLHandler` (`app.ts:304`), and `graphql/schema.ts:175` does `fieldKeyMaps[machineName]` inside `buildObjectType`, which is shared by content, taxonomy **and paragraph** types. Paragraph types resolve to `undefined` there today, and a GraphQL test pins that unmapped fallback. Widening `fieldKeyMaps` would silently change GraphQL's programmatic-record behavior for paragraph types and break that test — out of scope for this stage, and it would require altering an existing assertion.

So in `packages/api/src/app.ts`, build a second object beside the first:

```ts
  // Paragraph types need key maps for nested projection, but deliberately NOT
  // for GraphQL: buildObjectType looks types up in `fieldKeyMaps`, and paragraph
  // types resolving to `undefined` there is existing, pinned behavior. Keeping
  // these separate means projection gains paragraph maps while GraphQL sees the
  // same content+taxonomy map it always has.
  const paragraphFieldKeyMaps: Record<string, FieldKeyMap> = Object.fromEntries(
    Object.entries(registry.paragraph_types).map(([typeName, pt]) => [
      typeName,
      createFieldKeyMap((pt as ParsedParagraphType).fields),
    ])
  )
```

Import `ParsedParagraphType` from core alongside the existing type imports. Note this means the startup collision guard now runs against paragraph types too — a new reason a server can refuse to boot, which Task 7 records in the changeset.

- [ ] **Step 2: Build the projectors**

Immediately after `fieldKeyMaps`, in `packages/api/src/app.ts`:

```ts
  // Recursive outbound projection. Built once from BOTH map objects; every read
  // response is projected through this rather than through a bare toLabels.
  const projectors = buildProjectors(registry, { ...fieldKeyMaps, ...paragraphFieldKeyMaps })
```

Import: `import { buildProjectors, type Projectors } from './projector.js'`

- [ ] **Step 3: Change both registrator signatures and the two call sites**

Replace the `fieldKeyMaps` parameter with `projectors` in both registrators (positions above), and inside each handler replace `const fieldKeys = fieldKeyMaps[typeName]!` with:

```ts
      const projector = projectors[typeName]!
      const fieldKeys = projector.map
```

Keeping a local `fieldKeys` means the filter/sort code that uses `fieldKeys.columnFor` needs no edit in this task. Update the two call sites in `app.ts` to pass `projectors`.

- [ ] **Step 4: Update the test call sites**

Every test that calls a registrator directly must pass `projectors` instead of `fieldKeyMaps`. Build one with `buildProjectors(registry, maps)` from the registry that test already has. Find them all — do not trust this list to be complete:

- `packages/api/src/routes/__tests__/content.test.ts`
- `packages/api/src/routes/__tests__/content.programmatic.test.ts`
- `packages/api/src/routes/__tests__/content.admin.test.ts`
- `packages/api/src/__tests__/public.integration.test.ts`
- `packages/api/src/__tests__/relations.read.integration.test.ts`
- `packages/api/src/__tests__/field-divergence.integration.test.ts`

These are mechanical: change what is passed, change no assertion.

- [ ] **Step 5: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS at the same count as Task 1 left it. Behavior is unchanged — `projectors[t].map` is the same object `fieldKeyMaps[t]` was.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/app.ts packages/api/src/routes/content.ts packages/api/src/routes/admin/content.ts packages/api/src/routes/__tests__ packages/api/src/__tests__
git commit -m "refactor(api): thread projectors through startup"
```

---

### Task 3: Public read routes project recursively

**Files:**
- Modify: `packages/api/src/routes/content.ts` (5 sites: lines 103, 195, 238, 273, 297 before your edits)
- Test: `packages/api/src/routes/__tests__/content.test.ts`

**Interfaces:**
- Consumes: `projectRow`, `Projectors` (Task 1); the `projector` local (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/routes/__tests__/content.test.ts`. Follow the file's existing pattern — `new Hono()`, `registerPublicContentRoutes`, `makeMockRepo`:

```ts
it('projects paragraph children to labels, not columns', async () => {
  const repo = makeMockRepo()
  ;(repo.findBySlug as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'p1',
    slug: 'a',
    published: true,
    blog_title: 'Hi',
    cards: [{ id: 'c1', blog_title: 'One' }],
  })

  const res = await appForDivergentPostWithCards(repo).request('/api/divergent-post/a')
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.data.title).toBe('Hi')
  expect(body.data.cards).toEqual([{ id: 'c1', title: 'One' }])
  expect(body.data.cards[0]).not.toHaveProperty('blog_title')
})
```

Build `appForDivergentPostWithCards` from this file's existing `BLOG_TYPE`/`mockRegistry` pattern: a content type whose fields are `[divergentTextField, { ...paragraphField, ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' } }]`, a registry whose `paragraph_types` holds `divergentParagraphType` under `'paragraph--card'`, and `buildProjectors(registry, maps)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.test.ts -t 'projects paragraph children'`
Expected: FAIL — `cards[0]` still carries `blog_title`.

- [ ] **Step 3: Replace all five call sites**

In `packages/api/src/routes/content.ts`, each `fieldKeys.toLabels(X)` / `fieldKeyMaps[typeName]!.toLabels(X)` becomes:

```ts
projectRow(X as Record<string, unknown>, typeName, projectors)
```

Import: `import { projectRow } from '../projector.js'`

Do not move any of them. Each stays exactly where it is — after relation resolution and after programmatic resolution, which Stage 1 established and verified.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.test.ts -t 'projects paragraph children'`
Expected: PASS.

- [ ] **Step 5: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS — identity projection for every existing fixture.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/content.ts packages/api/src/routes/__tests__/content.test.ts
git commit -m "feat(api): project public read responses recursively"
```

---

### Task 4: Admin read routes project recursively

**Files:**
- Modify: `packages/api/src/routes/admin/content.ts` (8 response sites; lines 280, 331, 505, 662, 801, 823, 895, 986 before your edits)
- Test: `packages/api/src/routes/__tests__/content.admin.test.ts`

**Interfaces:**
- Consumes: `projectRow`, `Projectors` (Task 1); the `projector` local (Task 2).
- Produces: no new exports.

**Leave two sites alone.** `admin/content.ts:592` and `:928` are `{ ...fieldKeys.toLabels(existing), ...body }` feeding `checkRequiredFields`, which reads only top-level required fields. They stay shallow `toLabels`. Changing them is a Spec finding, not a bonus.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/routes/__tests__/content.admin.test.ts`, following this file's existing app-building pattern:

```ts
it('projects paragraph children to labels on an admin read', async () => {
  const repo = makeMockRepo()
  ;(repo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'p1',
    slug: 'a',
    published: false,
    blog_title: 'Hi',
  })

  const app = adminAppForDivergentPostWithCards(repo, {
    // loadParagraphRows reads through db.execute; return one storage-keyed child.
    execute: async () => ({ rows: [{ id: 'c1', parent_id: 'p1', blog_title: 'One', order: 0 }] }),
  })

  const res = await app.request('/admin/api/content/divergent-post/p1')
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.data.title).toBe('Hi')
  expect(body.data.cards[0].title).toBe('One')
  expect(body.data.cards[0]).not.toHaveProperty('blog_title')
})
```

This is the regression test for the admin-form data-loss path: the edit form reads paragraph sub-values by label, so a storage-keyed child renders blank and saves `null`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'projects paragraph children'`
Expected: FAIL — `cards[0]` carries `blog_title`, and `cards[0].title` is `undefined`.

- [ ] **Step 3: Replace the eight response sites**

In `packages/api/src/routes/admin/content.ts`, at each of the eight response sites:

```ts
projectRow(X as Record<string, unknown>, typeName, projectors)
```

and for the two list sites, inside the existing `.map(...)`:

```ts
        const data = result.data.map((row) =>
          projectRow(row as Record<string, unknown>, typeName, projectors)
        )
```

Import: `import { projectRow } from '../../projector.js'`

Keep each call exactly where it is — after paragraph and junction population, which Stage 1 verified. Mapping earlier would leave those label-keyed additions untouched while renaming the column-backed keys around them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'projects paragraph children'`
Expected: PASS.

- [ ] **Step 5: Confirm the two validation sites are untouched**

Run: `grep -n "toLabels" packages/api/src/routes/admin/content.ts`
Expected: exactly two hits, both inside a `const merged = { ...` line.

- [ ] **Step 6: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/admin/content.ts packages/api/src/routes/__tests__/content.admin.test.ts
git commit -m "feat(api): project admin read responses recursively"
```

---

### Task 5: Sort by label, order by column

**Files:**
- Modify: `packages/api/src/repositories/content.ts:170-177`
- Modify: `packages/api/src/routes/content.ts` (the `sort_by` read, around line 125)
- Modify: `packages/api/src/routes/query-params.ts:5`
- Modify: `packages/api/src/app.ts` (pass `sortableColumns` per repository)
- Test: `packages/api/src/repositories/__tests__/content.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap.columnFor` from Stage 1.
- Produces: `createDrizzleContentRepository(db, tableName, opts)` accepts `opts.sortableColumns?: Set<string>`. When absent, the repository keeps validating against `SORTABLE_FIELDS` exactly as today, so existing callers and tests are unaffected.

**Why the split:** mapping only at the route would hand the repository `blog_title`, and `SORTABLE_FIELDS.has('blog_title')` is false — a valid sort would start throwing `INVALID_SORT_FIELD`. So the route validates the label and maps; the repository validates the column. Both guards survive, and `quoteIdent` is untouched.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/repositories/__tests__/content.test.ts`, using this file's existing SQL-inspection helpers:

```ts
describe('sortableColumns', () => {
  it('accepts a column from the supplied set and orders by it', async () => {
    const db = makeSpyDb()
    const repo = createDrizzleContentRepository(db, 'content_post', {
      sortableColumns: new Set(['blog_title', 'created_at', 'updated_at']),
    })

    await repo.findMany({ sort_by: 'blog_title' as never })

    expect(sqlTextOf(db.lastQuery())).toContain('ORDER BY "blog_title"')
  })

  it('rejects a value outside the supplied set', async () => {
    const db = makeSpyDb()
    const repo = createDrizzleContentRepository(db, 'content_post', {
      sortableColumns: new Set(['created_at']),
    })

    await expect(repo.findMany({ sort_by: 'blog_title' as never })).rejects.toThrow(
      /not sortable/i
    )
  })

  it('falls back to SORTABLE_FIELDS when no set is supplied', async () => {
    const db = makeSpyDb()
    const repo = createDrizzleContentRepository(db, 'content_post')

    await expect(repo.findMany({ sort_by: 'blog_title' as never })).rejects.toThrow(
      /not sortable/i
    )
    await expect(repo.findMany({ sort_by: 'created_at' })).resolves.toBeDefined()
  })
})
```

Use whatever spy-db and SQL-text helpers this file already defines rather than adding new ones — it has helpers for walking drizzle's `queryChunks`. Name them as they are named there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/repositories/__tests__/content.test.ts -t 'sortableColumns'`
Expected: FAIL — the option is not read, so `blog_title` is rejected by `SORTABLE_FIELDS`.

- [ ] **Step 3: Teach the repository about columns**

In `packages/api/src/repositories/content.ts`, add `sortableColumns?: Set<string>` to the options type, capture it at construction, and replace the guard:

```ts
      // Sorting is validated against COLUMNS when the caller supplies the set
      // (the route has already validated the label and mapped it). Without one,
      // fall back to the label allowlist — the pre-versioning behavior.
      const allowed = sortableColumns ?? SORTABLE_FIELDS
      if (!allowed.has(sort_by as string)) {
        throw codeError(
          'INVALID_SORT_FIELD',
          `'${sort_by}' is not sortable. Allowed: ${[...allowed].join(', ')}`
        )
      }
```

`quoteIdent(sort_by)` below stays exactly as it is — it is the injection guard and must not change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/repositories/__tests__/content.test.ts -t 'sortableColumns'`
Expected: PASS.

- [ ] **Step 5: Supply the set at construction**

In `packages/api/src/app.ts`, where each content and taxonomy repository is built, pass:

```ts
        sortableColumns: new Set(
          [...SORTABLE_FIELDS].map((label) => fieldKeyMaps[typeName]!.columnFor(label) ?? label)
        ),
```

Import `SORTABLE_FIELDS` from `./routes/query-params.js`. `created_at`/`updated_at` are system fields absent from the map, so `columnFor` returns `undefined` and they pass through unchanged.

- [ ] **Step 6: Map `sort_by` at the public route**

In `packages/api/src/routes/content.ts`, where `sortBy` is read from the query, map it after the existing `SORTABLE_FIELDS` validation and before it reaches the repository:

```ts
        const sortBy = c.req.query('sort_by') ?? 'created_at'
        const sortColumn = fieldKeys.columnFor(sortBy) ?? sortBy
```

and pass `sort_by: sortColumn as 'title' | 'created_at' | 'updated_at'` where `sortBy` was passed. The cast is required because core's type is a literal union; it is a lie the repository immediately re-validates, so keep it narrow and comment it.

Do the same in `packages/api/src/routes/admin/content.ts`'s `parseListQuery` path if it passes `sort_by` through — check, and if it does, map it there too using the same `fieldKeys.columnFor`.

- [ ] **Step 7: Correct the false comment**

In `packages/api/src/routes/query-params.ts`, replace line 5:

```ts
// The sortable set. NOT "indexed system fields", despite what this comment used
// to say: db codegen generates no indexes at all, and `title` is an ordinary
// schema field, not a system field — nothing guarantees a content type has one.
// Sorting by a label a type lacks still reaches Postgres and 500s; widening this
// set to any column-backed field is a separate design (see the Stage 1.5 spec).
```

- [ ] **Step 8: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/repositories/content.ts packages/api/src/routes/content.ts packages/api/src/routes/admin/content.ts packages/api/src/routes/query-params.ts packages/api/src/app.ts packages/api/src/repositories/__tests__/content.test.ts
git commit -m "fix(api): validate sorting by label, order by storage column"
```

---

### Task 6: End-to-end proof against real Postgres

**Files:**
- Modify: `packages/api/src/__tests__/field-divergence.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: no exports. The deliverable is the proof.

This extends Stage 1's divergence suite rather than starting a new one. Read that file first and follow its setup exactly — it already creates a table with storage-named columns, seeds published and draft rows, and asserts labels over the wire.

You should NOT need to change production code. If an assertion fails, that is a real finding about Tasks 1–5 — report it, do not weaken the assertion.

- [ ] **Step 1: Extend the schema and seed**

Add a paragraph child table and a reference target table to the existing `beforeAll`, with storage-named columns:

```sql
CREATE TABLE "paragraph_divergence_card" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL,
  parent_type varchar(255),
  parent_field varchar(255) NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  blog_title varchar(255)
);
CREATE TABLE "taxonomy_divergence_category" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(255) NOT NULL UNIQUE,
  published boolean NOT NULL DEFAULT true,
  blog_title varchar(255)
);
```

Register the paragraph type and the target type in the test registry, give the content type a paragraph field and a reference field pointing at them, and add both to the field key maps and projectors.

- [ ] **Step 2: Add the assertions**

```ts
it('public ?include= returns the target type labels, never its columns', async () => {
  const res = await app.request('/api/divergence_test/published-one?include=category')
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.data.category.title).toBe('News')
  expect(body.data.category).not.toHaveProperty('blog_title')
})

it('public paragraph children return paragraph labels', async () => {
  const res = await app.request('/api/divergence_test/published-one')
  const body = await res.json()

  expect(body.data.cards[0].title).toBe('One')
  expect(body.data.cards[0]).not.toHaveProperty('blog_title')
})

it('sorting by a label orders by the storage column', async () => {
  const res = await app.request('/api/divergence_test?sort_by=title&sort_order=asc')
  const body = await res.json()

  expect(res.status).toBe(200)
  expect(body.data.map((r: { title: string }) => r.title)).toEqual(
    [...body.data.map((r: { title: string }) => r.title)].sort()
  )
})
```

Seed at least two published rows with different titles so the sort assertion can fail.

- [ ] **Step 3: Extend cleanup**

Add both new tables to the `afterAll` `DROP TABLE IF EXISTS` so repeated runs stay clean.

- [ ] **Step 4: Run the suite twice**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-divergence.integration.test.ts`
Then run it again. Expected: PASS both times — a second failing run means leaked state.

- [ ] **Step 5: Run the whole repo suite and the build**

Run: `pnpm test` then `pnpm build`
Expected: 11/11 tasks pass; build succeeds. This is the stage's exit criterion.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/__tests__/field-divergence.integration.test.ts
git commit -m "test(api): prove nested projection and sort mapping end to end"
```

---

### Task 7: Document the stage

**Files:**
- Modify: `docs/adr/api/0011-field-label-vs-storage-key.md`
- Modify: `packages/api/CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-08-27-schema-versioning-stage-1-foundations.md`
- Create: `.changeset/nested-projection.md`

**Interfaces:** none.

- [ ] **Step 1: Amend ADR api/0011**

Strike the "The audit stopped at the top level" limitation and the nested-projection known-limitation bullet, since both are now false. Add, in the ADR's existing voice:

- Projection now recurses through paragraph children, resolved reference targets and junction targets, applied at the same boundary as before.
- Depth is bounded by what resolution produced: `?include=` takes no nested paths, ADR core/0005 caps paragraph nesting at one level, and the walk stops at strings, so a reference cycle cannot run away.
- Nothing is mutated in place, because the relation cache hands the same nested object to several parents.
- Media is never projected — the `media` table has fixed columns and no schema fields.
- Paragraph types now have field key maps, so the startup collision guard runs against them too: a new reason a server can refuse to boot.
- The sortable set is validated as labels at the route and as columns in the repository. Its restriction is arbitrary — nothing is indexed and `title` is not a system field — and sorting by a label a type lacks still 500s. Schema-driven sorting is the agreed destination on its own timeline.

- [ ] **Step 2: Add the CONTEXT.md glossary entry**

In `packages/api/CONTEXT.md`, under the `### Field identity` subsection added in Stage 1:

```markdown
**Projection**:
Converting a storage-keyed row into a label-keyed response, recursively — the top-level row plus paragraph children, resolved reference targets and junction targets, each through its own type's map. Applied once per response at the outbound boundary; never mutates its input, because the relation cache shares one nested object between parents.
_Avoid_: serialization, mapping (when precision matters)
```

- [ ] **Step 3: Update Stage 1's plan**

In `docs/superpowers/plans/2026-08-27-schema-versioning-stage-1-foundations.md`, in the `**Correction (final review).**` block, mark the nested-projection and `sort_by` prerequisites as closed by this stage with a link to its spec. Leave the branded-types prerequisite, and note the spike result: branded *records* were rejected on evidence (29 assertion sites, zero mixing errors, neither target bug flagged); branded *strings* remain plausible.

- [ ] **Step 4: Write the changeset**

Create `.changeset/nested-projection.md`, following the style of existing entries — read two first:

```markdown
---
'@bobbykim/manguito-cms-api': patch
---
```

Body: read responses now project nested rows — paragraph children, resolved reference and junction targets — to field labels rather than storage column names, and `?sort_by=` validates a label then orders by its column. No behavior changes for any schema the parser currently produces, since labels and columns are identical there. One new startup check: paragraph types now get field key maps, so a paragraph type whose field label collides with another of its own columns refuses to boot — unreachable today, since that requires two same-named fields, which the parser already rejects.

- [ ] **Step 5: Confirm the suite is untouched**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS, unchanged — this task is documentation only.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/api/0011-field-label-vs-storage-key.md packages/api/CONTEXT.md docs/superpowers/plans/2026-08-27-schema-versioning-stage-1-foundations.md .changeset/nested-projection.md
git commit -m "docs(api): record recursive projection and sort mapping"
```

---

## Exit Criteria

- [ ] `pnpm test` passes (11/11 tasks) with no existing test assertion altered.
- [ ] `pnpm build` succeeds.
- [ ] The integration suite proves nested `?include=` targets, paragraph children, and label sorting against real Postgres, and passes twice consecutively.
- [ ] `grep -n "toLabels" packages/api/src/routes/admin/content.ts` returns exactly two hits, both in a `merged` line.
- [ ] `packages/api/src/graphql/` has no diff — source or tests. If a GraphQL test starts failing, `fieldKeyMaps` was widened when it should not have been (see Task 2 Step 1).
- [ ] Nothing outside `packages/api` changed except documentation and the changeset.

## What Stage 2 inherits after this

One prerequisite remains: a **branded label/storage type system**, narrowed by the spike to branded *strings* rather than records, reaching into core's query type. It is prevention, not a live defect — after this stage there is no known label/column gap in the api package.

**Schema-driven sorting** is agreed as a destination but is not a Stage 2 blocker, because this stage closes the sort divergence bug.

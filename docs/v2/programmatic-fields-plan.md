# Programmatic Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `programmatic` field type whose value is computed at read time by a user-authored TypeScript resolver, merged into the public API response, with opt-in TTL caching and graceful failure.

**Architecture:** `core` gains the field type + the `programmaticField()` factory (inert marker, no DB column). `api` executes resolvers when assembling public read responses (detail always; lists only for opt-in fields, bounded). `cli` discovers resolver files, wires them into `createCmsApp` (runtime discovery in dev; generated static registry in build). `admin` renders a read-only placeholder. No layer boundary is crossed.

**Tech Stack:** TypeScript (strict, Node 22+), Zod, Hono, Vitest, Vue 3, tsup/Vite, pnpm workspace.

**Design spec:** `docs/v2/programmatic-fields-design.md` (authoritative — read it first).

**Branch:** `feat/programmatic-fields` (already created).

## Global Constraints

- TypeScript only — no `.js` source files. Strict mode.
- Factory functions over classes; named function declarations for top-level exports, arrow functions for callbacks.
- No new npm dependency added to `@bobbykim/manguito-cms-core` (the factory uses only language features).
- Layer boundaries: `core` imports nothing downstream; `api` imports `core`; `cli` imports from all. `admin` imports `core` only.
- Internal expected failures use the `Result`/typed-return pattern — never throw. **Exception:** startup misconfiguration in `createCmsApp` throws, matching the existing `MISSING_STORAGE_ERROR` and roles-registry precedent.
- HTTP responses keep the `{ ok, data }` / `{ ok, error: { code, message } }` envelope.
- Parser output stays serializable plain objects. (The resolver registry is a separate, non-parser structure and may hold functions.)
- Commit messages use conventional commits (`type(scope): subject`) and end with the `Co-Authored-By: Claude Opus 4.8` trailer.
- Per-package test command: `pnpm --filter <package-name> test <path>` (runs `dotenv -e .env.test -- vitest run <path>`).

**Decided parameters (from spec §3):** default resolver timeout `5000` ms; list concurrency cap `10`; failure → `fallback ?? null`, HTTP `200`; cache key `` `${schema}::${field}::${itemId}` ``; `on_list` default `false`; `required` ignored; scope = content + taxonomy types; resolver dir default `./src/programmatic`.

---

## File Structure

**core** (`packages/core/src/`)
- `registry/types.ts` — MODIFY: add `'programmatic'` to `FieldType`, add `{ component: 'computed-display' }` to `UiComponent`.
- `parser/validators.ts` — MODIFY: add `RawProgrammaticFieldSchema` + type, include it in the field union.
- `registry/fieldTypeRegistry.ts` — MODIFY: add `programmatic` to `RawByType` and the registry.
- `parser/parseSchema.ts` — MODIFY: coerce optional `required` to `false` in `buildParsedField`.
- `programmatic/defineProgrammaticField.ts` — CREATE: `programmaticField()` factory + `ResolverContext`/`Resolver`/`ProgrammaticFieldOptions`/`ProgrammaticFieldDefinition`/`JsonValue` types.
- `config/types.ts` — MODIFY: add `ProgrammaticConfig`/`ResolvedProgrammaticConfig`; add fields to `ManguitoConfig`/`ResolvedManguitoConfig`.
- `config/defineConfig.ts` — MODIFY: resolve `programmatic.dir` default.
- `index.ts` — MODIFY: export the new factory, types, and config types.

**api** (`packages/api/src/`)
- `programmatic/resolve.ts` — CREATE: `createProgrammaticResolver()`, `validateResolverBindings()`, `resolverKey()`, `ResolverMap`.
- `app.ts` — MODIFY: accept `resolvers`, validate, build resolver, thread into public routes.
- `routes/content.ts` — MODIFY: accept resolver, resolve on detail/list, exclude programmatic fields from filters.
- `index.ts` — MODIFY: re-export `ResolverMap`/`createProgrammaticResolver`/`validateResolverBindings` if needed by cli.

**cli** (`packages/cli/src/`)
- `utils/programmatic-loader.ts` — CREATE: `loadProgrammaticResolvers(cwd, dir)` runtime discovery (dev).
- `codegen/programmatic-registry.ts` — CREATE: `generateProgrammaticRegistry(files, targetDir, cwd)` (build).
- `codegen/server-entries.ts` — MODIFY: `appSetup()` imports the generated registry and passes `resolvers`.
- `commands/build.ts` — MODIFY: discover files + call `generateProgrammaticRegistry`.
- `commands/dev.ts` — MODIFY: load resolvers, pass to `createCmsApp`, watch dir for hot-swap.

**admin** (`packages/admin/`)
- `src/components/fields/ComputedDisplay.vue` — CREATE: read-only placeholder.
- `codegen/form-generator.ts` — MODIFY: map `computed-display` → `ComputedDisplay`, render without value/update bindings.

---

## Task 1: `core` — the `programmatic` field type

**Files:**
- Modify: `packages/core/src/registry/types.ts`
- Modify: `packages/core/src/parser/validators.ts`
- Modify: `packages/core/src/registry/fieldTypeRegistry.ts`
- Modify: `packages/core/src/parser/parseSchema.ts:239-255`
- Test: `packages/core/src/parser/__tests__/programmatic.test.ts` (create)

**Interfaces:**
- Produces: `FieldType` now includes `'programmatic'`; `UiComponent` includes `{ component: 'computed-display' }`; `RawProgrammaticField` type; parsing a `{ type: 'programmatic' }` field yields `ParsedField` with `field_type: 'programmatic'`, `required: false`, `db_column: null`, `ui_component: { component: 'computed-display' }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/parser/__tests__/programmatic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'

const CONTENT_WITH_PROGRAMMATIC = {
  name: 'content--example',
  label: 'Example',
  type: 'content-type',
  default_base_path: 'example',
  only_one: false,
  fields: [
    {
      tab: {
        name: 'main',
        label: 'Main',
        fields: [
          { name: 'blog_title', label: 'Title', type: 'text/plain', required: true },
          { name: 'blog_summary', label: 'Summary', type: 'programmatic' },
        ],
      },
    },
  ],
}

describe('programmatic field parsing', () => {
  it('parses a programmatic field with no column and a read-only ui component', () => {
    const result = parseSchema(CONTENT_WITH_PROGRAMMATIC, 'content-type', 'example.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const field = result.schema.fields.find((f) => f.name === 'blog_summary')!
    expect(field.field_type).toBe('programmatic')
    expect(field.db_column).toBeNull()
    expect(field.required).toBe(false)
    expect(field.nullable).toBe(true)
    expect(field.ui_component).toEqual({ component: 'computed-display' })
  })

  it('accepts but ignores an explicit required on a programmatic field', () => {
    const raw = structuredClone(CONTENT_WITH_PROGRAMMATIC)
    ;(raw.fields[0]!.tab.fields[1] as Record<string, unknown>)['required'] = true
    const result = parseSchema(raw, 'content-type', 'example.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const field = result.schema.fields.find((f) => f.name === 'blog_summary')!
    expect(field.required).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/programmatic.test.ts`
Expected: FAIL — Zod rejects `type: 'programmatic'` (unknown field type) so `result.ok` is `false`.

- [ ] **Step 3: Add the field type to the unions**

In `packages/core/src/registry/types.ts`, extend `FieldType`:

```ts
export type FieldType =
  | 'text/plain'
  | 'text/rich'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'image'
  | 'video'
  | 'file'
  | 'enum'
  | 'paragraph'
  | 'reference'
  | 'programmatic'
```

And extend `UiComponent` (add the last member):

```ts
export type UiComponent =
  | { component: 'text-input' }
  | { component: 'rich-text-editor' }
  | { component: 'number-input'; step: number }
  | { component: 'checkbox' }
  | { component: 'date-picker' }
  | { component: 'file-upload'; accepted_mime_types: string[] }
  | { component: 'select'; options: string[]; enum_ref?: string }
  | { component: 'typeahead-select'; ref: string; rel: RelationType }
  | { component: 'paragraph-embed'; ref: string; rel: RelationType; max?: number }
  | { component: 'computed-display' }
```

- [ ] **Step 4: Add the validator and include it in the union**

In `packages/core/src/parser/validators.ts`, after `RawDateFieldSchema` (before the media section) add:

```ts
// ─── Programmatic field schema ────────────────────────────────────────────────

// Value computed at read time — no DB column. `required` is accepted for
// authoring uniformity but ignored (a programmatic field has no write path).
export const RawProgrammaticFieldSchema = RawFieldBase.extend({
  type: z.literal('programmatic'),
  required: z.boolean().optional(),
})
```

Add it to the discriminated union `RawNonEnumFieldSchema` (append after `RawReferenceFieldSchema`):

```ts
const RawNonEnumFieldSchema = z.discriminatedUnion('type', [
  RawTextPlainFieldSchema,
  RawTextRichFieldSchema,
  RawIntegerFieldSchema,
  RawFloatFieldSchema,
  RawBooleanFieldSchema,
  RawDateFieldSchema,
  RawImageFieldSchema,
  RawVideoFieldSchema,
  RawFileFieldSchema,
  RawParagraphFieldSchema,
  RawReferenceFieldSchema,
  RawProgrammaticFieldSchema,
])
```

And add the inferred type in the "Inferred types" section (after `RawReferenceField`):

```ts
export type RawProgrammaticField = z.infer<typeof RawProgrammaticFieldSchema>
```

- [ ] **Step 5: Add the registry builder**

In `packages/core/src/registry/fieldTypeRegistry.ts`, add `RawProgrammaticField` to the imports from `../parser/validators`, add it to `RawByType`:

```ts
type RawByType = {
  'text/plain': RawTextField
  'text/rich': RawTextRichField
  integer: RawIntegerField
  float: RawFloatField
  boolean: RawBooleanField
  date: RawDateField
  image: RawImageField
  video: RawVideoField
  file: RawFileField
  enum: RawEnumField
  paragraph: RawParagraphField
  reference: RawReferenceField
  programmatic: RawProgrammaticField
}
```

And add the builder to `fieldTypeRegistry` (after the `reference` entry):

```ts
  // ── Programmatic — computed at read time, no column ─────────────────────────
  // Inert marker: the value is produced by a user resolver in the api layer.
  programmatic: () => ({
    validation: { required: false },
    db_column: null,
    ui_component: { component: 'computed-display' },
  }),
```

- [ ] **Step 6: Coerce optional `required` in the parser**

In `packages/core/src/parser/parseSchema.ts`, in `buildParsedField`, replace the destructure so an absent `required` (programmatic fields) becomes `false`:

```ts
  const { name, label } = rawField
  const required = rawField.required ?? false
  const { validation, db_column, ui_component } = build(rawField, { ownerTableName })
```

(The rest of the returned object is unchanged — it already uses `required` and `nullable: !required`.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/parser/__tests__/programmatic.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Run the core suite to check for regressions**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS. If the field-builder completeness test asserts an exact key count, update it to include `programmatic`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/registry/types.ts packages/core/src/parser/validators.ts packages/core/src/registry/fieldTypeRegistry.ts packages/core/src/parser/parseSchema.ts packages/core/src/parser/__tests__/programmatic.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add programmatic field type

Parses `type: "programmatic"` into a columnless ParsedField with a
computed-display ui component. `required` accepted but ignored.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `core` — the `programmaticField()` factory, types, and config

**Files:**
- Create: `packages/core/src/programmatic/defineProgrammaticField.ts`
- Create: `packages/core/src/programmatic/__tests__/defineProgrammaticField.test.ts`
- Modify: `packages/core/src/config/types.ts`
- Modify: `packages/core/src/config/defineConfig.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces:
  - `programmaticField(options: ProgrammaticFieldOptions, resolve: Resolver): ProgrammaticFieldDefinition`
  - `type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }`
  - `type ResolverContext = { get(fieldName: string): unknown; readonly record: Readonly<Record<string, unknown>> }`
  - `type Resolver = (ctx: ResolverContext) => JsonValue | null | Promise<JsonValue | null>`
  - `type ProgrammaticFieldOptions = { schema: string; field: string; cache?: { ttl: number }; on_list?: boolean; fallback?: JsonValue | null; timeout?: number }`
  - `type ProgrammaticFieldDefinition = ProgrammaticFieldOptions & { readonly __manguito_programmatic: true; resolve: Resolver }`
  - `ResolvedManguitoConfig.programmatic: { dir: string }` (default `'./src/programmatic'`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/programmatic/__tests__/defineProgrammaticField.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { programmaticField } from '../defineProgrammaticField'

describe('programmaticField', () => {
  it('returns a branded definition carrying options and resolver', async () => {
    const def = programmaticField(
      { schema: 'content--blog_post', field: 'blog_summary', cache: { ttl: 300 }, on_list: true },
      (ctx) => `${ctx.get('a')}-${ctx.get('b')}`,
    )
    expect(def.__manguito_programmatic).toBe(true)
    expect(def.schema).toBe('content--blog_post')
    expect(def.field).toBe('blog_summary')
    expect(def.cache).toEqual({ ttl: 300 })
    expect(def.on_list).toBe(true)

    const value = await def.resolve({ get: (n) => (n === 'a' ? 'x' : 'y'), record: { a: 'x', b: 'y' } })
    expect(value).toBe('x-y')
  })

  it('defaults optional options to undefined (no cache, no list, no fallback)', () => {
    const def = programmaticField({ schema: 'content--x', field: 'y' }, () => null)
    expect(def.cache).toBeUndefined()
    expect(def.on_list).toBeUndefined()
    expect(def.fallback).toBeUndefined()
    expect(def.timeout).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/programmatic/__tests__/defineProgrammaticField.test.ts`
Expected: FAIL — module `../defineProgrammaticField` does not exist.

- [ ] **Step 3: Implement the factory**

Create `packages/core/src/programmatic/defineProgrammaticField.ts`:

```ts
// Public primitive: authors declare a programmatic field's binding + behavior
// and its resolver in one call. Framework-agnostic — no downstream imports.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// Same-row read context. `get` is synchronous — the record is already loaded
// before any resolver runs, so there is no I/O behind it.
export type ResolverContext = {
  get(fieldName: string): unknown
  readonly record: Readonly<Record<string, unknown>>
}

export type Resolver = (
  ctx: ResolverContext,
) => JsonValue | null | Promise<JsonValue | null>

export type ProgrammaticFieldOptions = {
  schema: string
  field: string
  cache?: { ttl: number }
  on_list?: boolean
  fallback?: JsonValue | null
  timeout?: number
}

export type ProgrammaticFieldDefinition = ProgrammaticFieldOptions & {
  readonly __manguito_programmatic: true
  resolve: Resolver
}

export function programmaticField(
  options: ProgrammaticFieldOptions,
  resolve: Resolver,
): ProgrammaticFieldDefinition {
  return { ...options, resolve, __manguito_programmatic: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/programmatic/__tests__/defineProgrammaticField.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the config option (test first)**

Append to `packages/core/src/config/__tests__/defineConfig.test.ts` a case (inside the existing top-level `describe`):

```ts
  it('defaults programmatic.dir to ./src/programmatic', () => {
    const resolved = defineConfig(baseConfig)
    expect(resolved.programmatic).toEqual({ dir: './src/programmatic' })
  })

  it('honors a custom programmatic.dir', () => {
    const resolved = defineConfig({ ...baseConfig, programmatic: { dir: './resolvers' } })
    expect(resolved.programmatic).toEqual({ dir: './resolvers' })
  })
```

If the existing test file has no reusable `baseConfig`, reuse whatever minimal valid config object the existing tests already construct (copy its shape — it must include `db`, `storage`, `server`, `api`, `admin`).

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/config/__tests__/defineConfig.test.ts`
Expected: FAIL — `resolved.programmatic` is `undefined`.

- [ ] **Step 7: Implement the config types + resolution**

In `packages/core/src/config/types.ts`, add near the schema-config section:

```ts
// ─── Programmatic Fields Config ───────────────────────────────────────────────

export type ProgrammaticConfig = {
  dir?: string
}

export type ResolvedProgrammaticConfig = {
  dir: string
}
```

Add to `ManguitoConfig` (optional) and `ResolvedManguitoConfig` (required):

```ts
export type ManguitoConfig = {
  name?: string
  schema?: SchemaConfig
  programmatic?: ProgrammaticConfig
  db: DbAdapter
  migrations?: MigrationsConfig
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}
```

```ts
export type ResolvedManguitoConfig = {
  name: string
  schema: ResolvedSchemaConfig
  programmatic: ResolvedProgrammaticConfig
  db: DbAdapter
  migrations: ResolvedMigrationsConfig | null
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}
```

In `packages/core/src/config/defineConfig.ts`, add the resolved field:

```ts
export function defineConfig(config: ManguitoConfig): ResolvedManguitoConfig {
  return {
    name: config.name ?? 'Manguito CMS',
    schema: resolveSchemaConfig(config.schema),
    programmatic: { dir: config.programmatic?.dir ?? './src/programmatic' },
    db: config.db,
    migrations: resolveMigrationsConfig(config.migrations, config.db),
    storage: config.storage,
    server: config.server,
    api: config.api,
    admin: config.admin,
  }
}
```

- [ ] **Step 8: Export from the package surface**

In `packages/core/src/index.ts`, add to the config-types `export type` block: `ProgrammaticConfig`, `ResolvedProgrammaticConfig`. Then add a new export block:

```ts
export { programmaticField } from './programmatic/defineProgrammaticField.js'

export type {
  JsonValue,
  ResolverContext,
  Resolver,
  ProgrammaticFieldOptions,
  ProgrammaticFieldDefinition,
} from './programmatic/defineProgrammaticField.js'
```

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @bobbykim/manguito-cms-core test`
Expected: PASS. Fix any other `defineConfig` snapshot/equality test that now needs the `programmatic` key.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/programmatic packages/core/src/config packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): add programmaticField factory and resolver dir config

Public programmaticField() primitive with ResolverContext/Resolver types,
and a resolved config.programmatic.dir (default ./src/programmatic).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `api` — the resolution engine

**Files:**
- Create: `packages/api/src/programmatic/resolve.ts`
- Create: `packages/api/src/programmatic/__tests__/resolve.test.ts`

**Interfaces:**
- Consumes: `ProgrammaticFieldDefinition`, `ResolverContext` from `@bobbykim/manguito-cms-core` (Task 2); `SchemaRegistry`, `ParsedContentType`, `ParsedTaxonomyType` from core.
- Produces:
  - `type ResolverMap = Map<string, ProgrammaticFieldDefinition>` (key = `` `${schema}::${field}` ``)
  - `resolverKey(schema: string, field: string): string`
  - `validateResolverBindings(registry: SchemaRegistry, resolvers: ResolverMap): void` — throws on any missing or orphan binding.
  - `createProgrammaticResolver(resolvers: ResolverMap): { resolveItem(schema, row): Promise<Record<string, unknown>>; resolveList(schema, rows): Promise<Record<string, unknown>[]>; hasSchema(schema): boolean }`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/programmatic/__tests__/resolve.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { programmaticField, type ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'
import { createProgrammaticResolver, resolverKey, validateResolverBindings, type ResolverMap } from '../resolve'

function mapOf(...defs: ProgrammaticFieldDefinition[]): ResolverMap {
  return new Map(defs.map((d) => [resolverKey(d.schema, d.field), d]))
}

const SCHEMA = 'content--blog_post'

describe('createProgrammaticResolver', () => {
  it('resolves same-row derived fields and merges them into the item', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'summary' }, (ctx) => `${ctx.get('title')}!`)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1', title: 'Hi' })
    expect(out).toEqual({ id: '1', title: 'Hi', summary: 'Hi!' })
  })

  it('coerces an undefined return to null', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x' }, () => undefined as unknown as null)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBeNull()
  })

  it('returns fallback when the resolver throws', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x', fallback: 'N/A' }, () => { throw new Error('boom') })
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBe('N/A')
  })

  it('returns fallback (null default) when the resolver exceeds its timeout', async () => {
    const def = programmaticField(
      { schema: SCHEMA, field: 'x', timeout: 20 },
      () => new Promise((r) => setTimeout(() => r('late'), 200)),
    )
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBeNull()
  })

  it('caches by item id for the ttl window', async () => {
    const fn = vi.fn(() => Date.now())
    const def = programmaticField({ schema: SCHEMA, field: 'ts', cache: { ttl: 60 } }, fn)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const a = await resolveItem(SCHEMA, { id: '1' })
    const b = await resolveItem(SCHEMA, { id: '1' })
    expect(a['ts']).toBe(b['ts'])
    expect(fn).toHaveBeenCalledTimes(1)
    const c = await resolveItem(SCHEMA, { id: '2' })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(c['ts']).not.toBe(a['ts'])
  })

  it('resolveList resolves only on_list fields', async () => {
    const listed = programmaticField({ schema: SCHEMA, field: 'shown', on_list: true }, () => 'yes')
    const hidden = programmaticField({ schema: SCHEMA, field: 'hidden' }, () => 'no')
    const { resolveList } = createProgrammaticResolver(mapOf(listed, hidden))
    const out = await resolveList(SCHEMA, [{ id: '1' }, { id: '2' }])
    expect(out).toEqual([{ id: '1', shown: 'yes' }, { id: '2', shown: 'yes' }])
  })

  it('hasSchema reflects whether any field targets the schema', () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x' }, () => null)
    const r = createProgrammaticResolver(mapOf(def))
    expect(r.hasSchema(SCHEMA)).toBe(true)
    expect(r.hasSchema('content--other')).toBe(false)
  })
})

describe('validateResolverBindings', () => {
  const registry = {
    content_types: {
      'content--blog_post': {
        name: 'content--blog_post',
        fields: [
          { name: 'title', field_type: 'text/plain' },
          { name: 'summary', field_type: 'programmatic' },
        ],
      },
    },
    taxonomy_types: {},
  } as unknown as import('@bobbykim/manguito-cms-core').SchemaRegistry

  it('passes when every programmatic field has exactly one resolver', () => {
    const def = programmaticField({ schema: 'content--blog_post', field: 'summary' }, () => null)
    expect(() => validateResolverBindings(registry, mapOf(def))).not.toThrow()
  })

  it('throws when a programmatic field has no resolver', () => {
    expect(() => validateResolverBindings(registry, new Map())).toThrow(/summary/)
  })

  it('throws when a resolver targets a non-existent field', () => {
    const def = programmaticField({ schema: 'content--blog_post', field: 'ghost' }, () => null)
    expect(() => validateResolverBindings(registry, mapOf(def))).toThrow(/ghost/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/programmatic/__tests__/resolve.test.ts`
Expected: FAIL — module `../resolve` does not exist.

- [ ] **Step 3: Implement the resolution engine**

Create `packages/api/src/programmatic/resolve.ts`:

```ts
import type {
  ProgrammaticFieldDefinition,
  ResolverContext,
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
} from '@bobbykim/manguito-cms-core'

export type ResolverMap = Map<string, ProgrammaticFieldDefinition>

const DEFAULT_TIMEOUT_MS = 5000
const LIST_CONCURRENCY = 10

export function resolverKey(schema: string, field: string): string {
  return `${schema}::${field}`
}

// ─── Boot-time binding validation ─────────────────────────────────────────────

// Startup guard (throws, like createCmsApp's storage/roles checks): every
// programmatic field must have exactly one resolver, and every resolver must
// target an existing programmatic field.
export function validateResolverBindings(
  registry: SchemaRegistry,
  resolvers: ResolverMap,
): void {
  const declared = new Set<string>()
  const schemas: Array<ParsedContentType | ParsedTaxonomyType> = [
    ...(Object.values(registry.content_types) as ParsedContentType[]),
    ...(Object.values(registry.taxonomy_types) as ParsedTaxonomyType[]),
  ]
  for (const schema of schemas) {
    for (const field of schema.fields) {
      if (field.field_type === 'programmatic') {
        declared.add(resolverKey(schema.name, field.name))
      }
    }
  }

  const missing: string[] = []
  for (const key of declared) if (!resolvers.has(key)) missing.push(key)

  const orphans: string[] = []
  for (const key of resolvers.keys()) if (!declared.has(key)) orphans.push(key)

  if (missing.length === 0 && orphans.length === 0) return

  const lines: string[] = ['✗ Programmatic field resolver bindings are invalid.']
  if (missing.length > 0) {
    lines.push('', '  Declared as `type: "programmatic"` but no resolver found:')
    for (const k of missing) lines.push(`    - ${k}  (add a programmaticField in src/programmatic)`)
  }
  if (orphans.length > 0) {
    lines.push('', '  Resolver has no matching programmatic field in the schema:')
    for (const k of orphans) lines.push(`    - ${k}`)
  }
  lines.push('', 'Exiting.')
  throw new Error(lines.join('\n'))
}

// ─── Runtime resolution ───────────────────────────────────────────────────────

function buildContext(row: Record<string, unknown>): ResolverContext {
  return {
    get: (name) => row[name],
    record: row,
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('resolver timeout')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// Runs one resolver against one row; never throws. Failure/timeout → fallback.
async function runOne(
  def: ProgrammaticFieldDefinition,
  row: Record<string, unknown>,
): Promise<unknown> {
  const fallback = def.fallback ?? null
  try {
    const result = await withTimeout(
      Promise.resolve(def.resolve(buildContext(row))),
      def.timeout ?? DEFAULT_TIMEOUT_MS,
    )
    return result === undefined ? null : result
  } catch (err) {
    process.stderr.write(
      `⚠ programmatic field ${resolverKey(def.schema, def.field)} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return fallback
  }
}

// Fixed-size worker pool.
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx]!)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
}

export function createProgrammaticResolver(resolvers: ResolverMap) {
  // Group definitions by schema once.
  const bySchema = new Map<string, ProgrammaticFieldDefinition[]>()
  for (const def of resolvers.values()) {
    const arr = bySchema.get(def.schema) ?? []
    arr.push(def)
    bySchema.set(def.schema, arr)
  }

  // Per-process cache. Key = schema::field::itemId.
  const cache = new Map<string, { value: unknown; expires: number }>()

  async function resolveField(
    def: ProgrammaticFieldDefinition,
    row: Record<string, unknown>,
  ): Promise<unknown> {
    const itemId = row['id'] !== undefined ? String(row['id']) : ''
    if (def.cache && itemId) {
      const key = `${resolverKey(def.schema, def.field)}::${itemId}`
      const now = Date.now()
      const hit = cache.get(key)
      if (hit && hit.expires > now) return hit.value
      const value = await runOne(def, row)
      cache.set(key, { value, expires: now + def.cache.ttl * 1000 })
      return value
    }
    return runOne(def, row)
  }

  async function resolveItem(
    schema: string,
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defs = bySchema.get(schema)
    if (!defs || defs.length === 0) return row
    const out: Record<string, unknown> = { ...row }
    await Promise.all(
      defs.map(async (def) => {
        out[def.field] = await resolveField(def, row)
      }),
    )
    return out
  }

  async function resolveList(
    schema: string,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const defs = (bySchema.get(schema) ?? []).filter((d) => d.on_list === true)
    if (defs.length === 0) return rows
    const out = rows.map((r) => ({ ...r }))
    const tasks: Array<{ rowIndex: number; def: ProgrammaticFieldDefinition }> = []
    for (let i = 0; i < rows.length; i++) {
      for (const def of defs) tasks.push({ rowIndex: i, def })
    }
    await runPool(tasks, LIST_CONCURRENCY, async ({ rowIndex, def }) => {
      out[rowIndex]![def.field] = await resolveField(def, rows[rowIndex]!)
    })
    return out
  }

  function hasSchema(schema: string): boolean {
    return bySchema.has(schema)
  }

  return { resolveItem, resolveList, hasSchema }
}

export type ProgrammaticResolver = ReturnType<typeof createProgrammaticResolver>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/programmatic/__tests__/resolve.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/programmatic
git commit -m "$(cat <<'EOF'
feat(api): add programmatic field resolution engine

Per-request resolver execution with timeout, fallback, opt-in TTL cache,
on_list gating with bounded concurrency, and boot-time binding validation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `api` — wire resolution into the public routes

**Files:**
- Modify: `packages/api/src/routes/content.ts`
- Modify: `packages/api/src/app.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/routes/__tests__/content.programmatic.test.ts` (create)

**Interfaces:**
- Consumes: `ProgrammaticResolver`, `ResolverMap`, `createProgrammaticResolver`, `validateResolverBindings` from Task 3.
- Produces: `registerPublicContentRoutes(app, registry, repos, listRateLimit?, resolver?)` — new optional 5th param `resolver?: ProgrammaticResolver`; `createCmsApp` accepts `resolvers?: ResolverMap`. `@bobbykim/manguito-cms-api` re-exports `ResolverMap`, `createProgrammaticResolver`, `validateResolverBindings`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/api/src/routes/__tests__/content.programmatic.test.ts`. This mirrors the fixtures/mocks in the existing `content.test.ts`; copy its `ContentRepository` mock shape:

```ts
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import type { ContentRepository, ParsedContentType, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { registerPublicContentRoutes } from '../content'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve'

const BLOG: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--blog_post',
  label: 'Blog Post',
  source_file: 'x.json',
  only_one: false,
  default_base_path: 'blog',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    { name: 'title', label: 'Title', field_type: 'text/plain', required: true, nullable: false, order: 0, validation: { required: true }, db_column: { column_name: 'title', column_type: 'varchar', nullable: false }, ui_component: { component: 'text-input' } },
    { name: 'summary', label: 'Summary', field_type: 'programmatic', required: false, nullable: true, order: 1, validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } },
    { name: 'live', label: 'Live', field_type: 'programmatic', required: false, nullable: true, order: 2, validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } },
  ],
  ui: { tabs: [] },
  db: { table_name: 'content_blog_post', junction_tables: [] },
  api: { default_base_path: 'blog', http_methods: ['GET'], collection_path: '/api/blog', item_path: '/api/blog/:slug' },
}

const REGISTRY = { content_types: { 'content--blog_post': BLOG }, taxonomy_types: {} } as unknown as SchemaRegistry

function repoWith(rows: Record<string, unknown>[]): ContentRepository<unknown> {
  return {
    findMany: async () => ({ ok: true, data: rows, pagination: { page: 1, per_page: 10, total: rows.length, total_pages: 1 } }),
    findBySlug: async (slug: string) => rows.find((r) => r['slug'] === slug) ?? null,
    findOne: async (id: string) => rows.find((r) => r['id'] === id) ?? null,
    create: async () => { throw new Error('unused') },
    update: async () => { throw new Error('unused') },
    delete: async () => { throw new Error('unused') },
  } as unknown as ContentRepository<unknown>
}

function resolverFor() {
  const summary = programmaticField({ schema: 'content--blog_post', field: 'summary' }, (ctx) => `S:${ctx.get('title')}`)
  const live = programmaticField({ schema: 'content--blog_post', field: 'live', on_list: true }, () => 'L')
  const map = new Map([
    [resolverKey('content--blog_post', 'summary'), summary],
    [resolverKey('content--blog_post', 'live'), live],
  ])
  return createProgrammaticResolver(map)
}

describe('programmatic resolution in public routes', () => {
  it('resolves all programmatic fields on a detail read', async () => {
    const app = new Hono()
    const rows = [{ id: '1', slug: 'a', title: 'Hi', published: true }]
    registerPublicContentRoutes(app, REGISTRY, { 'content--blog_post': repoWith(rows) }, undefined, resolverFor())
    const res = await app.request('/api/blog/a')
    const body = await res.json()
    expect(body.data.summary).toBe('S:Hi')
    expect(body.data.live).toBe('L')
  })

  it('resolves only on_list fields on a list read', async () => {
    const app = new Hono()
    const rows = [{ id: '1', slug: 'a', title: 'Hi', published: true }]
    registerPublicContentRoutes(app, REGISTRY, { 'content--blog_post': repoWith(rows) }, undefined, resolverFor())
    const res = await app.request('/api/blog')
    const body = await res.json()
    expect(body.data[0].live).toBe('L')
    expect(body.data[0].summary).toBeUndefined()
  })

  it('rejects a filter on a programmatic field with 400', async () => {
    const app = new Hono()
    registerPublicContentRoutes(app, REGISTRY, { 'content--blog_post': repoWith([]) }, undefined, resolverFor())
    const res = await app.request('/api/blog?filter[summary]=x')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_FILTER_FIELD')
  })
})
```

(If the existing `content.test.ts` mock uses different `findMany` return shape, match that shape here instead — check it before writing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.programmatic.test.ts`
Expected: FAIL — `registerPublicContentRoutes` ignores the 5th argument; programmatic fields absent from responses; filter on `summary` is accepted (no 400).

- [ ] **Step 3: Thread the resolver through content routes**

In `packages/api/src/routes/content.ts`:

Add the import at the top:

```ts
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
```

Change the signature (append `resolver`):

```ts
export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver,
): void {
```

Inside the content-type loop, build a filterable-field set that excludes programmatic fields (replace the existing `schemaFieldNames` usage for filters). Add after the existing `relationFieldNames` block:

```ts
    const filterableFieldNames = new Set<string>(
      [
        ...contentType.fields.filter((f) => f.field_type !== 'programmatic').map((f) => f.name),
        ...contentType.system_fields.map((f) => f.name),
      ],
    )
```

Change the `parseFilters` call to use `filterableFieldNames` instead of `schemaFieldNames`.

For the `only_one` detail handler, wrap the single item:

```ts
      app.get(`/api/${basePath}`, async (c) => {
        const result = await repo.findMany({ published_only: true, page: 1, per_page: 1 })
        if (result.data.length === 0) {
          return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
        }
        let data = result.data[0] as Record<string, unknown>
        if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
        return c.json({ ok: true, data })
      })
```

For the list handler, after `const result = await repo.findMany({ ... })` and before returning, resolve the list:

```ts
        if (resolver?.hasSchema(typeName)) {
          const resolved = await resolver.resolveList(typeName, result.data as Record<string, unknown>[])
          return c.json({ ...result, data: resolved })
        }
        return c.json(result)
```

For the `:slug` detail handler, wrap the item before returning:

```ts
        let data = item as Record<string, unknown>
        if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
        return c.json({ ok: true, data })
```

For the taxonomy loop, apply the same treatment: list handler → `resolveList` when `resolver?.hasSchema(typeName)`; `:id` detail handler → `resolveItem`. (Taxonomy has no filters block to change.)

- [ ] **Step 4: Accept and validate resolvers in createCmsApp**

In `packages/api/src/app.ts`:

Add imports:

```ts
import { createProgrammaticResolver, validateResolverBindings, type ResolverMap } from './programmatic/resolve.js'
```

Add to `CreateCmsAppOptions`:

```ts
  /** Programmatic field resolvers, keyed `${schema}::${field}`. */
  resolvers?: ResolverMap
```

After roles registry is built (near `buildRolesRegistry`), add binding validation + resolver construction:

```ts
  // Validate programmatic-field bindings at startup (throws on mismatch, like
  // the storage/roles checks above). Undefined resolvers ⇒ empty map.
  const resolverMap = options.resolvers ?? new Map()
  validateResolverBindings(registry, resolverMap)
  const programmaticResolver = createProgrammaticResolver(resolverMap)
```

Update the public-routes registration to pass the resolver (5th arg):

```ts
  registerPublicContentRoutes(app, registry, publicRepos, listRateLimit, programmaticResolver)
```

- [ ] **Step 5: Re-export the api helpers for the CLI**

In `packages/api/src/index.ts`, add:

```ts
export { createProgrammaticResolver, validateResolverBindings, resolverKey } from './programmatic/resolve.js'
export type { ResolverMap, ProgrammaticResolver } from './programmatic/resolve.js'
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.programmatic.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full api suite for regressions**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS. If `content.test.ts` calls `registerPublicContentRoutes` with a positional `listRateLimit`, it still works (resolver is the new trailing optional). Fix any call site that passed a 5th argument.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routes/content.ts packages/api/src/app.ts packages/api/src/index.ts packages/api/src/routes/__tests__/content.programmatic.test.ts
git commit -m "$(cat <<'EOF'
feat(api): resolve programmatic fields in public read routes

Detail reads resolve all programmatic fields; list reads resolve only
on_list fields. Programmatic fields excluded from filterable set.
createCmsApp validates resolver bindings at startup.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `cli` — runtime resolver discovery (dev)

**Files:**
- Create: `packages/cli/src/utils/programmatic-loader.ts`
- Create: `packages/cli/src/utils/__tests__/programmatic-loader.test.ts`

**Interfaces:**
- Consumes: `ProgrammaticFieldDefinition` from core; `ResolverMap`/`resolverKey` from `@bobbykim/manguito-cms-api`.
- Produces: `loadProgrammaticResolvers(cwd: string, dir: string): Promise<ResolverMap>` — walks `dir` for `.ts`/`.mjs`/`.js` files, dynamic-imports each, validates the default export is a programmatic definition (`__manguito_programmatic === true`), throws on a duplicate `schema::field`. Missing dir ⇒ empty map.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/utils/__tests__/programmatic-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProgrammaticResolvers } from '../programmatic-loader'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'prog-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

// A resolver module written as .mjs so it can be imported natively in tests.
function resolverModule(schema: string, field: string): string {
  return `export default { __manguito_programmatic: true, schema: ${JSON.stringify(schema)}, field: ${JSON.stringify(field)}, resolve: () => 'v' }\n`
}

describe('loadProgrammaticResolvers', () => {
  it('returns an empty map when the directory does not exist', async () => {
    const map = await loadProgrammaticResolvers(cwd, './src/programmatic')
    expect(map.size).toBe(0)
  })

  it('loads all resolver modules under the directory (recursive)', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'a.mjs'), resolverModule('content--x', 'a'))
    await writeFile(join(dir, 'nested', 'b.mjs'), resolverModule('content--x', 'b'))
    const map = await loadProgrammaticResolvers(cwd, './src/programmatic')
    expect(map.size).toBe(2)
    expect(map.has('content--x::a')).toBe(true)
    expect(map.has('content--x::b')).toBe(true)
  })

  it('throws on a duplicate schema::field binding', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.mjs'), resolverModule('content--x', 'dup'))
    await writeFile(join(dir, 'b.mjs'), resolverModule('content--x', 'dup'))
    await expect(loadProgrammaticResolvers(cwd, './src/programmatic')).rejects.toThrow(/dup/)
  })

  it('throws when a module default export is not a programmatic field', async () => {
    const dir = join(cwd, 'src', 'programmatic')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad.mjs'), 'export default { not: "a resolver" }\n')
    await expect(loadProgrammaticResolvers(cwd, './src/programmatic')).rejects.toThrow(/programmaticField/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/utils/__tests__/programmatic-loader.test.ts`
Expected: FAIL — module `../programmatic-loader` does not exist.

- [ ] **Step 3: Implement the loader**

Create `packages/cli/src/utils/programmatic-loader.ts`:

```ts
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'
import { resolverKey, type ResolverMap } from '@bobbykim/manguito-cms-api'

const RESOLVER_EXTENSIONS = new Set(['.ts', '.mjs', '.js'])

function isProgrammaticFieldDefinition(v: unknown): v is ProgrammaticFieldDefinition {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as { __manguito_programmatic?: unknown }).__manguito_programmatic === true &&
    typeof (v as { schema?: unknown }).schema === 'string' &&
    typeof (v as { field?: unknown }).field === 'string' &&
    typeof (v as { resolve?: unknown }).resolve === 'function'
  )
}

async function walkTsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkTsFiles(full)))
    } else if (RESOLVER_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

export async function loadProgrammaticResolvers(cwd: string, dir: string): Promise<ResolverMap> {
  const abs = resolve(cwd, dir)
  const map: ResolverMap = new Map()
  if (!existsSync(abs)) return map

  for (const file of (await walkTsFiles(abs)).sort()) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
    const def = mod.default
    if (!isProgrammaticFieldDefinition(def)) {
      throw new Error(
        `✗ ${file} does not default-export a programmaticField(). ` +
          `Each resolver file must \`export default programmaticField({ schema, field }, resolver)\`.`,
      )
    }
    const key = resolverKey(def.schema, def.field)
    if (map.has(key)) {
      throw new Error(`✗ Duplicate programmatic resolver for ${key} (found again in ${file}).`)
    }
    map.set(key, def)
  }
  return map
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/utils/__tests__/programmatic-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/utils/programmatic-loader.ts packages/cli/src/utils/__tests__/programmatic-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): discover programmatic resolvers at runtime for dev

loadProgrammaticResolvers walks the resolver dir, dynamic-imports each
module, validates the default export, and rejects duplicate bindings.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `cli` — build codegen + dev/build wiring

**Files:**
- Create: `packages/cli/src/codegen/programmatic-registry.ts`
- Create: `packages/cli/src/codegen/__tests__/programmatic-registry.test.ts`
- Modify: `packages/cli/src/codegen/server-entries.ts:22-41` (`appSetup`)
- Modify: `packages/cli/src/commands/build.ts`
- Modify: `packages/cli/src/commands/dev.ts`

**Interfaces:**
- Consumes: `loadProgrammaticResolvers` (Task 5); `config.programmatic.dir` (Task 2); `createCmsApp({ resolvers })` (Task 4).
- Produces: `generateProgrammaticRegistry(files: string[], targetDir: string): Promise<void>` — writes `programmatic-registry.ts` exporting `export const programmaticResolvers` (a `Map`). `appSetup()` imports it and passes `resolvers: programmaticResolvers`.

- [ ] **Step 1: Write the failing test for the codegen**

Create `packages/cli/src/codegen/__tests__/programmatic-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateProgrammaticRegistry } from '../programmatic-registry'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'reg-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('generateProgrammaticRegistry', () => {
  it('writes an empty map when there are no resolver files', async () => {
    await generateProgrammaticRegistry([], dir)
    const out = await readFile(join(dir, 'programmatic-registry.ts'), 'utf8')
    expect(out).toContain('export const programmaticResolvers')
    expect(out).toContain('new Map')
  })

  it('imports each file relative to the target dir and registers by schema::field', async () => {
    // Files live at <dir>/../src/programmatic/*.ts; import specifiers must be
    // relative to <dir> and use a .js extension.
    const fileA = join(dir, '..', 'src', 'programmatic', 'a.ts')
    await generateProgrammaticRegistry([fileA], dir)
    const out = await readFile(join(dir, 'programmatic-registry.ts'), 'utf8')
    expect(out).toContain("from '../src/programmatic/a.js'")
    // Registry keys are filled at runtime from each definition's schema/field:
    expect(out).toContain('def0.schema')
    expect(out).toContain('def0.field')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/codegen/__tests__/programmatic-registry.test.ts`
Expected: FAIL — module `../programmatic-registry` does not exist.

- [ ] **Step 3: Implement the codegen**

Create `packages/cli/src/codegen/programmatic-registry.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import type { ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'

// Import specifier from the generated file (in targetDir) to a resolver file,
// normalised to a POSIX relative path with a .js extension (esbuild/tsup resolve
// the .js specifier back to the .ts source, matching how the config is imported).
function importSpecifier(targetDir: string, file: string): string {
  let rel = relative(targetDir, file).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.ts$/, '.js')
}

export async function generateProgrammaticRegistry(
  files: string[],
  targetDir: string,
): Promise<void> {
  const sorted = [...files].sort()
  const imports = sorted
    .map((file, i) => `import def${i} from '${importSpecifier(targetDir, file)}'`)
    .join('\n')

  // Build the Map at runtime from each definition's own schema/field so the
  // generated file need not re-derive keys (keeping it robust to renames).
  const defs = sorted.map((_f, i) => `def${i}`)
  const entries = defs
    .map((d) => `  [\`\${${d}.schema}::\${${d}.field}\`, ${d}] as const`)
    .join(',\n')

  const typeImport =
    "import type { ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'"

  const body =
    sorted.length === 0
      ? `${typeImport}\n\nexport const programmaticResolvers = new Map<string, ProgrammaticFieldDefinition>()\n`
      : `${typeImport}\n${imports}\n\nexport const programmaticResolvers = new Map<string, ProgrammaticFieldDefinition>([\n${entries},\n])\n`

  await writeFile(join(targetDir, 'programmatic-registry.ts'), body, 'utf8')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/codegen/__tests__/programmatic-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the generated registry into `appSetup()`**

In `packages/cli/src/codegen/server-entries.ts`, update `appSetup()` to import the generated map and pass it. Replace the function body's template with:

```ts
export function appSetup(): string {
  return `import config from '../../manguito.config.js'
import { schemaRegistry } from './schema-registry.js'
import { programmaticResolvers } from './programmatic-registry.js'
import { createCmsApp } from '@bobbykim/manguito-cms-api'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'

const dbAdapter = createPostgresAdapter()
await dbAdapter.connect()

const { app } = createCmsApp({
  name: config.name,
  registry: schemaRegistry,
  db: dbAdapter.getDb(),
  storage: config.storage,
  prefix: config.api.prefix,
  resolvers: programmaticResolvers,
  ...(config.api.media ? { media: config.api.media } : {}),
  ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
  ...(config.server.cors ? { cors: config.server.cors } : {}),
})`
}
```

- [ ] **Step 6: Generate the registry during `manguito build`**

In `packages/cli/src/commands/build.ts`:

Add imports:

```ts
import { generateProgrammaticRegistry } from '../codegen/programmatic-registry.js'
```

Add a helper (below `walkFiles`, reuse it) or inline discovery using the existing `walkFiles`. After `await generateForms(...)` and before `generateServerEntries`, add:

```ts
  const programmaticDir = resolve(cwd, config.programmatic.dir)
  const resolverFiles = existsSync(programmaticDir)
    ? walkFiles(programmaticDir).filter((f) => /\.(ts|mjs|js)$/.test(f))
    : []
  await generateProgrammaticRegistry(resolverFiles, generatedDir)
```

(`walkFiles` and `existsSync` are already imported in build.ts.)

- [ ] **Step 7: Load resolvers in `manguito dev` and hot-swap on change**

In `packages/cli/src/commands/dev.ts`:

Add import:

```ts
import { loadProgrammaticResolvers } from '../utils/programmatic-loader.js'
```

Before the first `createCmsApp(...)` call (step 8 in dev.ts), load the map:

```ts
  let resolverMap = await loadProgrammaticResolvers(cwd, config.programmatic.dir)
```

Add `resolvers: resolverMap,` to both `createCmsApp({ ... })` calls (the initial one and the one inside `onSchemaFileChange`). For `onSchemaFileChange`, thread `resolverMap` in via its args object (add `resolverMap` to `OnSchemaFileChangeArgs` and pass it from the watcher closure), or recompute inside by calling `loadProgrammaticResolvers` again. Simplest: pass a getter. Add to `OnSchemaFileChangeArgs`:

```ts
  getResolvers: () => Promise<ResolverMap>
```

Import the type: `import type { ResolverMap } from '@bobbykim/manguito-cms-api'`. In the watcher call, pass `getResolvers: () => loadProgrammaticResolvers(cwd, config.programmatic.dir)`, and inside `onSchemaFileChange` before building `newAdapter`: `const resolverMap = await args.getResolvers()`, then add `resolvers: resolverMap` to the `createCmsApp` call there.

Also extend the fs watcher's filename filter so resolver-file edits trigger a reload. The current watcher only watches `schemasDir`. Add a second watch on the programmatic dir (guarded by existence) that calls the same `onSchemaFileChange` (schema re-parse is idempotent and cheap; it re-loads resolvers via `getResolvers`):

```ts
  const programmaticDir = resolve(cwd, config.programmatic.dir)
  if (existsSync(programmaticDir)) {
    const progWatcher = watch(programmaticDir, { recursive: true })
    void (async () => {
      for await (const event of progWatcher) {
        if (event.filename && /\.(ts|mjs|js)$/.test(event.filename)) {
          await onSchemaFileChange({ cwd, config, manguitoDir, drizzleConfigPath, db,
            updateFetch: (fetch) => { honoFetch = fetch },
            getResolvers: () => loadProgrammaticResolvers(cwd, config.programmatic.dir) })
        }
      }
    })()
  }
```

Import `existsSync` from `node:fs` at the top of dev.ts if not already present.

- [ ] **Step 8: Build the workspace to typecheck the wiring**

Run: `pnpm --filter @bobbykim/manguito-cms-cli build`
Expected: SUCCESS (no TypeScript errors). If `dev.ts` reports a type error on `OnSchemaFileChangeArgs`, ensure the `getResolvers` field and `ResolverMap` import are added.

- [ ] **Step 9: Run the cli suite**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/codegen/programmatic-registry.ts packages/cli/src/codegen/__tests__/programmatic-registry.test.ts packages/cli/src/codegen/server-entries.ts packages/cli/src/commands/build.ts packages/cli/src/commands/dev.ts
git commit -m "$(cat <<'EOF'
feat(cli): wire programmatic resolvers into dev and build

Build generates .manguito programmatic-registry.ts and appSetup passes it
to createCmsApp; dev loads resolvers at runtime and hot-swaps on change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `admin` — read-only placeholder rendering

**Files:**
- Create: `packages/admin/src/components/fields/ComputedDisplay.vue`
- Create: `packages/admin/src/components/fields/__tests__/ComputedDisplay.test.ts`
- Modify: `packages/admin/codegen/form-generator.ts`
- Test: `packages/admin/codegen/__tests__/form-generator.programmatic.test.ts` (create)

**Interfaces:**
- Consumes: `ParsedField` with `ui_component: { component: 'computed-display' }` (Task 1).
- Produces: `ComputedDisplay.vue` (props: `field: { label: string }`); form codegen emits a `<ComputedDisplay>` tag for programmatic fields with no `modelValue`/`error`/`disabled`/`@update` bindings (so the field never enters the submit payload).

- [ ] **Step 1: Write the failing codegen test**

Create `packages/admin/codegen/__tests__/form-generator.programmatic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateFormComponent } from '../form-generator'
import type { ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'

const TAXO: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--tag',
  label: 'Tag',
  source_file: 'x.json',
  system_fields: [],
  fields: [
    { name: 'label_field', label: 'Label', field_type: 'text/plain', required: true, nullable: false, order: 0, validation: { required: true }, db_column: { column_name: 'label_field', column_type: 'varchar', nullable: false }, ui_component: { component: 'text-input' } },
    { name: 'computed_one', label: 'Computed One', field_type: 'programmatic', required: false, nullable: true, order: 1, validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } },
  ],
  db: { table_name: 'taxonomy_tag' },
  api: { collection_path: '/api/taxonomy/tag', item_path: '/api/taxonomy/tag/:id' },
}

describe('form codegen for programmatic fields', () => {
  it('renders a ComputedDisplay with no value or update bindings', () => {
    const out = generateFormComponent(TAXO)
    expect(out).toContain('import ComputedDisplay from')
    expect(out).toContain('<ComputedDisplay')
    // No two-way binding for a computed field:
    const block = out.slice(out.indexOf('<ComputedDisplay'))
    expect(block).not.toContain(':modelValue="modelValue.computed_one"')
    expect(block).not.toContain("@update:modelValue=\"update('computed_one'")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test codegen/__tests__/form-generator.programmatic.test.ts`
Expected: FAIL — `COMPONENT_NAME['computed-display']` is undefined, so `renderField` throws / emits nothing usable.

- [ ] **Step 3: Add the mapping and render special-case**

In `packages/admin/codegen/form-generator.ts`:

Add to `COMPONENT_NAME`:

```ts
  'computed-display': 'ComputedDisplay',
```

Add to `COMPONENT_IMPORT`:

```ts
  ComputedDisplay: `${ADMIN_PKG}/src/components/fields/ComputedDisplay.vue`,
```

In `renderField`, special-case the computed field to render a display-only tag (place at the top of the function, before building the two-way-bound lines):

```ts
function renderField(field: ParsedField, indent: string): string {
  const compName = COMPONENT_NAME[field.ui_component.component]!
  const fieldObj = buildFieldObject(field)
  const attr = indent + '  '

  if (field.ui_component.component === 'computed-display') {
    return [`${indent}<${compName}`, `${attr}:field="${fieldObj}"`, `${indent}/>`].join('\n')
  }

  const lines: string[] = [`${indent}<${compName}`]
  lines.push(`${attr}:field="${fieldObj}"`)
  // ...unchanged remainder...
```

(The `buildFieldObject` `default` branch already produces `{ name, label, field_type, required }` — sufficient for the display.)

- [ ] **Step 4: Run the codegen test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test codegen/__tests__/form-generator.programmatic.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the component test**

Create `packages/admin/src/components/fields/__tests__/ComputedDisplay.test.ts` (match the render-test idiom used by the sibling `ReferenceSelect.test.ts` / `RichTextEditor.test.ts` — likely `@vue/test-utils` `mount`):

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ComputedDisplay from '../ComputedDisplay.vue'

describe('ComputedDisplay', () => {
  it('shows the label and a computed-at-read-time note, and emits nothing', () => {
    const wrapper = mount(ComputedDisplay, { props: { field: { label: 'My Summary' } } })
    expect(wrapper.text()).toContain('My Summary')
    expect(wrapper.text()).toContain('Computed at read time')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted()).toEqual({})
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test src/components/fields/__tests__/ComputedDisplay.test.ts`
Expected: FAIL — component file does not exist.

- [ ] **Step 7: Implement the component**

Create `packages/admin/src/components/fields/ComputedDisplay.vue`. Match the label/markup conventions of a sibling field component (open `TextInput.vue` first and mirror its label element + class names). A minimal implementation:

```vue
<!-- Read-only placeholder for a programmatic field. The value is computed at
     read time by the public API, so the admin shows the label only and never
     contributes this field to the submit payload. -->
<script setup lang="ts">
defineProps<{
  field: { label: string }
}>()
</script>

<template>
  <div class="field field--computed">
    <label class="field__label">{{ field.label }}</label>
    <p class="field__note">Computed at read time</p>
  </div>
</template>
```

(Adjust class names to match the sibling components' existing convention so styling is consistent.)

- [ ] **Step 8: Run the component test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test src/components/fields/__tests__/ComputedDisplay.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full admin suite**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/admin/src/components/fields/ComputedDisplay.vue packages/admin/src/components/fields/__tests__/ComputedDisplay.test.ts packages/admin/codegen/form-generator.ts packages/admin/codegen/__tests__/form-generator.programmatic.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): render programmatic fields as read-only placeholder

ComputedDisplay shows the label with a "computed at read time" note and is
generated without two-way bindings so it never enters the submit payload.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Integration verification (end-to-end in the sandbox)

**Files:**
- Modify: `apps/sandbox/schemas/content-types/content--blog_post.json` (add a programmatic field)
- Create: `apps/sandbox/src/programmatic/blog-summary.ts`

**Interfaces:**
- Consumes: every prior task, exercised through the real `manguito dev`/`build` path.

- [ ] **Step 1: Add a programmatic field to the sandbox blog schema**

In `apps/sandbox/schemas/content-types/content--blog_post.json`, inside the `primary_tab` fields array (after `blog_desc`), add:

```json
          {
            "name": "blog_summary",
            "label": "Summary",
            "type": "programmatic"
          }
```

- [ ] **Step 2: Add the resolver**

Create `apps/sandbox/src/programmatic/blog-summary.ts`:

```ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--blog_post', field: 'blog_summary', on_list: true },
  (ctx) => `${ctx.get('blog_title')} — ${String(ctx.get('blog_desc') ?? '').slice(0, 60)}`,
)
```

- [ ] **Step 3: Validate + build the sandbox**

Run: `pnpm --filter @bobbykim/manguito-cms-cli exec manguito validate` (from `apps/sandbox`, or the sandbox's build script). Then run the sandbox build.
Expected: schema validates; `dist/generated/programmatic-registry.ts` exists and imports `blog-summary`.

- [ ] **Step 4: Manual smoke (documented, not automated)**

With the sandbox dev server running and a published blog post, `GET /api/blog/<slug>` returns `data.blog_summary` as the derived string; `GET /api/blog` includes `blog_summary` on each item (because `on_list: true`); the admin blog form shows a read-only "Summary — Computed at read time" row with no input. Removing the resolver file and rebuilding fails fast with the binding-validation error naming `content--blog_post::blog_summary`.

- [ ] **Step 5: Run the whole workspace test suite**

Run: `pnpm test`
Expected: PASS across all packages.

- [ ] **Step 6: Commit**

```bash
git add apps/sandbox/schemas/content-types/content--blog_post.json apps/sandbox/src/programmatic/blog-summary.ts
git commit -m "$(cat <<'EOF'
test(sandbox): exercise programmatic field end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (design §3 decisions → task):
- §3.1 opt-in TTL cache → Task 3 (cache Map, `def.cache.ttl`), Task 2 (option type).
- §3.2 detail-only default + `on_list` + concurrency → Task 3 (`resolveList` gating + `runPool` cap 10), Task 4 (list vs detail wiring).
- §3.3 failure → `fallback ?? null`, 200, per-field timeout → Task 3 (`runOne`, `withTimeout`).
- §3.4 same-row `ctx` → Task 2 (`ResolverContext`), Task 3 (`buildContext`).
- §3.5 `required` ignored → Task 1 (optional in schema, coerced to `false`).
- §3.6 content + taxonomy → Task 4 (both loops), Task 3 (`validateResolverBindings` scans both).
- §3.7 admin read-only placeholder → Task 7.
- §3.8 explicit registration + generated registry → Task 5 (dev discovery), Task 6 (build codegen + wiring), Task 3 (boot validation).
- Cache key `schema::field::itemId` → Task 3 (`resolveField`).
- Filter safety (programmatic not filterable) → Task 4 (`filterableFieldNames`).
- Resolver dir default `./src/programmatic` → Task 2 (config), Task 6 (consumed).

**Placeholder scan:** no TBD/TODO; every code step shows complete code. Two steps say "match the sibling component/mock shape" (Task 4 mock, Task 7 component) — these reference concrete existing files to copy, not unwritten code.

**Type consistency:** `ProgrammaticFieldDefinition`, `ResolverContext`, `Resolver`, `JsonValue` defined in Task 2 and imported unchanged in Tasks 3–6. `ResolverMap`/`resolverKey`/`createProgrammaticResolver`/`validateResolverBindings` defined in Task 3, re-exported in Task 4, consumed in Tasks 5–6. `programmaticResolvers` (generated export) named identically in Task 6 codegen and `appSetup`. `resolver?` is the trailing 5th param of `registerPublicContentRoutes` in both Task 4 signature and its call in `app.ts`. `computed-display` UiComponent variant (Task 1) matches the codegen key and component test (Task 7).

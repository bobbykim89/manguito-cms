# GraphQL Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, query-only GraphQL surface to the public API as a subpath export of the `api` package, generated from the schema registry and reusing the published-only repositories, relation SQL, and programmatic resolver.

**Architecture:** A code-first `GraphQLSchema` is built from `SchemaRegistry` at startup. GraphQL Yoga serves it as a single Hono handler mounted at `/graphql` when enabled. Relations resolve lazily via per-request DataLoaders that wrap the existing `resolveRelationField`; programmatic fields via a memoized `resolveItem`. Depth/complexity limits (GraphQL Armor) and dev-only introspection guard the endpoint.

**Tech Stack:** TypeScript (strict, ESM), `graphql`, `graphql-yoga`, `@escape.tech/graphql-armor`, `dataloader`, Hono, Vitest.

**Design source:** [graphql-module.md](./graphql-module.md) and [graphql-implementation-design.md](./graphql-implementation-design.md). Read those first.

## Global Constraints

- **Layer boundaries:** the module lives in `packages/api/src/graphql/`. It may import from `core` and `db` only (never `admin`/`cli`). Admin surface is untouched.
- **Language:** TypeScript only, `strict` mode, Node 22+. No `.js` source files. Relative imports use the `.js` extension (ESM/NodeNext).
- **Result/throw:** internal expected failures use codes on `Error` (see `codeError` pattern), surfaced to GraphQL via `extensions.code`. Do not throw for expected conditions in library code paths that have a Result.
- **Naming:** GraphQL types are PascalCase, fields/queries camelCase; the schema/DB stay snake_case. Enum values are never translated (wire value == stored value).
- **Published-only:** every resolver reads through the published-only `publicRepos`; the admin repos are never referenced.
- **Subpath isolation (ADR api/0006):** the `.` entry of `api` must not statically import `graphql`/`graphql-yoga`. `app.ts` loads the handler via dynamic `import('./graphql/handler.js')` only when enabled.
- **Config defaults:** `maxDepth: 8`, `maxComplexity: 1000`, `enabled: false`; `graphiql`/`introspection` default to `process.env.NODE_ENV !== 'production'`.
- **Tests:** unit tests are pure (no DB); integration tests use real Postgres and require `DB_URL` from `.env.test` (ADR 0003). Run a single package's tests with `pnpm --filter @bobbykim/manguito-cms-api test`.
- **Commits:** conventional commits, `type(scope): subject`. Scope is `graphql` for module work.

---

## File Structure

All new source under `packages/api/src/graphql/` unless noted:

| File | Responsibility |
|------|----------------|
| `naming.ts` | name derivation (segment, Pascal/camel, pluralize), `isValidGraphQLName`, per-type field-name map |
| `scalars.ts` | `DateTimeScalar`, `JSONScalar` |
| `type-mapping.ts` | `scalarOutputType(fieldType)` |
| `filters.ts` | scalar filter input types, `<Type>Filter` + `<Type>SortField` builders, `translateFilters` |
| `context.ts` | `GraphQLContext` interface |
| `dataloaders.ts` | `createRelationLoaders(db, registry)` wrapping `resolveRelationField` |
| `resolvers.ts` | field + root resolver factories |
| `schema.ts` | `buildGraphQLSchema(registry)` |
| `security.ts` | `buildArmorPlugins`, `introspectionPlugin` |
| `handler.ts` | `createGraphQLHandler(...)`, `ResolvedGraphQLOptions` |
| `index.ts` | subpath public API |

Wiring changes: `packages/core/src/config/types.ts` (config types + `APIAdapter.graphql?`), `packages/api/src/index.ts` (`createAPIAdapter`), `packages/api/src/app.ts` (mount), `packages/api/package.json` + `packages/api/tsup.config.ts` (export), `packages/cli/src/commands/dev.ts` + `packages/cli/src/codegen/server-entries.ts` (glue).

---

## Task 1: Naming module

**Files:**
- Create: `packages/api/src/graphql/naming.ts`
- Test: `packages/api/src/graphql/__tests__/naming.test.ts`

**Interfaces:**
- Produces: `schemaSegment(machineName: string): string`, `toPascalCase(s: string): string`, `toCamelCase(s: string): string`, `pluralize(word: string): string`, `isValidGraphQLName(name: string): boolean`, `graphqlTypeName(machineName: string): string`, `singleQueryName(machineName: string): string`, `collectionQueryName(machineName: string): string`, `buildFieldNameMap(schemaNames: string[]): { toGraphql(schemaName: string): string; toSchema(graphqlName: string): string }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/graphql/__tests__/naming.test.ts
import { describe, it, expect } from 'vitest'
import {
  schemaSegment,
  toPascalCase,
  toCamelCase,
  pluralize,
  isValidGraphQLName,
  graphqlTypeName,
  singleQueryName,
  collectionQueryName,
  buildFieldNameMap,
} from '../naming'

describe('naming', () => {
  it('extracts the machine-name segment after "--"', () => {
    expect(schemaSegment('content--blog_post')).toBe('blog_post')
    expect(schemaSegment('category')).toBe('category')
  })

  it('converts snake_case to Pascal and camel case', () => {
    expect(toPascalCase('blog_post')).toBe('BlogPost')
    expect(toCamelCase('created_at')).toBe('createdAt')
    expect(toCamelCase('blog_post')).toBe('blogPost')
  })

  it('pluralizes common English forms', () => {
    expect(pluralize('blogPost')).toBe('blogPosts')
    expect(pluralize('category')).toBe('categories')
    expect(pluralize('box')).toBe('boxes')
    expect(pluralize('dish')).toBe('dishes')
  })

  it('validates GraphQL identifier names', () => {
    expect(isValidGraphQLName('draft')).toBe(true)
    expect(isValidGraphQLName('IN_PROGRESS')).toBe(true)
    expect(isValidGraphQLName('in-progress')).toBe(false)
    expect(isValidGraphQLName('2024')).toBe(false)
    expect(isValidGraphQLName('high priority')).toBe(false)
  })

  it('derives type and query names from a machine name', () => {
    expect(graphqlTypeName('content--blog_post')).toBe('BlogPost')
    expect(singleQueryName('content--blog_post')).toBe('blogPost')
    expect(collectionQueryName('content--blog_post')).toBe('blogPosts')
  })

  it('maps field names bidirectionally', () => {
    const m = buildFieldNameMap(['created_at', 'blog_title'])
    expect(m.toGraphql('created_at')).toBe('createdAt')
    expect(m.toSchema('createdAt')).toBe('created_at')
    expect(m.toSchema('blogTitle')).toBe('blog_title')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- naming`
Expected: FAIL — cannot find module `../naming`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/api/src/graphql/naming.ts

// "content--blog_post" → "blog_post"; "category" → "category"
export function schemaSegment(machineName: string): string {
  const idx = machineName.indexOf('--')
  return idx === -1 ? machineName : machineName.slice(idx + 2)
}

function words(input: string): string[] {
  return input.split(/[_\s-]+/).filter(Boolean)
}

export function toPascalCase(input: string): string {
  return words(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// Deterministic English pluralization for the common cases; irregular plurals
// (person→people) are a known limitation — an optional per-type override can be
// added later if one is wrong.
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es'
  return word + 's'
}

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/
export function isValidGraphQLName(name: string): boolean {
  return GRAPHQL_NAME.test(name)
}

export function graphqlTypeName(machineName: string): string {
  return toPascalCase(schemaSegment(machineName))
}

export function singleQueryName(machineName: string): string {
  return toCamelCase(schemaSegment(machineName))
}

export function collectionQueryName(machineName: string): string {
  return pluralize(singleQueryName(machineName))
}

export function buildFieldNameMap(schemaNames: string[]): {
  toGraphql(schemaName: string): string
  toSchema(graphqlName: string): string
} {
  const toG = new Map<string, string>()
  const toS = new Map<string, string>()
  for (const name of schemaNames) {
    const g = toCamelCase(name)
    toG.set(name, g)
    toS.set(g, name)
  }
  return {
    toGraphql: (schemaName) => toG.get(schemaName) ?? toCamelCase(schemaName),
    toSchema: (graphqlName) => toS.get(graphqlName) ?? graphqlName,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- naming`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/naming.ts packages/api/src/graphql/__tests__/naming.test.ts
git commit -m "feat(graphql): add name derivation and field-name mapping"
```

---

## Task 2: Custom scalars

**Files:**
- Modify: `packages/api/package.json` (add `graphql` dependency)
- Create: `packages/api/src/graphql/scalars.ts`
- Test: `packages/api/src/graphql/__tests__/scalars.test.ts`

**Interfaces:**
- Consumes: `graphql` package (`GraphQLScalarType`, `Kind`).
- Produces: `DateTimeScalar: GraphQLScalarType`, `JSONScalar: GraphQLScalarType`.

- [ ] **Step 1: Add the `graphql` dependency**

Run:
```bash
pnpm --filter @bobbykim/manguito-cms-api add graphql@^16.9.0
```
Expected: `graphql` appears under `dependencies` in `packages/api/package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/api/src/graphql/__tests__/scalars.test.ts
import { describe, it, expect } from 'vitest'
import { DateTimeScalar, JSONScalar } from '../scalars'

describe('DateTimeScalar', () => {
  it('serializes Date and ISO string to ISO-8601', () => {
    const d = new Date('2026-07-19T10:00:00.000Z')
    expect(DateTimeScalar.serialize(d)).toBe('2026-07-19T10:00:00.000Z')
    expect(DateTimeScalar.serialize('2026-07-19T10:00:00.000Z')).toBe('2026-07-19T10:00:00.000Z')
  })
})

describe('JSONScalar', () => {
  it('serializes arbitrary JSON values unchanged', () => {
    expect(JSONScalar.serialize({ a: 1 })).toEqual({ a: 1 })
    expect(JSONScalar.serialize([1, 2])).toEqual([1, 2])
    expect(JSONScalar.serialize('x')).toBe('x')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- scalars`
Expected: FAIL — cannot find module `../scalars`.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/api/src/graphql/scalars.ts
import { GraphQLScalarType, Kind } from 'graphql'

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string',
  serialize(value) {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    if (typeof value === 'number') return new Date(value).toISOString()
    throw new TypeError(`DateTime cannot serialize value: ${String(value)}`)
  },
  parseValue(value) {
    if (typeof value !== 'string') throw new TypeError('DateTime must be a string')
    return value
  },
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) throw new TypeError('DateTime must be a string')
    return ast.value
  },
})

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value)
      case Kind.NULL:
        return null
      default:
        return null
    }
  },
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- scalars`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/package.json packages/api/src/graphql/scalars.ts packages/api/src/graphql/__tests__/scalars.test.ts ../../pnpm-lock.yaml
git commit -m "feat(graphql): add DateTime and JSON scalars"
```

---

## Task 3: Field-type → scalar mapping

**Files:**
- Create: `packages/api/src/graphql/type-mapping.ts`
- Test: `packages/api/src/graphql/__tests__/type-mapping.test.ts`

**Interfaces:**
- Consumes: `FieldType` from core; `DateTimeScalar`/`JSONScalar` from Task 2; `graphql` scalar singletons.
- Produces: `scalarOutputType(fieldType: FieldType): GraphQLScalarType | null` — returns a scalar for scalar field types, `null` for `enum`/`reference`/`paragraph`/`image`/`video`/`file` (relation and enum types are built in `schema.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/graphql/__tests__/type-mapping.test.ts
import { describe, it, expect } from 'vitest'
import { GraphQLString, GraphQLInt, GraphQLFloat, GraphQLBoolean } from 'graphql'
import { scalarOutputType } from '../type-mapping'
import { DateTimeScalar, JSONScalar } from '../scalars'

describe('scalarOutputType', () => {
  it('maps scalar field types', () => {
    expect(scalarOutputType('text/plain')).toBe(GraphQLString)
    expect(scalarOutputType('text/rich')).toBe(GraphQLString)
    expect(scalarOutputType('integer')).toBe(GraphQLInt)
    expect(scalarOutputType('float')).toBe(GraphQLFloat)
    expect(scalarOutputType('boolean')).toBe(GraphQLBoolean)
    expect(scalarOutputType('date')).toBe(DateTimeScalar)
    expect(scalarOutputType('programmatic')).toBe(JSONScalar)
  })

  it('returns null for relation and enum field types', () => {
    expect(scalarOutputType('enum')).toBeNull()
    expect(scalarOutputType('reference')).toBeNull()
    expect(scalarOutputType('paragraph')).toBeNull()
    expect(scalarOutputType('image')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- type-mapping`
Expected: FAIL — cannot find module `../type-mapping`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/api/src/graphql/type-mapping.ts
import {
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  type GraphQLScalarType,
} from 'graphql'
import type { FieldType } from '@bobbykim/manguito-cms-core'
import { DateTimeScalar, JSONScalar } from './scalars.js'

// Scalar output type for a field. Relation/enum fields return null — schema.ts
// resolves those against its type caches.
export function scalarOutputType(fieldType: FieldType): GraphQLScalarType | null {
  switch (fieldType) {
    case 'text/plain':
    case 'text/rich':
      return GraphQLString
    case 'integer':
      return GraphQLInt
    case 'float':
      return GraphQLFloat
    case 'boolean':
      return GraphQLBoolean
    case 'date':
      return DateTimeScalar
    case 'programmatic':
      return JSONScalar
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- type-mapping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/type-mapping.ts packages/api/src/graphql/__tests__/type-mapping.test.ts
git commit -m "feat(graphql): map scalar field types to GraphQL scalars"
```

---

## Task 4: Filter inputs, sort enum, and filter translation

**Files:**
- Create: `packages/api/src/graphql/filters.ts`
- Test: `packages/api/src/graphql/__tests__/filters.test.ts`

**Interfaces:**
- Consumes: `ParsedContentType`/`ParsedTaxonomyType`/`FilterValue` from core; `buildFieldNameMap` from Task 1; `scalarOutputType` from Task 3; `graphql` input/enum constructors.
- Produces:
  - `SortOrderEnum: GraphQLEnumType` (`ASC|DESC`).
  - `buildSortFieldEnum(typeName: string): GraphQLEnumType` — values `title`, `createdAt`, `updatedAt` whose internal values are the snake_case columns.
  - `buildFilterInputType(type: ParsedContentType | ParsedTaxonomyType): GraphQLInputObjectType | null`.
  - `translateFilters(input: Record<string, unknown> | undefined, nameMap: { toSchema(g: string): string }): Record<string, FilterValue>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/graphql/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest'
import { buildFieldNameMap } from '../naming'
import { SortOrderEnum, buildSortFieldEnum, translateFilters } from '../filters'

describe('sort enums', () => {
  it('SortOrderEnum has ASC/DESC', () => {
    expect(SortOrderEnum.getValues().map((v) => v.name).sort()).toEqual(['ASC', 'DESC'])
  })

  it('sort field enum maps camelCase names to snake_case columns', () => {
    const e = buildSortFieldEnum('BlogPost')
    const created = e.getValue('createdAt')
    expect(created?.value).toBe('created_at')
    expect(e.getValue('title')?.value).toBe('title')
  })
})

describe('translateFilters', () => {
  const nameMap = buildFieldNameMap(['created_at', 'blog_title'])

  it('translates eq / in / operators to repo filters keyed by column', () => {
    const result = translateFilters(
      {
        blogTitle: { eq: 'Hello' },
        createdAt: { gt: '2026-01-01', lte: '2026-12-31' },
        category: { in: ['a', 'b'] },
      },
      nameMap
    )
    expect(result).toEqual({
      blog_title: 'Hello',
      created_at: { gt: '2026-01-01', lte: '2026-12-31' },
      category: ['a', 'b'],
    })
  })

  it('returns an empty object for undefined input', () => {
    expect(translateFilters(undefined, nameMap)).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- filters`
Expected: FAIL — cannot find module `../filters`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/api/src/graphql/filters.ts
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  GraphQLBoolean,
  type GraphQLInputType,
} from 'graphql'
import type {
  ParsedContentType,
  ParsedTaxonomyType,
  FilterValue,
  FilterOperator,
} from '@bobbykim/manguito-cms-core'
import { graphqlTypeName, buildFieldNameMap } from './naming.js'
import { scalarOutputType } from './type-mapping.js'
import { DateTimeScalar } from './scalars.js'

export const SortOrderEnum = new GraphQLEnumType({
  name: 'SortOrder',
  values: { ASC: { value: 'asc' }, DESC: { value: 'desc' } },
})

// Only these system fields are sortable (mirrors the REST SORTABLE_FIELDS).
const SORTABLE: Array<{ gql: string; column: string }> = [
  { gql: 'title', column: 'title' },
  { gql: 'createdAt', column: 'created_at' },
  { gql: 'updatedAt', column: 'updated_at' },
]

export function buildSortFieldEnum(typeName: string): GraphQLEnumType {
  return new GraphQLEnumType({
    name: `${typeName}SortField`,
    values: Object.fromEntries(SORTABLE.map((s) => [s.gql, { value: s.column }])),
  })
}

// A comparable filter input (eq/in/gt/gte/lt/lte) for a given scalar input type.
function comparableFilterInput(name: string, scalar: GraphQLInputType): GraphQLInputObjectType {
  return new GraphQLInputObjectType({
    name,
    fields: {
      eq: { type: scalar },
      in: { type: new GraphQLList(new GraphQLNonNull(scalar)) },
      gt: { type: scalar },
      gte: { type: scalar },
      lt: { type: scalar },
      lte: { type: scalar },
    },
  })
}

function equalityFilterInput(name: string, scalar: GraphQLInputType): GraphQLInputObjectType {
  return new GraphQLInputObjectType({
    name,
    fields: {
      eq: { type: scalar },
      in: { type: new GraphQLList(new GraphQLNonNull(scalar)) },
    },
  })
}

// Shared per-scalar filter inputs (built once).
const StringFilter = equalityFilterInput('StringFilter', GraphQLString)
const BooleanFilter = new GraphQLInputObjectType({
  name: 'BooleanFilter',
  fields: { eq: { type: GraphQLBoolean } },
})
const DateTimeFilter = comparableFilterInput('DateTimeFilter', DateTimeScalar)
const IDFilter = equalityFilterInput('IDFilter', GraphQLString)

// Choose a filter input for a field based on its scalar output type.
function filterInputForField(fieldType: string): GraphQLInputObjectType | null {
  const scalar = scalarOutputType(fieldType as never)
  if (fieldType === 'boolean') return BooleanFilter
  if (fieldType === 'date') return DateTimeFilter
  if (fieldType === 'integer' || fieldType === 'float') {
    return comparableFilterInput(
      fieldType === 'integer' ? 'IntFilter' : 'FloatFilter',
      scalar ?? GraphQLString
    )
  }
  if (fieldType === 'reference') return IDFilter
  if (scalar === null) return null // enum/paragraph/media/programmatic → not filterable here
  return StringFilter
}

// Build the <Type>Filter input. Programmatic fields are excluded (no column).
export function buildFilterInputType(
  type: ParsedContentType | ParsedTaxonomyType
): GraphQLInputObjectType | null {
  const fields: Record<string, { type: GraphQLInputObjectType }> = {}

  // System fields that are filterable columns.
  fields['id'] = { type: IDFilter }
  fields['published'] = { type: BooleanFilter }
  fields['createdAt'] = { type: DateTimeFilter }
  fields['updatedAt'] = { type: DateTimeFilter }
  if (type.schema_type === 'content-type') fields['slug'] = { type: StringFilter }

  for (const f of type.fields) {
    if (f.field_type === 'programmatic' || f.field_type === 'paragraph') continue
    if (f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file') continue
    const input = filterInputForField(f.field_type)
    if (input) fields[buildFieldNameMap([f.name]).toGraphql(f.name)] = { type: input }
  }

  if (Object.keys(fields).length === 0) return null
  return new GraphQLInputObjectType({ name: `${graphqlTypeName(type.name)}Filter`, fields })
}

// Convert a GraphQL filter argument into the repository's filters map, keyed by
// snake_case column. eq → scalar, in → array (OR/IN), gt/gte/lt/lte → operator.
export function translateFilters(
  input: Record<string, unknown> | undefined,
  nameMap: { toSchema(g: string): string }
): Record<string, FilterValue> {
  const out: Record<string, FilterValue> = {}
  if (!input) return out

  for (const [gqlField, raw] of Object.entries(input)) {
    if (raw === null || typeof raw !== 'object') continue
    const column = nameMap.toSchema(gqlField)
    const spec = raw as Record<string, unknown>

    if (spec['eq'] !== undefined) {
      out[column] = spec['eq'] as FilterValue
    } else if (Array.isArray(spec['in'])) {
      out[column] = spec['in'] as FilterValue
    } else {
      const op: FilterOperator = {}
      for (const k of ['gt', 'gte', 'lt', 'lte'] as const) {
        if (spec[k] !== undefined) op[k] = spec[k] as number | string
      }
      if (Object.keys(op).length > 0) out[column] = op
    }
  }
  return out
}
```

> Note: `nameMap` passed to `translateFilters` must be built from the type's field names (Task 6 builds one per type and passes it here). The `buildFieldNameMap([f.name])` call inside `buildFilterInputType` is only for the field's own camelCase key and is self-contained.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- filters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/filters.ts packages/api/src/graphql/__tests__/filters.test.ts
git commit -m "feat(graphql): add filter inputs, sort enum, and filter translation"
```

---

## Task 5: Context type and relation dataloaders

**Files:**
- Modify: `packages/api/package.json` (add `dataloader` dependency)
- Create: `packages/api/src/graphql/context.ts`
- Create: `packages/api/src/graphql/dataloaders.ts`
- Test: `packages/api/src/graphql/__tests__/dataloaders.test.ts`

**Interfaces:**
- Consumes: `DrizzlePostgresInstance` (db), `SchemaRegistry`, `ContentRepository`, `ProgrammaticResolver`; `buildRelationsMap`/`resolveRelationField`/`RelationDef` from `../relations.js`; `dataloader`.
- Produces:
  - `context.ts`: `interface GraphQLContext { db; registry; repos: Record<string, ContentRepository<unknown>>; resolver: ProgrammaticResolver; loaders: RelationLoaders; programmaticMemo: WeakMap<object, Promise<Record<string, unknown>>> }`.
  - `dataloaders.ts`: `interface RelationLoaders { load(typeName: string, fieldName: string, parent: Record<string, unknown>): Promise<unknown> }` and `createRelationLoaders(db, registry): RelationLoaders`.

- [ ] **Step 1: Add the `dataloader` dependency**

Run:
```bash
pnpm --filter @bobbykim/manguito-cms-api add dataloader@^2.2.3
```
Expected: `dataloader` under `dependencies`.

- [ ] **Step 2: Write the failing test** (stub db verifies batching + delegation)

```ts
// packages/api/src/graphql/__tests__/dataloaders.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createRelationLoaders } from '../dataloaders'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import * as relations from '../../relations'

// A registry with one content type "post" holding a reference field "author".
const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type',
      name: 'content--post',
      fields: [
        {
          name: 'author',
          field_type: 'reference',
          db_column: {
            column_name: 'author_id',
            foreign_key: { table: 'content--author', column: 'id', on_delete: 'SET NULL' },
          },
        },
      ],
    },
  },
  taxonomy_types: {},
  paragraph_types: {},
} as unknown as SchemaRegistry

describe('createRelationLoaders', () => {
  it('batches sibling parents into one resolveRelationField call', async () => {
    const spy = vi
      .spyOn(relations, 'resolveRelationField')
      .mockImplementation(async (_db, rows, fieldName) => {
        for (const r of rows as Record<string, unknown>[]) r[fieldName] = { id: r['author_id'] }
      })

    const db = {} as never
    const loaders = createRelationLoaders(db, registry)
    const p1 = { id: '1', author_id: 'a1' }
    const p2 = { id: '2', author_id: 'a2' }

    const [r1, r2] = await Promise.all([
      loaders.load('content--post', 'author', p1),
      loaders.load('content--post', 'author', p2),
    ])

    expect(r1).toEqual({ id: 'a1' })
    expect(r2).toEqual({ id: 'a2' })
    // Both loads batched → resolveRelationField called exactly once with both rows.
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0]![1] as unknown[]).length).toBe(2)
    spy.mockRestore()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- dataloaders`
Expected: FAIL — cannot find module `../dataloaders`.

- [ ] **Step 4: Write the context type**

```ts
// packages/api/src/graphql/context.ts
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { RelationLoaders } from './dataloaders.js'

export interface GraphQLContext {
  db: DrizzlePostgresInstance
  registry: SchemaRegistry
  repos: Record<string, ContentRepository<unknown>>
  resolver: ProgrammaticResolver
  loaders: RelationLoaders
  // Per-request memo: a parent row → its resolveItem() promise (all programmatic
  // fields computed once per parent, only when the first is selected).
  programmaticMemo: WeakMap<object, Promise<Record<string, unknown>>>
}
```

- [ ] **Step 5: Write the dataloaders implementation**

```ts
// packages/api/src/graphql/dataloaders.ts
import DataLoader from 'dataloader'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
} from '@bobbykim/manguito-cms-core'
import { buildRelationsMap, resolveRelationField, type RelationDef } from '../relations.js'

export interface RelationLoaders {
  load(typeName: string, fieldName: string, parent: Record<string, unknown>): Promise<unknown>
}

type ParentRow = Record<string, unknown>

// One RelationLoaders instance per request. Loaders batch sibling parents per
// (type, field); the shared cache dedupes target lookups across all loaders in
// the request, mirroring the repository's resolveRows cache.
export function createRelationLoaders(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry
): RelationLoaders {
  const relMaps = new Map<string, Record<string, RelationDef>>()
  const loaders = new Map<string, DataLoader<ParentRow, unknown>>()
  const cache = new Map<string, unknown>()

  function relationsFor(typeName: string): Record<string, RelationDef> {
    let m = relMaps.get(typeName)
    if (!m) {
      const type = (registry.content_types[typeName] ??
        registry.taxonomy_types[typeName]) as ParsedContentType | ParsedTaxonomyType | undefined
      m = type ? buildRelationsMap(type.fields, registry) : {}
      relMaps.set(typeName, m)
    }
    return m
  }

  function loaderFor(typeName: string, fieldName: string, rel: RelationDef): DataLoader<ParentRow, unknown> {
    const key = `${typeName}:${fieldName}`
    let dl = loaders.get(key)
    if (!dl) {
      dl = new DataLoader<ParentRow, unknown>(
        async (parents) => {
          const rows = parents as ParentRow[]
          await resolveRelationField(db, rows, fieldName, rel, cache)
          return rows.map((r) => r[fieldName])
        },
        // Batch within a tick; do not memoize by parent identity (rows are mutated
        // and may recur across nesting levels).
        { cache: false }
      )
      loaders.set(key, dl)
    }
    return dl
  }

  return {
    async load(typeName, fieldName, parent) {
      const rel = relationsFor(typeName)[fieldName]
      if (!rel) return null
      return loaderFor(typeName, fieldName, rel).load(parent)
    },
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- dataloaders`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/package.json packages/api/src/graphql/context.ts packages/api/src/graphql/dataloaders.ts packages/api/src/graphql/__tests__/dataloaders.test.ts ../../pnpm-lock.yaml
git commit -m "feat(graphql): add request context and relation dataloaders"
```

---

## Task 6: Resolver factories

**Files:**
- Create: `packages/api/src/graphql/resolvers.ts`
- Test: covered by the schema component test in Task 7 (resolvers are pure factories exercised end-to-end there).

**Interfaces:**
- Consumes: `GraphQLContext` (Task 5); `translateFilters` (Task 4); `ContentRepository`/`FindManyOptions` from core.
- Produces:
  - `scalarFieldResolver(schemaName: string)` → `(parent) => unknown`
  - `relationFieldResolver(typeName: string, schemaFieldName: string)` → `(parent, args, ctx) => Promise<unknown>`
  - `programmaticFieldResolver(typeName: string, schemaFieldName: string)` → `(parent, args, ctx) => Promise<unknown>`
  - `collectionResolver(typeName: string, nameMap)` → `(root, args, ctx) => Promise<{ data: unknown[]; meta: unknown }>`
  - `singleBySlugResolver(typeName: string)` → `(root, args, ctx) => Promise<unknown | null>`
  - `singletonResolver(typeName: string)` → `(root, args, ctx) => Promise<unknown | null>`
  - `taxonomySingleResolver(typeName: string)` → `(root, args, ctx) => Promise<unknown | null>`

- [ ] **Step 1: Write the implementation** (resolvers are validated by Task 7's component test; no standalone unit test)

```ts
// packages/api/src/graphql/resolvers.ts
import { GraphQLError } from 'graphql'
import type { GraphQLContext } from './context.js'
import { translateFilters } from './filters.js'

type Row = Record<string, unknown>

function codeError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } })
}

function isPublished(item: Row | null): boolean {
  return !!item && item['published'] === true
}

export function scalarFieldResolver(schemaName: string) {
  return (parent: Row): unknown => parent[schemaName]
}

export function relationFieldResolver(typeName: string, schemaFieldName: string) {
  return (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> =>
    ctx.loaders.load(typeName, schemaFieldName, parent)
}

export function programmaticFieldResolver(typeName: string, schemaFieldName: string) {
  return async (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> => {
    let p = ctx.programmaticMemo.get(parent)
    if (!p) {
      p = ctx.resolver.resolveItem(typeName, parent)
      ctx.programmaticMemo.set(parent, p)
    }
    return (await p)[schemaFieldName]
  }
}

type CollectionArgs = {
  page?: number
  perPage?: number
  sortBy?: string // already the snake_case column (enum internal value)
  sortOrder?: 'asc' | 'desc'
  filter?: Record<string, unknown>
}

export function collectionResolver(
  typeName: string,
  nameMap: { toSchema(g: string): string }
) {
  return async (_root: unknown, args: CollectionArgs, ctx: GraphQLContext) => {
    const page = args.page ?? 1
    const perPage = args.perPage ?? 10
    if (!Number.isInteger(page) || page < 1) {
      throw codeError('INVALID_PAGINATION', 'page must be ≥ 1')
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw codeError('INVALID_PAGINATION', 'perPage must be between 1 and 100')
    }
    const repo = ctx.repos[typeName]!
    const result = await repo.findMany({
      published_only: true,
      page,
      per_page: perPage,
      sort_by: (args.sortBy ?? 'created_at') as 'title' | 'created_at' | 'updated_at',
      sort_order: args.sortOrder ?? 'asc',
      filters: translateFilters(args.filter, nameMap),
    })
    return { data: result.data as Row[], meta: result.meta }
  }
}

export function singleBySlugResolver(typeName: string) {
  return async (_root: unknown, args: { slug: string }, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const item = (await repo.findBySlug(args.slug)) as Row | null
    return isPublished(item) ? item : null
  }
}

export function singletonResolver(typeName: string) {
  return async (_root: unknown, _args: unknown, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const result = await repo.findMany({ published_only: true, page: 1, per_page: 1 })
    return (result.data[0] as Row | undefined) ?? null
  }
}

export function taxonomySingleResolver(typeName: string) {
  return async (_root: unknown, args: { id: string }, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const item = (await repo.findOne(args.id)) as Row | null
    return isPublished(item) ? item : null
  }
}
```

- [ ] **Step 2: Typecheck the module compiles**

Run: `pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: no errors from `resolvers.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/graphql/resolvers.ts
git commit -m "feat(graphql): add root and field resolver factories"
```

---

## Task 7: Schema builder

**Files:**
- Create: `packages/api/src/graphql/schema.ts`
- Test: `packages/api/src/graphql/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: all prior graphql modules; `SchemaRegistry`, `ParsedContentType`, `ParsedTaxonomyType`, `ParsedParagraphType`, `ParsedEnumType` from core; `graphql` type constructors; `GraphQLContext`.
- Produces: `buildGraphQLSchema(registry: SchemaRegistry): GraphQLSchema`.

- [ ] **Step 1: Write the failing test** (build schema from a fixture registry; execute a query with fake repos)

```ts
// packages/api/src/graphql/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

// Minimal registry: one content type "post" with a text field and a date system field.
const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type',
      name: 'content--post',
      label: 'Post',
      only_one: false,
      fields: [
        {
          name: 'blog_title',
          label: 'Title',
          field_type: 'text/plain',
          required: true,
          db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
          ui_component: { component: 'text-input' },
        },
      ],
      system_fields: [],
    },
  },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function fakeCtx(rows: Record<string, unknown>[]): GraphQLContext {
  const repo = {
    findMany: async () => ({ ok: true, data: rows, meta: { total: rows.length, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false } }),
    findBySlug: async (slug: string) => rows.find((r) => r['slug'] === slug) ?? null,
  }
  return {
    repos: { 'content--post': repo as never },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('buildGraphQLSchema', () => {
  it('exposes camelCase types and queries', () => {
    const sdl = printSchema(buildGraphQLSchema(registry))
    expect(sdl).toContain('type Post')
    expect(sdl).toContain('posts(')
    expect(sdl).toContain('post(slug: String!): Post')
    expect(sdl).toContain('blogTitle')
    expect(sdl).toContain('createdAt: DateTime')
  })

  it('resolves a list query mapping snake_case rows to camelCase fields', async () => {
    const schema = buildGraphQLSchema(registry)
    const rows = [{ id: '1', slug: 'hi', published: true, blog_title: 'Hello', created_at: new Date('2026-07-19T00:00:00Z') }]
    const result = await graphql({
      schema,
      source: `{ posts { data { blogTitle createdAt } meta { total perPage } } }`,
      contextValue: fakeCtx(rows),
    })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({
      posts: { data: [{ blogTitle: 'Hello', createdAt: '2026-07-19T00:00:00.000Z' }], meta: { total: 1, perPage: 10 } },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- schema`
Expected: FAIL — cannot find module `../schema`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/api/src/graphql/schema.ts
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLEnumType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLID,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  type GraphQLFieldConfig,
  type GraphQLOutputType,
  type GraphQLFieldConfigMap,
} from 'graphql'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
  ParsedParagraphType,
  ParsedField,
  ParsedEnumType,
} from '@bobbykim/manguito-cms-core'
import type { GraphQLContext } from './context.js'
import { DateTimeScalar } from './scalars.js'
import { scalarOutputType } from './type-mapping.js'
import {
  graphqlTypeName,
  singleQueryName,
  collectionQueryName,
  toCamelCase,
  isValidGraphQLName,
  buildFieldNameMap,
} from './naming.js'
import { SortOrderEnum, buildSortFieldEnum, buildFilterInputType } from './filters.js'
import {
  scalarFieldResolver,
  relationFieldResolver,
  programmaticFieldResolver,
  collectionResolver,
  singleBySlugResolver,
  singletonResolver,
  taxonomySingleResolver,
} from './resolvers.js'

const PAGE_META = new GraphQLObjectType({
  name: 'PageMeta',
  fields: {
    total: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.total },
    page: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.page },
    perPage: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.per_page },
    totalPages: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.total_pages },
    hasNext: { type: new GraphQLNonNull(GraphQLBoolean), resolve: (m) => m.has_next },
    hasPrev: { type: new GraphQLNonNull(GraphQLBoolean), resolve: (m) => m.has_prev },
  },
})

const MEDIA = new GraphQLObjectType({
  name: 'Media',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID), resolve: (m) => m.id },
    type: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.type },
    url: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.url },
    mimeType: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.mime_type },
    alt: { type: GraphQLString, resolve: (m) => m.alt },
    fileSize: { type: GraphQLInt, resolve: (m) => m.file_size },
    width: { type: GraphQLInt, resolve: (m) => m.width },
    height: { type: GraphQLInt, resolve: (m) => m.height },
    duration: { type: GraphQLInt, resolve: (m) => m.duration },
  },
})

export function buildGraphQLSchema(registry: SchemaRegistry): GraphQLSchema {
  const objectTypes = new Map<string, GraphQLObjectType>() // machineName → type
  const enumTypes = new Map<string, GraphQLEnumType>() // enum machineName → type (only when valid)

  // Enum types (only when every value is a valid GraphQL identifier).
  for (const [name, enumType] of Object.entries(registry.enum_types) as [string, ParsedEnumType][]) {
    if (enumType.values.every(isValidGraphQLName)) {
      enumTypes.set(name, new GraphQLEnumType({
        name: graphqlTypeName(name),
        values: Object.fromEntries(enumType.values.map((v) => [v, { value: v }])),
      }))
    } else {
      process.stderr.write(
        `⚠ enum '${name}' has values that aren't valid GraphQL identifiers; exposing as String\n`
      )
    }
  }

  // Output type for one field (scalar, enum, relation, media, programmatic).
  function outputTypeForField(field: ParsedField): GraphQLOutputType {
    const scalar = scalarOutputType(field.field_type)
    if (scalar) return field.required ? new GraphQLNonNull(scalar) : scalar

    if (field.field_type === 'enum') {
      const ref = (field.ui_component as { enum_ref?: string }).enum_ref
      const et = ref ? enumTypes.get(ref) : undefined
      const t = et ?? GraphQLString
      return field.required ? new GraphQLNonNull(t) : t
    }

    if (field.field_type === 'image' || field.field_type === 'video' || field.field_type === 'file') {
      return MEDIA
    }

    if (field.field_type === 'paragraph') {
      const ref = (field.ui_component as { ref?: string }).ref
      const target = ref ? objectTypes.get(ref) : undefined
      return new GraphQLList(new GraphQLNonNull(target ?? MEDIA))
    }

    if (field.field_type === 'reference') {
      const rel = (field.ui_component as { ref?: string }).ref
      const target = rel ? objectTypes.get(rel) : undefined
      const isMany = (field.ui_component as { rel?: string }).rel === 'many-to-many' ||
        (field.ui_component as { rel?: string }).rel === 'one-to-many'
      const t = (target ?? MEDIA) as GraphQLObjectType
      return isMany ? new GraphQLList(new GraphQLNonNull(t)) : t
    }

    return GraphQLString
  }

  // Build the object type for a content/taxonomy/paragraph type. Fields are a
  // thunk so relations can reference types created later (circular graphs).
  function buildObjectType(
    machineName: string,
    type: ParsedContentType | ParsedTaxonomyType | ParsedParagraphType
  ): GraphQLObjectType {
    return new GraphQLObjectType({
      name: graphqlTypeName(machineName),
      fields: () => {
        const fields: GraphQLFieldConfigMap<Record<string, unknown>, GraphQLContext> = {}
        // System fields.
        fields['id'] = { type: new GraphQLNonNull(GraphQLID), resolve: (p) => p['id'] }
        if (type.schema_type !== 'paragraph-type') {
          fields['published'] = { type: new GraphQLNonNull(GraphQLBoolean), resolve: (p) => p['published'] }
        }
        if (type.schema_type === 'content-type') {
          fields['slug'] = { type: new GraphQLNonNull(GraphQLString), resolve: (p) => p['slug'] }
        }
        fields['createdAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['created_at'] }
        fields['updatedAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['updated_at'] }

        for (const field of type.fields) {
          const gqlName = toCamelCase(field.name)
          const outType = outputTypeForField(field)
          let resolve: GraphQLFieldConfig<Record<string, unknown>, GraphQLContext>['resolve']
          if (field.field_type === 'programmatic') {
            resolve = programmaticFieldResolver(machineName, field.name)
          } else if (
            field.field_type === 'reference' ||
            field.field_type === 'paragraph' ||
            field.field_type === 'image' ||
            field.field_type === 'video' ||
            field.field_type === 'file'
          ) {
            resolve = relationFieldResolver(machineName, field.name)
          } else {
            resolve = scalarFieldResolver(field.name)
          }
          fields[gqlName] = { type: outType, resolve }
        }
        return fields
      },
    })
  }

  // Pass 1: create every object type (empty-safe thunks resolve later).
  for (const [name, ct] of Object.entries(registry.content_types)) {
    objectTypes.set(name, buildObjectType(name, ct as ParsedContentType))
  }
  for (const [name, tt] of Object.entries(registry.taxonomy_types)) {
    objectTypes.set(name, buildObjectType(name, tt as ParsedTaxonomyType))
  }
  for (const [name, pt] of Object.entries(registry.paragraph_types)) {
    objectTypes.set(name, buildObjectType(name, pt as ParsedParagraphType))
  }

  // Pass 2: build the root Query type.
  const queryFields: GraphQLFieldConfigMap<unknown, GraphQLContext> = {}

  for (const [name, ct] of Object.entries(registry.content_types) as [string, ParsedContentType][]) {
    const objType = objectTypes.get(name)!
    const nameMap = buildFieldNameMap(ct.fields.map((f) => f.name))

    if (ct.only_one) {
      queryFields[singleQueryName(name)] = { type: objType, resolve: singletonResolver(name) }
      continue
    }

    const listType = new GraphQLObjectType({
      name: `${graphqlTypeName(name)}List`,
      fields: {
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(objType))), resolve: (r) => r.data },
        meta: { type: new GraphQLNonNull(PAGE_META), resolve: (r) => r.meta },
      },
    })
    const filterType = buildFilterInputType(ct)

    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: {
        page: { type: GraphQLInt },
        perPage: { type: GraphQLInt },
        sortBy: { type: buildSortFieldEnum(graphqlTypeName(name)) },
        sortOrder: { type: SortOrderEnum },
        ...(filterType ? { filter: { type: filterType } } : {}),
      },
      resolve: collectionResolver(name, nameMap),
    }
    queryFields[singleQueryName(name)] = {
      type: objType,
      args: { slug: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: singleBySlugResolver(name),
    }
  }

  for (const [name, tt] of Object.entries(registry.taxonomy_types) as [string, ParsedTaxonomyType][]) {
    const objType = objectTypes.get(name)!
    const listType = new GraphQLObjectType({
      name: `${graphqlTypeName(name)}List`,
      fields: {
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(objType))), resolve: (r) => r.data },
        meta: { type: new GraphQLNonNull(PAGE_META), resolve: (r) => r.meta },
      },
    })
    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: { page: { type: GraphQLInt }, perPage: { type: GraphQLInt } },
      resolve: collectionResolver(name, buildFieldNameMap(tt.fields.map((f) => f.name))),
    }
    queryFields[singleQueryName(name)] = {
      type: objType,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: taxonomySingleResolver(name),
    }
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- schema`
Expected: PASS (2 tests). If a Node type name collision occurs across suites, run only this file.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/schema.ts packages/api/src/graphql/__tests__/schema.test.ts
git commit -m "feat(graphql): build executable schema from the registry"
```

---

## Task 8: Security plugins

**Files:**
- Modify: `packages/api/package.json` (add `@escape.tech/graphql-armor`)
- Create: `packages/api/src/graphql/security.ts`
- Test: `packages/api/src/graphql/__tests__/security.test.ts`

**Interfaces:**
- Consumes: `@escape.tech/graphql-armor` (`EnvelopArmorPlugin`); `graphql` (`NoSchemaIntrospectionCustomRule`).
- Produces:
  - `buildArmorPlugin(options: { maxDepth: number; maxComplexity: number }): { plugins: unknown[] }` (Yoga/envelop plugins).
  - `introspectionPlugin(enabled: boolean): unknown` — a Yoga plugin that adds `NoSchemaIntrospectionCustomRule` when `enabled` is false.

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @bobbykim/manguito-cms-api add @escape.tech/graphql-armor@^3.1.0
```
Expected: dependency added.

- [ ] **Step 2: Write the failing test**

```ts
// packages/api/src/graphql/__tests__/security.test.ts
import { describe, it, expect } from 'vitest'
import { buildArmorPlugin, introspectionPlugin } from '../security'

describe('security plugins', () => {
  it('builds armor plugins from depth/complexity options', () => {
    const { plugins } = buildArmorPlugin({ maxDepth: 8, maxComplexity: 1000 })
    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBeGreaterThan(0)
  })

  it('introspectionPlugin returns a plugin object', () => {
    expect(introspectionPlugin(false)).toHaveProperty('onValidate')
    expect(introspectionPlugin(true)).toHaveProperty('onValidate')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- security`
Expected: FAIL — cannot find module `../security`.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/api/src/graphql/security.ts
import { EnvelopArmorPlugin } from '@escape.tech/graphql-armor'
import { NoSchemaIntrospectionCustomRule } from 'graphql'

// Depth + cost + alias limits via GraphQL Armor. Returns { plugins } to spread
// into Yoga's `plugins` array.
export function buildArmorPlugin(options: { maxDepth: number; maxComplexity: number }): {
  plugins: unknown[]
} {
  const armor = new EnvelopArmorPlugin({
    maxDepth: { n: options.maxDepth },
    costLimit: { maxCost: options.maxComplexity },
    maxAliases: { n: 15 },
    maxDirectives: { n: 50 },
    blockFieldSuggestion: { enabled: true },
  })
  return armor.protect()
}

// Disables introspection (and the __schema/__type meta-fields) in production by
// adding graphql's built-in validation rule when `enabled` is false.
export function introspectionPlugin(enabled: boolean): {
  onValidate(payload: { addValidationRule: (rule: unknown) => void }): void
} {
  return {
    onValidate({ addValidationRule }) {
      if (!enabled) addValidationRule(NoSchemaIntrospectionCustomRule)
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- security`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/package.json packages/api/src/graphql/security.ts packages/api/src/graphql/__tests__/security.test.ts ../../pnpm-lock.yaml
git commit -m "feat(graphql): add depth/complexity limits and introspection control"
```

---

## Task 9: Yoga handler, subpath export, and build entry

**Files:**
- Modify: `packages/api/package.json` (add `graphql-yoga`, add `./graphql` export)
- Modify: `packages/api/tsup.config.ts` (add `src/graphql/index.ts` entry)
- Create: `packages/api/src/graphql/handler.ts`
- Create: `packages/api/src/graphql/index.ts`
- Test: `packages/api/src/graphql/__tests__/handler.test.ts`

**Interfaces:**
- Consumes: `graphql-yoga` (`createYoga`); Hono `Handler`; `buildGraphQLSchema`, `createRelationLoaders`, `buildArmorPlugin`, `introspectionPlugin`; `SchemaRegistry`, `ContentRepository`, `DrizzlePostgresInstance`; `ProgrammaticResolver`; `GraphQLContext`.
- Produces:
  - `type ResolvedGraphQLOptions = { enabled: boolean; maxDepth: number; maxComplexity: number; graphiql: boolean; introspection: boolean }`.
  - `createGraphQLHandler(registry, repos, resolver, db, options): Handler`.
  - `index.ts` re-exports both.

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm --filter @bobbykim/manguito-cms-api add graphql-yoga@^5.10.0
```

- [ ] **Step 2: Write the failing test** (drive the handler with a real Hono request and fake repos)

```ts
// packages/api/src/graphql/__tests__/handler.test.ts
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { buildGraphQLSchema } from '../schema'
import { createYoga } from 'graphql-yoga'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type', name: 'content--post', label: 'Post', only_one: false,
      fields: [{ name: 'blog_title', label: 'T', field_type: 'text/plain', required: true,
        db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
        ui_component: { component: 'text-input' } }],
      system_fields: [],
    },
  },
  taxonomy_types: {}, paragraph_types: {}, enum_types: {},
} as unknown as SchemaRegistry

describe('graphql handler over Hono', () => {
  it('answers a POST query', async () => {
    const rows = [{ id: '1', slug: 'hi', published: true, blog_title: 'Hello', created_at: new Date(), updated_at: new Date() }]
    const repo = { findMany: async () => ({ ok: true, data: rows, meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false } }) }
    const yoga = createYoga({
      schema: buildGraphQLSchema(registry),
      graphqlEndpoint: '/graphql',
      context: () => ({ repos: { 'content--post': repo }, programmaticMemo: new WeakMap() }),
    })
    const app = new Hono()
    app.all('/graphql', (c) => yoga.fetch(c.req.raw, {}))

    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ posts { data { blogTitle } } }' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.posts.data[0].blogTitle).toBe('Hello')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- handler`
Expected: FAIL — `graphql-yoga` not installed / handler module missing (depending on step order; if yoga installed, it fails only if the query path is wrong).

- [ ] **Step 4: Write the handler**

```ts
// packages/api/src/graphql/handler.ts
import { createYoga } from 'graphql-yoga'
import type { Handler } from 'hono'
import type {
  SchemaRegistry,
  ContentRepository,
} from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { GraphQLContext } from './context.js'
import { buildGraphQLSchema } from './schema.js'
import { createRelationLoaders } from './dataloaders.js'
import { buildArmorPlugin, introspectionPlugin } from './security.js'

export type ResolvedGraphQLOptions = {
  enabled: boolean
  maxDepth: number
  maxComplexity: number
  graphiql: boolean
  introspection: boolean
}

export function createGraphQLHandler(
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<unknown>>,
  resolver: ProgrammaticResolver,
  db: DrizzlePostgresInstance,
  options: ResolvedGraphQLOptions
): Handler {
  const schema = buildGraphQLSchema(registry)
  const { plugins } = buildArmorPlugin({
    maxDepth: options.maxDepth,
    maxComplexity: options.maxComplexity,
  })

  const yoga = createYoga<Record<string, never>, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: options.graphiql,
    landingPage: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [...(plugins as any[]), introspectionPlugin(options.introspection)],
    context: (): GraphQLContext => ({
      db,
      registry,
      repos,
      resolver,
      loaders: createRelationLoaders(db, registry),
      programmaticMemo: new WeakMap(),
    }),
  })

  return (c) => yoga.fetch(c.req.raw, {})
}
```

- [ ] **Step 5: Write the subpath index**

```ts
// packages/api/src/graphql/index.ts
export { createGraphQLHandler } from './handler.js'
export type { ResolvedGraphQLOptions } from './handler.js'
```

- [ ] **Step 6: Add the tsup entry and package export**

In `packages/api/tsup.config.ts`, add `'src/graphql/index.ts'` to the `entry` array.

In `packages/api/package.json` `exports`, add:
```json
    "./graphql": {
      "types": "./dist/graphql/index.d.ts",
      "import": "./dist/graphql/index.mjs",
      "require": "./dist/graphql/index.js"
    },
```

- [ ] **Step 7: Run test + build to verify**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- handler`
Expected: PASS.
Run: `pnpm --filter @bobbykim/manguito-cms-api build`
Expected: build succeeds; `dist/graphql/index.mjs` + `.d.ts` produced.

- [ ] **Step 8: Commit**

```bash
git add packages/api/package.json packages/api/tsup.config.ts packages/api/src/graphql/handler.ts packages/api/src/graphql/index.ts packages/api/src/graphql/__tests__/handler.test.ts ../../pnpm-lock.yaml
git commit -m "feat(graphql): add Yoga handler and ./graphql subpath export"
```

---

## Task 10: Config types and `createAPIAdapter` option

**Files:**
- Modify: `packages/core/src/config/types.ts` (add config types + `APIAdapter.graphql?`)
- Modify: `packages/core/src/index.ts` (export the new types if the file re-exports config types)
- Modify: `packages/api/src/index.ts` (`createAPIAdapter` accepts + resolves `graphql`)
- Test: `packages/api/src/__tests__/create-api-adapter.test.ts` (extend existing)

**Interfaces:**
- Produces (core): `type GraphQLModuleConfig = { enabled?: boolean; maxDepth?: number; maxComplexity?: number; graphiql?: boolean; introspection?: boolean }`; `type ResolvedGraphQLConfig = { enabled: boolean; maxDepth: number; maxComplexity: number; graphiql: boolean; introspection: boolean }`; `APIAdapter.graphql?: ResolvedGraphQLConfig`.
- Produces (api): `createAPIAdapter({ graphql })` returns `APIAdapter` with a resolved `graphql` when provided.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/api/src/__tests__/create-api-adapter.test.ts
import { describe, it, expect } from 'vitest'
import { createAPIAdapter } from '../index'

describe('createAPIAdapter graphql option', () => {
  it('omits graphql when not configured', () => {
    expect(createAPIAdapter({}).graphql).toBeUndefined()
  })

  it('resolves defaults when graphql is enabled', () => {
    const a = createAPIAdapter({ graphql: { enabled: true } })
    expect(a.graphql).toMatchObject({ enabled: true, maxDepth: 8, maxComplexity: 1000 })
    expect(typeof a.graphql!.graphiql).toBe('boolean')
    expect(typeof a.graphql!.introspection).toBe('boolean')
  })

  it('honours explicit overrides', () => {
    const a = createAPIAdapter({ graphql: { enabled: true, maxDepth: 5, graphiql: false } })
    expect(a.graphql).toMatchObject({ maxDepth: 5, graphiql: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- create-api-adapter`
Expected: FAIL — `graphql` not on the returned adapter / not accepted.

- [ ] **Step 3: Add the core config types**

In `packages/core/src/config/types.ts`, add above `export interface APIAdapter`:
```ts
export type GraphQLModuleConfig = {
  enabled?: boolean
  maxDepth?: number
  maxComplexity?: number
  graphiql?: boolean
  introspection?: boolean
}

export type ResolvedGraphQLConfig = {
  enabled: boolean
  maxDepth: number
  maxComplexity: number
  graphiql: boolean
  introspection: boolean
}
```
and add the field to the interface:
```ts
export interface APIAdapter {
  readonly prefix: string
  readonly media?: ResolvedMediaConfig
  readonly rateLimit?: ResolvedRateLimitConfig
  readonly graphql?: ResolvedGraphQLConfig
}
```
If `packages/core/src/index.ts` re-exports config types explicitly, add `GraphQLModuleConfig` and `ResolvedGraphQLConfig` to that export list.

- [ ] **Step 4: Update `createAPIAdapter`**

Replace the relevant section of `packages/api/src/index.ts` with:
```ts
import type {
  APIAdapter,
  ResolvedMediaConfig,
  GraphQLModuleConfig,
  ResolvedGraphQLConfig,
} from '@bobbykim/manguito-cms-core'

export type APIAdapterOptions = {
  prefix?: string
  media?: { max_file_size?: number }
  graphql?: GraphQLModuleConfig
}

function resolveGraphQL(cfg: GraphQLModuleConfig): ResolvedGraphQLConfig {
  const devDefault = process.env['NODE_ENV'] !== 'production'
  return {
    enabled: cfg.enabled ?? false,
    maxDepth: cfg.maxDepth ?? 8,
    maxComplexity: cfg.maxComplexity ?? 1000,
    graphiql: cfg.graphiql ?? devDefault,
    introspection: cfg.introspection ?? cfg.graphiql ?? devDefault,
  }
}

export function createAPIAdapter(options: APIAdapterOptions = {}): APIAdapter {
  const prefix = options.prefix ?? '/api'
  const media: ResolvedMediaConfig = {
    max_file_size: options.media?.max_file_size ?? 4 * 1024 * 1024,
  }
  return {
    prefix,
    media,
    ...(options.graphql ? { graphql: resolveGraphQL(options.graphql) } : {}),
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- create-api-adapter`
Expected: PASS.
Run: `pnpm --filter @bobbykim/manguito-cms-core build && pnpm --filter @bobbykim/manguito-cms-api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/index.ts packages/api/src/index.ts packages/api/src/__tests__/create-api-adapter.test.ts
git commit -m "feat(graphql): add graphql config option to createAPIAdapter"
```

---

## Task 11: Mount in `createCmsApp`

**Files:**
- Modify: `packages/api/src/app.ts` (`CreateCmsAppOptions.graphql` + dynamic-import mount)
- Test: `packages/api/src/__tests__/graphql.integration.test.ts`

**Interfaces:**
- Consumes: `ResolvedGraphQLConfig` from core; `createGraphQLHandler` via dynamic `import('./graphql/handler.js')`.
- Produces: `createCmsApp` mounts `app.all('/graphql', …)` when `options.graphql?.enabled`.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/api/src/__tests__/graphql.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test')

const TABLE = 'api_int_gql_post'

const POST: ParsedContentType = {
  schema_type: 'content-type', name: 'content--gqlpost', label: 'Gql Post',
  source_file: 't.yml', only_one: false, default_base_path: 'gqlpost',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    { name: 'blog_title', label: 'Title', field_type: 'text/plain', required: true, nullable: false,
      order: 0, validation: { required: true },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' } },
  ],
  ui: { tabs: [] } as never,
  db: { table_name: TABLE, junction_tables: [] },
  api: { default_base_path: 'gqlpost', http_methods: ['GET'], item_path: '/gqlpost/:slug' },
}

const registry = {
  routes: {} as never, roles: { roles: {} } as never, schemas: {},
  content_types: { 'content--gqlpost': POST }, paragraph_types: {}, taxonomy_types: {}, enum_types: {},
  all_schemas: [],
} as unknown as SchemaRegistry

let db: DrizzlePostgresInstance
let app: { fetch: (r: Request) => Response | Promise<Response> }

beforeAll(async () => {
  db = createPostgresAdapter().getDb()
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  await db.execute(sql.raw(`CREATE TABLE "${TABLE}" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug varchar NOT NULL, published boolean NOT NULL DEFAULT false, blog_title varchar NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`))
  await db.execute(sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title) VALUES ('published-one', true, 'Published'), ('draft-one', false, 'Draft')`))

  const built = createCmsApp({
    registry, db, storage: createLocalAdapter(),
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  })
  app = built.app
})

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
})

async function gql(query: string) {
  const res = await app.fetch(new Request('http://local/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  }))
  return res.json()
}

describe('graphql integration', () => {
  it('returns only published items in a list query', async () => {
    const body = await gql('{ gqlposts { data { blogTitle } meta { total } } }')
    expect(body.errors).toBeUndefined()
    const titles = body.data.gqlposts.data.map((d: { blogTitle: string }) => d.blogTitle)
    expect(titles).toEqual(['Published'])
    expect(body.data.gqlposts.meta.total).toBe(1)
  })

  it('never returns a draft by slug', async () => {
    const body = await gql('{ gqlpost(slug: "draft-one") { blogTitle } }')
    expect(body.data.gqlpost).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration`
Expected: FAIL — `/graphql` route not found (404 / null data), because `createCmsApp` does not mount it yet.

- [ ] **Step 3: Add the option and mount to `app.ts`**

In `CreateCmsAppOptions` add:
```ts
  /** GraphQL module config (resolved). When enabled, mounts POST /graphql. */
  graphql?: import('@bobbykim/manguito-cms-core').ResolvedGraphQLConfig
```
After the public routes are registered (`registerPublicContentRoutes(...)`), add:
```ts
  // ── GraphQL (opt-in) ────────────────────────────────────────────────────────
  // Dynamically imported so graphql/graphql-yoga never load unless enabled,
  // preserving the subpath isolation of ADR api/0006.
  if (options.graphql?.enabled) {
    const gqlOptions = options.graphql
    let handler: import('hono').Handler | null = null
    const ready = import('./graphql/handler.js').then(({ createGraphQLHandler }) => {
      handler = createGraphQLHandler(registry, publicRepos, programmaticResolver, db, gqlOptions)
    })
    const route = listRateLimit
      ? [listRateLimit, async (c: import('hono').Context) => {
          if (!handler) await ready
          return handler!(c, async () => {})
        }] as const
      : [async (c: import('hono').Context) => {
          if (!handler) await ready
          return handler!(c, async () => {})
        }] as const
    app.all('/graphql', ...(route as unknown as [import('hono').Handler]))
  }
```

> `publicRepos` and `programmaticResolver` already exist in `createCmsApp` (see `app.ts`). `db` is `options.db`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/app.ts packages/api/src/__tests__/graphql.integration.test.ts
git commit -m "feat(graphql): mount /graphql in createCmsApp when enabled"
```

---

## Task 12: CLI dev-server and build codegen glue

**Files:**
- Modify: `packages/cli/src/commands/dev.ts` (two `createCmsApp` calls)
- Modify: `packages/cli/src/codegen/server-entries.ts` (generated `createCmsApp` call)
- Test: `packages/cli/src/codegen/__tests__/server-entries.test.ts` (extend or create)

**Interfaces:**
- Consumes: `config.api.graphql` (typed `ResolvedGraphQLConfig` via the core `APIAdapter`).
- Produces: both runtime paths pass `graphql` into `createCmsApp`.

- [ ] **Step 1: Write the failing test** (generated server entry includes the graphql pass-through)

```ts
// packages/cli/src/codegen/__tests__/server-entries.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The generated template string should thread config.api.graphql into createCmsApp.
it('server-entries template threads graphql config', () => {
  const src = readFileSync(join(__dirname, '../server-entries.ts'), 'utf8')
  expect(src).toContain('config.api.graphql')
  expect(src).toContain('graphql: config.api.graphql')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test -- server-entries`
Expected: FAIL — string not present.

- [ ] **Step 3: Add the glue**

In `packages/cli/src/commands/dev.ts`, in **both** `createCmsApp({ … })` calls (around lines 161 and 348), add after the `rateLimit` spread:
```ts
    ...(config.api.graphql ? { graphql: config.api.graphql } : {}),
```
In `packages/cli/src/codegen/server-entries.ts`, in the generated `createCmsApp({ … })` template (around line 32), add the same line to the template string:
```ts
  ...(config.api.graphql ? { graphql: config.api.graphql } : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test -- server-entries`
Expected: PASS.
Run: `pnpm --filter @bobbykim/manguito-cms-cli exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/dev.ts packages/cli/src/codegen/server-entries.ts packages/cli/src/codegen/__tests__/server-entries.test.ts
git commit -m "feat(graphql): thread graphql config through cli dev and build"
```

---

## Task 13: End-to-end integration — relations, programmatic, limits

**Files:**
- Modify: `packages/api/src/__tests__/graphql.integration.test.ts` (extend Task 11's suite)

**Interfaces:**
- Consumes: everything wired above.

- [ ] **Step 1: Add a reference relation to the fixture and a nested-relation test**

Extend the `beforeAll` in `graphql.integration.test.ts` to create an author table and an `author_id` FK column on the post table, add an `author` reference field to the `POST` fixture (`ui_component: { component: 'typeahead-select', ref: 'content--gqlauthor', rel: 'one-to-one' }`, `db_column` with `foreign_key`), register a `content--gqlauthor` content type, seed one author, and point the published post at it. Then:

```ts
  it('resolves a nested relation in one query, batched (no N+1)', async () => {
    let queryCount = 0
    const original = db.execute.bind(db)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).execute = (...args: unknown[]) => { queryCount++; return (original as any)(...args) }
    const body = await gql('{ gqlposts { data { blogTitle author { name } } } }')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).execute = original
    expect(body.errors).toBeUndefined()
    expect(body.data.gqlposts.data[0].author.name).toBe('Ada')
    // list query + one batched author lookup — a handful of queries, not one-per-row.
    expect(queryCount).toBeLessThan(5)
  })
```

- [ ] **Step 2: Add a depth-limit rejection test**

```ts
  it('rejects a query deeper than maxDepth', async () => {
    // maxDepth is 8; nest author→... beyond it via repeated selection is not
    // possible with a single relation, so assert a deliberately deep alias set is
    // limited. Use a small maxDepth app instead:
    const deep = createCmsApp({
      registry, db, storage: createLocalAdapter(),
      graphql: { enabled: true, maxDepth: 1, maxComplexity: 1000, graphiql: false, introspection: true },
    }).app
    const res = await deep.fetch(new Request('http://local/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ gqlposts { data { author { name } } } }' }),
    }))
    const body = await res.json()
    expect(body.errors?.length).toBeGreaterThan(0)
  })
```

- [ ] **Step 3: Add an introspection-off test**

```ts
  it('disables introspection when configured off', async () => {
    const prod = createCmsApp({
      registry, db, storage: createLocalAdapter(),
      graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: false },
    }).app
    const res = await prod.fetch(new Request('http://local/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __schema { types { name } } }' }),
    }))
    const body = await res.json()
    expect(body.errors?.length).toBeGreaterThan(0)
  })
```

- [ ] **Step 3b: Add a programmatic-field test**

Add a programmatic field to the `POST` fixture's `fields` array:
```ts
    { name: 'reading_time', label: 'Reading time', field_type: 'programmatic', required: false,
      nullable: true, order: 1, validation: { required: false }, db_column: null,
      ui_component: { component: 'computed-display' } },
```
Pass a resolver map when constructing the app in `beforeAll` (add to every `createCmsApp` call in this suite):
```ts
    resolvers: new Map([
      ['content--gqlpost::reading_time', {
        schema: 'content--gqlpost', field: 'reading_time', on_list: true,
        resolve: () => 5, __manguito_programmatic: true,
      }],
    ]),
```
Then assert it resolves (as JSON) only for the selected field:
```ts
  it('resolves a programmatic field lazily as JSON', async () => {
    const body = await gql('{ gqlposts { data { readingTime } } }')
    expect(body.errors).toBeUndefined()
    expect(body.data.gqlposts.data[0].readingTime).toBe(5)
  })
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration`
Expected: PASS (all cases: published-only list, draft-by-slug null, nested relation batched, programmatic field, depth rejection, introspection off).

- [ ] **Step 5: Run the whole api + core + cli test suites**

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/__tests__/graphql.integration.test.ts
git commit -m "test(graphql): cover nested relations, depth limit, and introspection"
```

---

## Task 14: Docs and sandbox example

**Files:**
- Modify: `apps/sandbox/manguito.config.ts` (commented `graphql` example)
- Modify: `README.md` (move GraphQL from "Planned for v2+" to included, with a note)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a commented example to the sandbox config**

In `apps/sandbox/manguito.config.ts`, inside `createAPIAdapter({ … })`, add:
```ts
    // GraphQL public API (opt-in, query-only). Uncomment to enable POST /graphql.
    //   graphql: { enabled: true },  // maxDepth: 8, maxComplexity: 1000, graphiql: dev-only
```

- [ ] **Step 2: Update the README feature list**

In `README.md`, move `- GraphQL API option` out of "Planned for v2+" into the included features (e.g. under the REST line): `- Opt-in GraphQL public API (query-only) — see docs/v2/graphql-module.md`.

- [ ] **Step 3: Commit**

```bash
git add apps/sandbox/manguito.config.ts README.md
git commit -m "docs(graphql): document the graphql option in sandbox and README"
```

---

## Notes for the implementer

- **Third-party API drift:** `graphql-yoga`, `@escape.tech/graphql-armor`, and `dataloader` APIs are pinned to the versions in the `add` commands. If a named export differs (e.g. Armor's plugin config keys), consult that package's README and adjust the call — the surrounding structure (a `plugins` array for Yoga, `DataLoader` batch fn returning values in key order) is stable.
- **`createCmsApp` internals:** `publicRepos` and `programmaticResolver` are already constructed in `app.ts` (see the "Public-only repos" and resolver sections). Reuse them; do **not** build new repos for GraphQL — that is what preserves the published-only guarantee.
- **Type-name collisions in tests:** each test builds its own schema; the singleton scalar/`Media`/`PageMeta` types are module-level and safe to reuse across schemas. Do not construct two `GraphQLSchema`s that both register a differently-defined type of the same name in one process without isolating them per test.

# Programmatic Fields — Design

**Date:** 2026-07-12
**Status:** Approved design (pre-implementation)
**Scope:** Add a `programmatic` field type whose value is computed at read time by a
user-authored TypeScript resolver, instead of being stored in the database.

---

## 1. Motivation

Some fields on a content or taxonomy record are not authored data — they are
*derived*: a constant, a value composed from sibling fields, or a value fetched
from an external API. Today the only way to expose such a value is to store it in
a column and keep it in sync manually.

A **programmatic field** lets an author declare a field in the schema (so it is
part of the registry, the public API contract, and the admin) while supplying its
value at read time from a plain TypeScript function.

### Worked examples

1. **Constant** — always returns the same value, without a DB column.
2. **Derived from siblings** — e.g. `` `${blog_title} — ${blog_desc}` ``.
3. **External API** — fetch an upstream service keyed by a sibling field and
   return the response (e.g. a transaction lookup).

Example 3 is the source of the main performance concern and drives several of the
decisions below.

---

## 2. Feasibility

Feasibility is **high**, because the concept reuses machinery the codebase already
has:

- **Loading user TypeScript is already solved.** `manguito.config.ts` is
  user-authored TS that `resolveConfig()` loads in dev and the build compiles
  (`import config from '../../manguito.config.js'`). Resolver files are the same
  kind of artifact.
- **There is exactly one app-injection point.** `createCmsApp({ ... })` is called
  in both `packages/cli/src/commands/dev.ts` and the generated
  `packages/cli/src/codegen/server-entries.ts` (node/lambda/vercel). Adding a
  single `resolvers` option there covers every runtime.
- **`.manguito/` codegen is an established idiom.** The CLI already generates a
  schema registry, routes, forms, and nav. A generated resolver registry is the
  same move.
- **A no-column field already exists.** `paragraph` fields parse to
  `db_column: null`; `programmatic` fields follow that precedent.

No part of this design crosses a layer boundary: `core` owns the field type and
the public primitive, `api` executes resolvers, `cli` discovers and wires them,
`admin` renders a read-only placeholder.

---

## 3. Decisions

These were settled during design and are the authoritative contract.

### 3.1 Execution & caching model — dynamic-on-read, opt-in TTL cache

The resolver runs **on read**. A field may opt into caching with
`cache: { ttl: <seconds> }`; fields that do not declare a cache resolve fresh on
every read.

Rationale: the three use cases have different cost profiles. A constant and a
sibling-derived value do **no I/O** — resolving them fresh is effectively free and
always correct. An external-API value is the only one where freshness-vs-cost is a
real trade-off. A *blanket* cache would make the cheap, pure fields **stale** (edit
`blog_title`, and a derived field keeps the old value until the TTL expires) to buy
a benefit only the expensive field needs. Making the cache **opt-in per field**
puts caching exactly where it matters. Mechanically it is still "cached with TTL" —
the default is simply `ttl: 0` (no cache).

**Rejected — materialize-on-write:** would require a real DB column + migrations,
contradicts the "not data coming from the DB" mental model, and still cannot
reflect external changes between saves.

**Cache key:** `` `${schema}::${field}::${itemId}` ``. Because `ctx` exposes only
same-row data (§3.4), a field's output depends solely on the item, so this key is
sound.

### 3.2 List-endpoint behavior — detail-only by default, opt-in for lists

List endpoints return up to 100 items per page. Resolving an I/O-bound field once
per item is up to 100 outbound calls for one client request — the amplification
risk.

- On **single-item reads** (`findBySlug` / `findOne`), all programmatic fields
  resolve.
- On **list reads** (`findMany`), a programmatic field resolves **only** if it
  declares `on_list: true`. Otherwise it is omitted from the list items.
- When a field *does* opt into lists, list resolution runs with a **concurrency
  cap** (10) across items and the per-field **timeout** (§3.3), so an opt-in can
  never fan out unbounded or stall a page.

The safe default (`on_list: false`) means the expensive case cannot happen by
accident; authors opt in knowingly, typically only for cheap/pure fields.

### 3.3 Failure contract — degrade to `fallback ?? null`, response stays `200`

When a resolver throws, times out, or an external call errors, the field takes its
`fallback` value if declared, otherwise `null`. The rest of the item (all
DB-backed fields and other programmatic fields) returns normally with HTTP `200`.
Failures are isolated per field so one flaky upstream cannot take down the payload.

- `fallback` is an optional **static** value on the field definition; default
  `null`.
- Each field has a `timeout` (default 5000 ms); exceeding it is treated as a
  failure and yields the fallback.
- Failures are logged server-side (warning) but never surfaced as an error
  envelope.

### 3.4 Resolver context — same-row data only

`ctx` exposes only data already loaded on the record:

- `ctx.get(fieldName)` → the stored sibling value, **synchronous** (the row is
  already loaded before any resolver runs; there is no I/O behind this read).
  Relations/media are the stored values (IDs), not hydrated objects.
- `ctx.record` → the whole row (readonly).

Keeping `ctx` pure means a field's output depends only on the item, which keeps the
cache key in §3.1 valid.

**Rejected for v1:** request context (authenticated user, query params) — would
make output request-dependent and break per-item caching; relation resolution
(`ctx.resolve`) — adds DB fan-out inside resolvers.

### 3.5 `required` is ignored

`required` on a stored field is enforced at **write** time. A programmatic field
has no write, so `required` has no meaning and is ignored (accepted in JSON for
uniformity, but never enforced).

### 3.6 Scope — content + taxonomy types

Both have their own read endpoints and a record to resolve against. **Paragraph
types** (embedded in a parent, needing nested resolution) are deferred.

### 3.7 Admin display — read-only placeholder

A programmatic field renders in the edit form as a **read-only row**: its label
plus a note ("computed at read time"). It has no input and is excluded from the
submit payload. Editors see the field exists and understand it is derived.

### 3.8 Authoring model — explicit registration + CLI-generated registry

A resolver file lives in `src/programmatic/` and default-exports a call to the
`programmaticField()` factory carrying its own binding and options. The CLI scans
the folder, generates `.manguito/programmatic-registry.ts`, and validates the
bindings at boot.

**Rejected:** config-registered resolvers (clutters `manguito.config.ts`, loses
drop-a-file ergonomics); convention-only path-binding (magic path coupling,
diverges from the authored signature).

---

## 4. Public API — `programmaticField()`

Exported from `@bobbykim/manguito-cms-core`.

```ts
// src/programmatic/blog-summary.ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  {
    schema: 'content--blog_post',   // schema machine name (content or taxonomy)
    field: 'blog_summary',          // must be a `type: "programmatic"` field on it
    cache: { ttl: 300 },            // optional; omit → fresh on every read
    on_list: false,                 // optional; default false
    fallback: null,                 // optional; default null (used on failure)
    timeout: 5000,                  // optional; default 5000 ms
  },
  async (ctx) => {
    const title = ctx.get('blog_title')   // synchronous — no await
    const desc = ctx.get('blog_desc')
    return `${title} — ${desc}`
  },
)
```

The JSON schema declares only that the field exists, so the parser, registry, and
admin know about it:

```jsonc
// schemas/content-types/content--blog_post.json
{ "name": "blog_summary", "label": "Summary", "type": "programmatic" }
```

### Types (shape)

```ts
type ResolverContext = {
  get(fieldName: string): unknown          // stored sibling value, sync
  readonly record: Readonly<Record<string, unknown>>
}

// JsonValue = any JSON-serializable value (string | number | boolean | null |
// JsonValue[] | { [k: string]: JsonValue }).
type Resolver = (ctx: ResolverContext) => JsonValue | null | Promise<JsonValue | null>
// undefined return is coerced to null

type ProgrammaticFieldOptions = {
  schema: string
  field: string
  cache?: { ttl: number }   // seconds; absent → no cache
  on_list?: boolean         // default false
  fallback?: JsonValue | null   // default null
  timeout?: number          // ms; default 5000
}

type ProgrammaticFieldDefinition = ProgrammaticFieldOptions & { resolve: Resolver }
```

The factory returns a plain `ProgrammaticFieldDefinition` object. It adds no npm
dependency to `core` and imports nothing downstream, respecting the core boundary.

---

## 5. Per-layer changes

### 5.1 `core`

- Add `'programmatic'` to the `FieldType` union (`registry/types.ts`).
- Add `RawProgrammaticField` to the parser validators (`name`, `label`,
  `type: 'programmatic'`; `required` accepted, ignored).
- Add a `programmatic` builder to `fieldTypeRegistry` emitting:
  `{ validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } }`.
- Add the `computed-display` variant to the `UiComponent` union.
- Add `programmaticField()` + the types in §4 (public API surface via root
  `index.ts`).

### 5.2 `cli`

- **Discovery:** scan `src/programmatic/**/*.ts` (directory configurable, default
  `./src/programmatic`).
- **Codegen:** generate `.manguito/programmatic-registry.ts` importing each default
  export into a `Map<'schema::field', ProgrammaticFieldDefinition>`.
- **Boot validation:** every `type: "programmatic"` field in the registry has
  exactly one resolver, and every resolver targets an existing programmatic field.
  Missing or duplicate bindings fail fast with a guided error (same style as
  existing schema errors).
- **Dev:** watch the folder and hot-swap the app alongside the existing schema
  hot-swap in `dev.ts`.
- **Wiring:** pass the map into `createCmsApp({ resolvers })` in `dev.ts` and in the
  generated server entries (`appSetup()` in `server-entries.ts`).

### 5.3 `api`

- `createCmsApp` gains `resolvers?: Map<string, ProgrammaticFieldDefinition>`.
- New module `api/src/programmatic/resolve.ts`:
  - Builds `ctx` from a row (`ctx.get`, `ctx.record`).
  - Runs a resolver inside `try/catch` and a `timeout` race; on failure returns
    `fallback ?? null`; coerces `undefined` → `null`.
  - Cache: in-memory `Map` keyed `schema::field::itemId` with per-entry expiry from
    `cache.ttl`; lazy eviction on read. Per-process (per warm instance on Lambda —
    documented, acceptable for v1).
  - `resolveItem(row, fields)` for detail reads (all fields); `resolveList(rows,
    fields)` for list reads (only `on_list: true`, concurrency cap 10).
  - Merges resolved values into the item's `data` under the field name.
- Wire into `registerPublicContentRoutes` (`routes/content.ts`): after
  `findBySlug`/`findOne` → `resolveItem`; after `findMany` → `resolveList`.

### 5.4 `admin`

- Render `computed-display` as a read-only row (label + "computed at read time"),
  excluded from the submit payload (form codegen / renderer).

---

## 6. Data flow

```
GET /api/blog/my-post
  → repo.findBySlug(...)            row (DB-backed fields resolved as today)
  → resolveItem(row, progFields)   for each field:
        cache hit? → cached value
        miss       → run resolver(ctx) within timeout
                     failure/timeout → fallback ?? null
                     store (if ttl) 
  → merge resolved values into data
  → { ok: true, data }

GET /api/blog                       (list, up to 100 items)
  → repo.findMany(...)             rows
  → resolveList(rows, progFields)  only on_list:true fields
                                   concurrency cap 10, per-field timeout
  → merge per item
  → { ok: true, data: [...] }
```

---

## 7. Testing

- **core:** parser accepts a `programmatic` field; builder emits `db_column: null`
  and `computed-display`; `programmaticField()` returns the expected shape.
- **cli:** registry codegen output; boot-validation errors for missing and
  duplicate bindings.
- **api:** `resolve.ts` units — `ctx.get`, throw → fallback, timeout → fallback,
  cache hit/miss/expiry, list concurrency and `on_list` gating; route integration
  (field resolved on detail, gated on list).
- **admin:** renders the read-only placeholder and omits the field from submit.

---

## 8. Out of scope (v1)

- Programmatic fields on paragraph types (nested resolution).
- Request-context / personalized resolvers (auth user, query params).
- Relation resolution inside `ctx` (`ctx.resolve`).
- Materialize-on-write / stored computed columns.
- Distributed / shared cache across processes or Lambda instances.

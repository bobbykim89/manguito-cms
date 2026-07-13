# Programmatic fields

A **programmatic field** is a field whose value is *computed at read time* by a
TypeScript function you write, rather than stored in the database. It has no
column: it never appears in a form, is never submitted, and is never migrated.
When a content or taxonomy item is read through the public API, Manguito runs
your function and merges the result into the response.

Use them for values that are *derived* rather than *authored*:

- a constant that shouldn't live in the database,
- a value composed from other fields on the same record,
- a value fetched from an external API.

Programmatic fields are supported on **content types and taxonomy types**.

## The two-part authoring model

A programmatic field is declared in two places:

1. **The schema** declares that the field *exists* (so the API, registry, and
   admin know about it).
2. **A resolver file** supplies the *value* in TypeScript.

Both are required. At startup Manguito checks that every programmatic field has
exactly one resolver and that every resolver targets a real programmatic field —
a mismatch fails the server fast with a clear error, so a missing or mistyped
binding never ships silently.

### 1. Declare the field in the schema

Add a field with `"type": "programmatic"`. It only needs `name` and `label`:

```json
{ "name": "blog_summary", "label": "Summary", "type": "programmatic" }
```

Because a programmatic field has no input, `required` has no meaning and is
ignored if present. In a content type the field lives inside a `tab` like any
other; in a taxonomy type it sits in the flat `fields[]` array.

### 2. Write the resolver

Resolver files live in `src/programmatic/` by default (configurable — see
[Where resolvers live](#where-resolvers-live)). Each file **default-exports** a
single `programmaticField(...)` call that binds itself to a schema field and
supplies the function:

```ts
// src/programmatic/blog-summary.ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--blog_post', field: 'blog_summary' },
  (ctx) => `${ctx.get('blog_title')} — ${ctx.get('blog_desc')}`,
)
```

`schema` is the machine name of the owning content/taxonomy type, and `field`
is the name of the `programmatic` field declared in that schema.

## The resolver function

The resolver receives a `ctx` and returns the field's value:

```ts
(ctx) => JsonValue | null | Promise<JsonValue | null>
```

- The return value may be any JSON-serialisable value (string, number, boolean,
  object, array) or `null`. A resolver that returns `undefined` is treated as
  `null`.
- The function may be `async` — return a `Promise` when you need to `await`
  (e.g. an external `fetch`).

`ctx` exposes the **current record only**:

| Member | Description |
| --- | --- |
| `ctx.get(fieldName)` | The stored value of a sibling field on the same record. Synchronous — the record is already loaded, so there is no database round-trip behind it. Relations and media come back as their stored ids. |
| `ctx.record` | The whole record as a read-only object. |

`ctx` is deliberately limited to same-record data in v1: it does not expose the
request, the authenticated user, or resolved relations. Keeping the resolver a
pure function of the record is what makes [caching](#caching) sound.

## Options

Pass options in the first argument alongside `schema` and `field`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `cache` | `{ ttl: number }` | *(none)* | Memoise the result per item for `ttl` **seconds**. Omit for a fresh computation on every read. See [Caching](#caching). |
| `on_list` | `boolean` | `false` | Whether the field resolves on collection (list) endpoints. See [Read behaviour](#read-behaviour). |
| `fallback` | `JsonValue \| null` | `null` | Value used when the resolver throws or times out. See [Failure handling](#failure-handling). |
| `timeout` | `number` | `5000` | Per-resolver timeout in **milliseconds**. Exceeding it is treated as a failure. |

```ts
export default programmaticField(
  {
    schema: 'content--blog_post',
    field: 'blog_summary',
    cache: { ttl: 300 },
    on_list: true,
    fallback: null,
    timeout: 5000,
  },
  async (ctx) => { /* ... */ },
)
```

## Read behaviour

Programmatic fields resolve when an item is read through the **public API**, and
the result is merged into the item under the field's name.

- **Single-item reads** (e.g. `GET /api/posts/:slug`, singletons, taxonomy
  `GET /api/taxonomy/<type>/:id`) resolve **all** of the item's programmatic
  fields.
- **List reads** (e.g. `GET /api/posts`) resolve **only** fields with
  `on_list: true`. Others are omitted from the list items.

This split exists for performance. A list can return up to 100 items per page,
so a field that does I/O (an external API call) resolving once per item means up
to 100 outbound calls for a single request. Keeping `on_list` off by default
means that amplification can't happen by accident; opt in only for fields that
are cheap or well-cached. When a field *does* opt into lists, resolution runs
with a bounded concurrency cap so a page can't fan out without limit.

Programmatic fields are not part of the database, so they **cannot be used as
filters** (`filter[...]`) or sort fields.

## Caching

By default a resolver runs on every read. Add `cache: { ttl }` to memoise its
result **per item** for `ttl` seconds:

```ts
{ schema: 'content--order', field: 'live_status', cache: { ttl: 60 } }
```

Caching is opt-in per field because the three use cases differ:

- A **constant** or a value **derived from sibling fields** does no I/O —
  recomputing it every read is effectively free, and caching would only risk
  serving a stale value after an edit. Leave these uncached.
- A value fetched from an **external API** is the case that benefits: `ttl`
  bounds how often the upstream is called.

The cache is an in-process cache keyed by item. Note that on serverless
platforms (e.g. Lambda) each warm instance has its own cache, so a cached value
is shared only within an instance's lifetime. Failed/timed-out results are
**never** cached — a transient upstream error is retried on the next read rather
than pinned as the fallback for the whole `ttl` window.

## Failure handling

Resolvers are isolated. If a resolver throws, rejects, or exceeds its `timeout`,
the field takes its `fallback` (default `null`) and the rest of the item is
returned normally with `200 OK` — one flaky resolver never fails the whole
response. Failures are logged server-side.

```ts
export default programmaticField(
  { schema: 'content--product', field: 'price', fallback: null, timeout: 3000 },
  async (ctx) => {
    const res = await fetch(`https://pricing.example.com?id=${ctx.get('sku')}`)
    const data = await res.json()
    return data.price            // number, or `fallback` if the call fails/times out
  },
)
```

## In the admin panel

A programmatic field is shown in the edit form as a **read-only row** — its label
plus a "Computed at read time" note. It has no input and never contributes to the
save payload, so editors can see the field exists and understand that its value
comes from the resolver, not from them.

## Where resolvers live

Resolver files are discovered under `src/programmatic/` by default. Any `.ts`
file in that directory (recursively) that default-exports a `programmaticField`
is loaded. If the directory doesn't exist, no resolvers are loaded.

To use a different directory, set `programmatic.dir` in `manguito.config.ts`:

```ts
export default defineConfig({
  // ...
  programmatic: { dir: './src/resolvers' },
})
```

In `manguito dev`, edits to a resolver file are picked up automatically. In
`manguito build`, the resolver files are compiled into the server bundle.

## Worked examples

### Constant

```json
{ "name": "api_version", "label": "API Version", "type": "programmatic" }
```

```ts
// src/programmatic/api-version.ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--settings', field: 'api_version', on_list: true },
  () => 'v1',
)
```

### Derived from sibling fields

```json
{ "name": "blog_summary", "label": "Summary", "type": "programmatic" }
```

```ts
// src/programmatic/blog-summary.ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--blog_post', field: 'blog_summary', on_list: true },
  (ctx) => `${ctx.get('blog_title')} — ${String(ctx.get('blog_desc') ?? '').slice(0, 60)}`,
)
```

Response:

```json
{
  "ok": true,
  "data": {
    "blog_title": "Hello world",
    "blog_desc": "A first post",
    "blog_summary": "Hello world — A first post"
  }
}
```

### Fetched from an external API

```json
{ "name": "transaction", "label": "Transaction", "type": "programmatic" }
```

```ts
// src/programmatic/transaction.ts
import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--order', field: 'transaction', cache: { ttl: 300 }, fallback: null },
  async (ctx) => {
    const res = await fetch(`https://api.example.com/tx?id=${ctx.get('transaction_id')}`)
    return res.json()
  },
)
```

Here `cache.ttl` keeps the upstream from being hit on every read, and `fallback`
keeps a failed lookup from breaking the response. `on_list` is left off, so the
external call only happens on single-item reads.

## Limitations (v1)

- Supported on content and taxonomy types only — not on paragraph types.
- `ctx` exposes same-record data only — no request context (user, query params)
  and no resolved relations.
- The cache is per-process and not shared across instances or evicted on a size
  bound.

## See also

- [`README.md`](../README.md) — project overview and quick start.
- [`schema-authoring.md`](./schema-authoring.md) — declaring fields and the full
  list of field types.
- [`configuration.md`](./configuration.md) — the `manguito.config.ts` reference.

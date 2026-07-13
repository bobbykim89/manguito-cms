---
"@bobbykim/manguito-cms-core": minor
"@bobbykim/manguito-cms-api": minor
"@bobbykim/manguito-cms-cli": minor
"@bobbykim/manguito-cms-admin": minor
---

Add programmatic fields: schema fields whose value is computed at read time by a TypeScript resolver, with no database column.

Declare a field with `"type": "programmatic"` and bind a resolver in `src/programmatic/` via `programmaticField({ schema, field }, (ctx) => ...)`. Resolvers read same-record data through `ctx.get()` / `ctx.record` and run when an item is read through the public API. Options include opt-in per-field TTL caching (`cache.ttl`), list-endpoint opt-in (`on_list`), a static `fallback`, and a per-resolver `timeout`; a failing or timed-out resolver degrades to its fallback at HTTP 200 rather than failing the response. Bindings are validated at startup, and the field renders as a read-only placeholder in the admin. Supported on content and taxonomy types. See `docs/programmatic-fields.md`.

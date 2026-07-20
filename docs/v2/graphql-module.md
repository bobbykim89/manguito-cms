# GraphQL Module — Design Index

**Date:** 2026-07-18
**Status:** Approved design (pre-implementation)
**Scope:** Add an **opt-in, query-only GraphQL surface** to the public API as a
second read-projection over the existing content machinery. REST remains the
default and reference contract. The admin surface is unaffected.

> This is a **decision document**, not an implementation plan. It records the
> stack, architecture, and trade-offs to be used as inputs for a future
> implementation plan. No code is changed by this document.

---

## Sub-documents

| Doc | Covers |
|-----|--------|
| [graphql-architecture.md](./graphql-architecture.md) | Where the module lives, how it mounts, the config shape, and the layer-boundary reasoning |
| [graphql-schema-mapping.md](./graphql-schema-mapping.md) | How the parsed registry becomes a GraphQL schema — types, query surface, pagination, relations, programmatic fields |
| [graphql-security.md](./graphql-security.md) | Damage control — depth/complexity limits, published-only guarantee, rate limiting, introspection posture |
| [graphql-decisions.md](./graphql-decisions.md) | Decision log — stack picks and rejected alternatives |
| [graphql-implementation-design.md](./graphql-implementation-design.md) | Implementation-ready design — concrete naming, type mapping, query args, resolver wiring, config, and the test plan |
| [graphql-module-plan.md](./graphql-module-plan.md) | Task-by-task TDD implementation plan (14 tasks) |

---

## 1. Is it worth it?

**Verdict: yes — as an opt-in module, not a replacement for REST.**

### The case for

Three real product drivers motivate a GraphQL surface:

1. **Client-shaped payloads** — consumers request exactly the fields they need,
   with arbitrarily deep relations, instead of REST's fixed shapes plus one-level
   `?include=`.
2. **Fewer round-trips** — a page that today needs several REST calls (e.g. a post
   plus its author plus related posts) collapses into one query.
3. **DX / ecosystem expectations** — schema introspection, typed clients, and a
   GraphiQL explorer are table stakes for a modern headless CMS.

The decisive factor is **cost containment**: GraphQL is largely a second
projection over machinery that already exists and is already tested —
`ContentRepository`, the request-scoped dataloader (N+1 batching), relation
resolution, and the programmatic resolver. It is not a new data path. High
perceived value, contained incremental cost.

### The honest case against

- It introduces a genuinely new abuse surface: unlike REST's fixed routes, a
  single GraphQL query can nest relations arbitrarily deep or alias-batch many
  expensive fetches — a DoS / N+1 amplification vector that does not exist today.
- It adds three dependencies (`graphql`, `graphql-yoga`, a query-limiting plugin)
  to the `api` package.
- It creates a second public contract that must stay in sync with the schema
  forever.

### Why the verdict is still "yes"

Every item in the case against is contained by the design:

- The surface is **query-only, published-only, unauthenticated, and opt-in**.
- It **reuses the REST guarantees structurally** (see
  [ADR api/0002](../adr/api/0002-public-admin-split.md)) rather than
  reimplementing them — it reads through the same published-only repositories, so
  drafts remain structurally invisible.
- The new dependencies are **isolated behind a subpath export** (per
  [ADR api/0006](../adr/api/0006-subpath-exports.md)), so consumers who never
  import the GraphQL entry point never bundle its dependencies.
- The second contract is **generated from the registry**, not hand-written, so it
  cannot drift from the schema.

**If nobody enables it, the blast radius is zero.**

---

## 2. Scope

**In scope**

- A single `/graphql` endpoint on the **public** API (`/api/*` surface).
- **Queries only** — the public API is a read surface; all writes stay on the
  authenticated admin REST API.
- Per content type and taxonomy type: a list query and a single-item query,
  mirroring the REST semantics 1:1.
- Relations resolved as nested graph fields via the existing dataloader.
- Programmatic fields resolved as GraphQL field resolvers.
- Built-in query-abuse protection (depth + complexity limits).

**Out of scope**

- Mutations / any write path.
- The admin surface — it stays REST-only. No admin module changes.
- Subscriptions.
- Relay cursor connections (offset/page pagination is used instead; see
  [graphql-schema-mapping.md](./graphql-schema-mapping.md)).
- Any change to `core` — the module is configured at the api-adapter level.

---

## 3. Locked decisions at a glance

| Decision | Choice |
|----------|--------|
| Worth it? | Yes — opt-in, additive v2 module; REST stays default/reference |
| Placement | `@bobbykim/manguito-cms-api/graphql` subpath export |
| Config shape | `createAPIAdapter({ graphql: { … } })` (named option) |
| Server library | GraphQL Yoga (fetch-native) |
| Schema construction | Code-first graphql-js, registry-driven |
| Pagination | Offset/page — mirrors REST `findMany` |
| Published / auth | Reuses `publicRepos` — inherits ADR api/0002 guarantee |
| Damage control | Depth + complexity + alias limits, route rate limit, dev-only introspection/GraphiQL |
| Breaking changes | None — additive & opt-in; core touched only by one additive optional `APIAdapter.graphql?` field (see [decisions D7](./graphql-decisions.md)) |

See [graphql-decisions.md](./graphql-decisions.md) for the reasoning behind each,
including rejected alternatives.

---

## 4. Estimated module size

Moderate. Roughly **7–9 source files** plus tests:

- `schema.ts` — builds the `GraphQLSchema` from the registry
- `type-mapping.ts` — field-type → GraphQL-type mapping
- `scalars.ts` — custom scalars (`DateTime`, `JSON`)
- `resolvers.ts` — root query + relation + programmatic field resolvers
- `security.ts` — depth/complexity/alias limit configuration
- `handler.ts` — Yoga instance + `createGraphQLHandler` factory
- `index.ts` — subpath public API surface

Plus a new `tsup` entry, a `package.json` export, and an opt-in mount in
`app.ts`. Estimated ~600–1000 LOC of source. No new package.

# GraphQL Module — Decision Log

**Date:** 2026-07-18
**Status:** Approved design (pre-implementation)

Back to the [index](./graphql-module.md).

Each decision below records the choice, the alternatives considered, and why the
alternatives were rejected — in the spirit of `docs/decisions/`. These become the
seed for per-package ADRs when the module is implemented.

---

## D1 — Placement: subpath export of `api`, not a new package {#d1}

**Decision:** Ship as `@bobbykim/manguito-cms-api/graphql`, a subpath export
beside `./storage`, `./runtime`, `./codegen`.

**Why:** GraphQL is a second read-projection over the api package's own registry,
published-only repositories, dataloader, and programmatic resolver — not an
independent surface. Living in-package lets it reuse those internals directly and
in-process. The subpath isolates its heavy dependencies from the core api bundle,
which is exactly the rationale of
[ADR api/0006](../adr/api/0006-subpath-exports.md).

**Rejected — a standalone `@bobbykim/manguito-cms-graphql` package.** It would
have to reach into api internals, forcing us to widen api's public export surface
(repository/resolver factories) solely to serve GraphQL, or duplicate the wiring.
The clean-isolation benefit does not outweigh inventing a new cross-package
contract for machinery that already lives in api.

---

## D2 — Config shape: named `graphql` option on `createAPIAdapter` {#d2}

**Decision:**

```ts
createAPIAdapter({ graphql: { enabled, maxDepth?, maxComplexity?, graphiql? } })
```

**Why:** Explicit, typed, discoverable. GraphQL is a known first-class feature of
the API layer and is configured like `rateLimit`, `cors`, and `media` already
are. No generic extension machinery to design, and — decisively — `core`'s
`defineConfig` schema stays untouched, keeping the change inside the api layer.

**Rejected — plugin array `createAPIAdapter({ modules: [graphqlModule()] })`.**
The right *long-term* shape once a genuine extension system exists, and the
open/closed instinct is sound. But it forces designing a full plugin contract now
(what a module receives, how it registers routes/middleware, ordering, error
handling). "Plugin / extension system" is already a separate v2+ roadmap item.
Building a one-off module bag would imply an unvalidated extensibility promise —
speculative generality (YAGNI).

**Rejected — separate top-level adapter `graphql: createGraphqlAdapter(...)`.**
Misrepresents the dependency structure (GraphQL depends entirely on api
internals), creates ambiguity over which adapter owns `/api`, and would require a
new top-level key in `core`'s `defineConfig` schema — the opposite of the
"leave core untouched" goal.

**Migration path preserved:** the internals are built as a self-contained
`createGraphQLHandler(registry, publicRepos, resolver, options)` factory. If a
real `modules: []` system later lands, `graphqlModule()` becomes a thin wrapper
over the same factory and `graphql` migrates into the array with a deprecation
window — the internals do not change.

---

## D3 — Server library: GraphQL Yoga {#d3}

**Decision:** Use GraphQL Yoga (The Guild) as the GraphQL server.

**Why:** Yoga is fetch-native — it consumes a standard `Request` and returns a
standard `Response`, so it mounts as a single Hono handler and rides the existing
runtime adapters (Node / Lambda / Vercel) with no per-runtime glue. It bundles a
GraphiQL explorer and has minimal surface. This directly fits the CMS's deploy
matrix and its Hono host.

**Rejected — Apollo Server.** Most widely known and largest ecosystem, but
heavier, more abstracted, and its serverless integrations are less clean than
Yoga's fetch model. Overkill for a query-only public surface.

**Rejected — bare `graphql-js` + hand-written Hono handler.** Minimal deps and
full control, but we would re-implement transport parsing, error mapping, and the
explorer — work Yoga already does well. The dependency saving is not worth the
boilerplate and the loss of the plugin ecosystem (which the damage-control plugins
depend on, see D6).

---

## D4 — Schema construction: code-first graphql-js, registry-driven {#d4}

**Decision:** Build the `GraphQLSchema` programmatically by iterating the parsed
registry, using the reference `graphql` package's type constructors.

**Why:** This mirrors how REST routes are already generated from the registry, so
the parser output stays the single source of truth and there is no second artifact
to keep in sync. It avoids an extra `@graphql-tools` dependency (needed for the
SDL-first path).

**Rejected — SDL-first via `@graphql-tools/schema`.** Generating an SDL string
plus a resolver map reads nicely, but adds a dependency and a second
representation of the schema that must track the registry. The registry is already
the canonical schema; emitting types straight from it is more direct.

**Rejected — a compile-time schema builder (e.g. Pothos).** These shine when the
schema is authored in TypeScript at build time. Here the schema is **dynamic** —
generated from the registry at runtime — so a compile-time-typed builder fights
the model.

---

## D5 — Pagination: offset/page, mirroring REST {#d5}

**Decision:** List queries take `page` / `perPage` and return `{ data, meta }`,
identical to the REST `findMany` semantics.

**Why:** Maps 1:1 onto the existing repository, keeps one pagination mental model
across both public surfaces, and is trivial to reason about. Same bounds and same
error codes as REST.

**Rejected — Relay cursor connections.** Idiomatic GraphQL and cache-friendly for
Apollo/urql/Relay, but the repository is offset-based today, so cursors would just
be base64-encoded offsets — the connection ceremony without true keyset
pagination's benefits. Not worth the extra surface area or the divergence from
REST for a first release. Revisitable if the repository gains keyset pagination.

---

## D6 — Damage control: depth + complexity limits (GraphQL Armor) {#d6}

**Decision:** Ship depth, complexity, alias, and directive limits **on by default**
(config-overridable) via GraphQL Armor, plus route rate limiting and
production-off introspection/GraphiQL.

**Why:** A public GraphQL endpoint's defining risk is unbounded query cost from
deep nesting and alias batching — vectors REST does not have. Shipping protection
on by default, rather than deferring it, is the responsible posture for an
unauthenticated public surface. Armor bundles the needed checks as Yoga plugins in
one place.

**Rejected — minimal (rely on rate limiting only).** Simplest to build but leaves
the endpoint exposed to a single expensive query; request-count limiting does not
bound per-query cost. Unacceptable default for a public surface.

**Rejected — strict + persisted queries.** Allowlisting pre-registered operations
in production is maximally safe but heavier to build and constrains ad-hoc
clients — at odds with the "flexible client-shaped queries" motivation. Can be
added later as an opt-in hardening layer without redesign.

**Fallback:** if adding GraphQL Armor as a dependency is undesirable at
implementation time, depth and complexity limits can be hand-rolled as validation
rules over the reference `graphql` package. Armor is preferred for covering alias
and directive limits too, out of the box.

---

## D7 — Breaking-change analysis {#d7}

**Decision:** The module is additive and non-breaking.

- **Additive subpath export** — existing entry points (`.`, `./storage`,
  `./runtime`, `./codegen`) are unchanged; `./graphql` is new.
- **Opt-in mount, defaulting off** — `createCmsApp` only mounts `/graphql` when
  `graphql.enabled` is set. Existing configs behave identically.
- **New dependencies land in `api` only** (`graphql`, `graphql-yoga`,
  `@escape.tech/graphql-armor`, `dataloader`), isolated behind the subpath so
  consumers who never import `./graphql` never bundle them — the exact rationale
  ADR api/0006 exists for. The `api` package already carries heavy deps (aws-sdk),
  so this is consistent with its role; it does **not** touch `core`'s deliberately
  minimal shared-kernel dependency set
  ([ADR core/0006](../adr/core/0006-core-shared-kernel-dependencies.md)).
- **`db`, `admin`, `cli` are otherwise untouched** (the CLI dev + build codegen
  gain a pass-through of the new option). Admin stays REST-only.
- **`core` is touched by exactly one additive, optional field.** Refinement of the
  original "core untouched" claim: carrying a typed `graphql` option through the
  `config.api` path requires `graphql?: ResolvedGraphQLConfig` on core's
  `APIAdapter` interface (plus the option/resolved types), mirroring the existing
  `rateLimit?`. No parser change, no new core dependency, no runtime-behavior
  change — `defineConfig`'s validation is unaffected.

**Ongoing cost:** a second public contract that must track schema changes —
mitigated because it is generated from the registry, not hand-written, and so
cannot drift.

---

## D10 — Nested relations: per-request DataLoader wrapping `resolveRelationField` {#d10}

**Decision:** Add the npm `dataloader` package and a `graphql/dataloaders.ts` that
creates, per request, one `DataLoader` per `(type, relationField)`. Each loader's
batch function delegates to the existing `resolveRelationField` (in
`packages/api/src/relations.ts`) with a request-shared cache, then returns each
parent's resolved relation value.

**Why:** The impl-design doc originally assumed GraphQL could "reuse the existing
dataloader," but the repository's batching is internal to a single
`findMany`/`findBySlug` call and resolves relations **eagerly, one level deep** via
`include`. GraphQL's value proposition is *arbitrarily deep* nested relations in
one round-trip, which requires request-scoped batching across field resolvers at
every level. Wrapping `resolveRelationField` in a `DataLoader` gets that while
reusing all existing relation SQL — no second copy of relation resolution.

**Rejected — selection-set-driven eager `include` (no new dependency).** The root
resolver would inspect the query's selection set, build `include: […]`, and pass
it to the repository. But the repository's `include` is flat (depth 1), so nested
relations beyond the first level would return bare IDs, not objects — gutting the
arbitrary-depth motivation (drivers #1 and #2 in
[graphql-module.md](./graphql-module.md#1-is-it-worth-it)). The small `dataloader`
dependency is worth the correct behavior.

---

## D8 — Field naming: camelCase, with a name-mapping layer {#d8}

**Decision:** GraphQL field names are **camelCase** (`createdAt`, `perPage`) and
type names **PascalCase** (`BlogPost`), even though the registry, repositories, and
DB columns are snake_case. The schema builder carries a per-type
`graphqlName ↔ schemaName` map used to translate output reads, `sortBy`, and
`filter` back to snake_case. Detailed in
[graphql-implementation-design.md](./graphql-implementation-design.md#1-naming-and-the-name-mapping-layer).

**Why:** Consumers who choose a GraphQL endpoint bring GraphQL tooling (Code
Generator, Apollo/urql/Relay, GraphiQL) that assumes camelCase; the major public
GraphQL APIs are camelCase. The friction of non-idiomatic snake_case outweighs the
benefit of field-name parity with REST — and introspection makes the two surfaces
self-documenting, so cross-surface translation cost is minimal.

**Rejected — preserve snake_case.** One naming model across REST and GraphQL, but
non-idiomatic and at odds with the GraphQL ecosystem's tooling defaults.

**Cost recorded:** a small, mechanical, bidirectional name-mapping layer. Contained
in `naming.ts`; note that field-name remapping is safe because names are
identifiers, unlike enum *value* remapping (see D9).

---

## D9 — Enum mapping: real enum when valid, else String; never translate values {#d9}

**Decision:** A schema enum maps to a `GraphQLEnumType` **only when all its values
are valid GraphQL identifiers** (`^[_A-Za-z][_0-9A-Za-z]*$`); otherwise the field
is exposed as `String`. Enum **values are never transformed** — the GraphQL wire
value always equals the stored/REST value. A dev-time warning is emitted on
fallback.

**Why:** The two public surfaces must agree on wire *values* (data), a stronger
constraint than field-name parity. Translating enum values would make a GraphQL
result (`HIGH_PRIORITY`) differ from the REST result (`high priority`), breaking
client-side equality checks. The conditional mapping gains first-class enum typing
wherever it is free (well-formed enums) and degrades only where a valid
`GraphQLEnumType` is impossible anyway.

**Rejected — always String.** Consistent and simple, but discards free type safety
(introspection, validation, codegen unions) even when values are clean.

**Rejected — always enum with sanitized values.** Consistent enum typing
everywhere, but the GraphQL wire value would differ from the stored/REST value,
requiring a bidirectional value map and diverging from REST — the dealbreaker.

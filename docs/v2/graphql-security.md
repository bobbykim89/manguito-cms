# GraphQL Module — Security & Damage Control

**Date:** 2026-07-18
**Status:** Approved design (pre-implementation)

Back to the [index](./graphql-module.md).

GraphQL trades REST's fixed, enumerable routes for client-authored queries. That
flexibility is the value proposition and the risk. This document records the
protective posture the module ships with.

---

## 1. The new risk surface

Compared to the REST public API, a GraphQL endpoint introduces abuse vectors that
**do not exist today**:

- **Unbounded nesting.** Relations resolve as nested fields
  ([schema-mapping §4](./graphql-schema-mapping.md#4-relations-as-nested-fields)),
  so a hostile query can traverse `posts → author → posts → author → …` deeply,
  amplifying work far beyond any single REST route.
- **Alias batching.** One HTTP request can alias the same expensive field many
  times, multiplying cost while looking like a single request to naive rate
  limiting.
- **Cost amplification.** A syntactically small query can fan out into a very
  large result set.

The dataloader mitigates the classic N+1 case, but it does not bound total query
*cost* — a deeply nested or alias-heavy query still does a lot of work. Explicit
limits are therefore mandatory, not optional.

---

## 2. Protective posture (shipped by default)

The module ships **depth + complexity limiting** enabled by default,
config-overridable:

| Control | Default | Override |
|---------|---------|----------|
| Max query depth | e.g. `8` | `graphql.maxDepth` |
| Max query complexity / cost | e.g. `1000` | `graphql.maxComplexity` |
| Alias / directive count caps | on | (built-in) |
| Route rate limiting | reuse in-process limiter | inherits api `rateLimit` config |
| Introspection | dev-only | `graphql.graphiql` / env |
| GraphiQL explorer | dev-only | `graphql.graphiql` |

### Depth, complexity, alias limits

Implemented with **GraphQL Armor**, an envelop/Yoga plugin suite covering max
depth, cost/complexity, alias count, and directive count in one place. It plugs
into Yoga natively. Defaults are conservative and overridable per the config
table above. Rationale and the hand-rolled alternative are in
[graphql-decisions.md](./graphql-decisions.md#d6).

### Rate limiting

The `/graphql` route reuses the existing **in-process rate limiter**
([ADR api/0005](../adr/api/0005-in-process-rate-limiting.md)) applied at mount
time in `app.ts`. GraphQL requests count against the same limiter as public list
endpoints. Because a single GraphQL request can be far more expensive than one
REST call, depth/complexity limits — not request count alone — are the primary
defense; rate limiting is the second layer.

### Introspection and GraphiQL

Both are **enabled in development and disabled in production by default**.
Introspection exposes the full schema shape; GraphiQL is an interactive explorer.
Neither should be publicly reachable in production unless the operator explicitly
opts in via `graphql.graphiql`. Yoga makes both toggleable.

---

## 3. Published-only guarantee (inherited, not reimplemented)

The single most important security property is that **the public GraphQL surface
can never return draft content**. This is guaranteed *structurally*, the same way
REST guarantees it:

- Every GraphQL resolver reads through **`publicRepos`** — the published-only
  repositories constructed once in `createCmsApp` (`app.ts:140`). These repos are
  the same physical objects the public REST routes use.
- There is **no argument, filter, or nested traversal path** that reaches the
  admin repos or bypasses the `published: true` constraint. The module never
  receives a reference to the admin repositories.
- This inherits [ADR api/0002](../adr/api/0002-public-admin-split.md) — "drafts
  never leak to the public API" — rather than re-deriving it. There is no second
  copy of the draft-visibility logic to get wrong.

The GraphQL endpoint is, like the rest of `/api/*`, **unauthenticated**. It sits
entirely on the public surface; the authenticated `/admin/api/*` surface is
untouched and gains no GraphQL.

### Known limitation (carried over from REST)

Media referenced by unpublished content remains reachable by direct storage URL —
the same known limitation ADR api/0002 records for REST. GraphQL does not change
this either way (it never surfaces unpublished content itself); gated media
serving remains deferred.

---

## 4. Error handling

GraphQL has its own top-level `errors` array, so failures inside a query surface
there. Where the module produces its own validation failures (bad pagination,
invalid sort/filter fields), it reuses the **REST error codes**
(`INVALID_PAGINATION`, `INVALID_SORT_FIELD`, `INVALID_FILTER_FIELD`) so operators
see consistent diagnostics across both surfaces. Limit violations (depth /
complexity) return a clear, non-leaky error without echoing the offending query
structure.

---

## 5. Summary

The endpoint is opt-in, unauthenticated, query-only, published-only, depth- and
complexity-bounded, rate-limited, and introspection-closed in production. The one
genuinely new risk relative to REST — unbounded query cost — is addressed by
mandatory, on-by-default limits. If the module is not enabled, none of this
surface exists.

---
"@bobbykim/manguito-cms-core": minor
"@bobbykim/manguito-cms-api": minor
"@bobbykim/manguito-cms-cli": minor
---

Add an opt-in GraphQL public API: a query-only surface generated from the schema registry and served at `POST /graphql`, alongside (not replacing) the REST API.

Enable it in `manguito.config.ts`:

```ts
api: createAPIAdapter({
  graphql: { enabled: true },
  // maxDepth: 8, maxComplexity: 1000, graphiql/introspection: dev-only
})
```

Each content type gets a collection query and a single-item query — `blogPosts(page, perPage, sortBy, sortOrder, filter)` returning `{ data, meta }`, and `blogPost(slug)`; `only_one` types expose a singular query, and taxonomy types get `categories(...)` / `category(id)`. Pagination, sorting, filtering and error codes mirror the REST contract, so the two surfaces stay consistent. GraphQL types are PascalCase and fields camelCase (`created_at` → `createdAt`), while enum *values* are never translated — an enum becomes a real GraphQL enum when every value is a valid identifier, otherwise the field is exposed as `String`.

Relations resolve as nested fields to arbitrary depth, batched per request through a DataLoader over the existing relation queries, so a nested selection does not produce N+1 queries. Programmatic fields resolve lazily and only when selected. Reads go through the same published-only repositories the public REST routes use, so drafts are never reachable.

Because a public GraphQL endpoint can be abused in ways fixed REST routes cannot, query-cost limits ship on by default (depth, cost, alias, directive and token caps via GraphQL Armor), the endpoint reuses the existing list-endpoint rate limiter, and introspection plus the GraphiQL explorer default to development only. Enabling GraphiQL also relaxes the Content-Security-Policy for the `/graphql` path alone so the explorer can load; every other route keeps the strict policy.

The module is isolated behind the `@bobbykim/manguito-cms-api/graphql` subpath export and loaded dynamically, so `graphql`/`graphql-yoga` are not pulled in unless the feature is enabled. `core` gains one additive optional field (`APIAdapter.graphql`) plus the `GraphQLModuleConfig` / `ResolvedGraphQLConfig` types; the CLI threads the option through `dev` and `build` and routes `/graphql` to the API in the dev server. Existing configs are unaffected — with no `graphql` option, nothing mounts and no dependency loads. The admin panel is unchanged and remains REST-only. See `docs/v2/graphql-module.md`.

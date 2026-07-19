# GraphQL Module — Architecture

**Date:** 2026-07-18
**Status:** Approved design (pre-implementation)

Back to the [index](./graphql-module.md).

---

## 1. Where the module lives

The GraphQL module ships as a **subpath export of the `api` package**:
`@bobbykim/manguito-cms-api/graphql`, alongside the existing `./storage`,
`./runtime`, and `./codegen` entry points.

This follows [ADR api/0006](../adr/api/0006-subpath-exports.md) exactly. The
motivation there — isolate heavy dependencies so consumers only bundle what they
import — applies directly: `graphql`, `graphql-yoga`, and the query-limiting
plugin should never land in the core `api` bundle for a consumer who only uses
REST. A user who imports nothing from `./graphql` bundles none of it.

### Why not a separate package?

Considered and rejected. GraphQL is **not an independent surface** — it is a
second projection over the api package's own registry, published-only
repositories, dataloader, and programmatic resolver. A standalone
`@bobbykim/manguito-cms-graphql` package would have to reach back into api
internals, forcing us to widen api's public export surface (repository/resolver
factories) purely to serve GraphQL, or to duplicate the wiring. Keeping the
module in-package lets it reuse those internals directly, in-process, with no new
cross-package contract. See [graphql-decisions.md](./graphql-decisions.md#d1).

---

## 2. How it mounts

The module exposes a single factory:

```ts
// @bobbykim/manguito-cms-api/graphql
export function createGraphQLHandler(
  registry: SchemaRegistry,
  publicRepos: ContentRepos,
  resolver: ProgrammaticResolver,
  options: GraphQLHandlerOptions
): Handler // a Hono handler
```

`createCmsApp` (in `app.ts`) mounts it as a single route **only when enabled**:

```ts
if (graphqlOptions?.enabled) {
  const graphqlHandler = createGraphQLHandler(
    registry,
    publicRepos,          // the published-only repos already built at app.ts:140
    programmaticResolver,
    graphqlOptions
  )
  app.all('/graphql', listRateLimit ?? passthrough, graphqlHandler)
}
```

Key points:

- **One handler, all HTTP methods.** GraphQL Yoga is fetch-native: it consumes a
  standard `Request` and returns a standard `Response`, so it rides the existing
  runtime adapters (`./runtime` → Node / Lambda / Vercel) with no per-runtime
  glue. This is the reason Yoga was chosen over Apollo Server.
- **It reuses `publicRepos`, never the admin repos.** Those are the published-only
  repositories constructed once in `createCmsApp`. Reusing them is what makes the
  "drafts are structurally invisible" guarantee of
  [ADR api/0002](../adr/api/0002-public-admin-split.md) inherited rather than
  reimplemented. Detailed in [graphql-security.md](./graphql-security.md).
- **It reuses the programmatic resolver and the dataloader.** No second copy of
  relation resolution or N+1 batching.

---

## 3. Configuration shape

GraphQL is configured as a **named option on `createAPIAdapter`**:

```ts
api: createAPIAdapter({
  prefix: '/api',
  media: { max_file_size: 4 * 1024 * 1024 },
  graphql: {
    enabled: true,
    // maxDepth: 8,        // query nesting cap
    // maxComplexity: 1000,// total field-cost cap
    // graphiql: false,    // force-disable the explorer (default: dev-only)
  },
}),
```

`createAPIAdapter` today returns a plain, declarative config descriptor
(`{ prefix, media }`) that the runtime later feeds into `createCmsApp`. The
`graphql` block is more declarative config of the same kind — serializable
options, not live code. The `APIAdapterOptions` type in
`packages/api/src/adapters/api.ts` gains a `graphql?: GraphQLModuleOptions` field,
and the resolved `APIAdapter` config carries it through to `createCmsApp`.

### Why a named option and not a plugin array or a sibling adapter

This was the main architectural fork. Full reasoning and rejected alternatives
are in [graphql-decisions.md](./graphql-decisions.md#d2). Summary:

- **Named option (chosen).** Explicit, typed, discoverable. GraphQL is a known
  first-class feature of the API layer, configured like `rateLimit`, `cors`, and
  `media` already are. No generic extension machinery to design. `core` stays
  untouched.
- **Plugin array — `modules: [graphqlModule()]` (rejected for now).** The right
  long-term shape once a real extension system exists, but it forces designing a
  full plugin contract now (what a module receives, how it registers routes,
  ordering, error handling). "Plugin / extension system" is already a separate
  v2+ roadmap item. Building a one-off module bag would imply an extensibility
  promise not yet validated — speculative generality.
- **Separate top-level adapter — `graphql: createGraphqlAdapter(...)`
  (rejected).** Misrepresents the dependency structure and would require a new
  top-level key in `core`'s `defineConfig` schema, which we explicitly want to
  avoid.

### Designed for a clean future migration

To keep the door open to the plugin shape without paying its design cost today,
the internals are built as the self-contained `createGraphQLHandler` factory
above. If a real `modules: []` system later lands, moving `graphql` into it is
mechanical: `graphqlModule()` becomes a thin wrapper that calls the same factory.
The public config surface can migrate with a deprecation window; the internals do
not change.

---

## 4. Layer boundaries

The module respects every boundary in `CLAUDE.md`:

- It lives in **api**, which may import from `core` and `db` — no new boundary
  crossings.
- It touches **neither `core` nor `admin` nor `cli` nor `db`**. Configuration is
  api-adapter-level, so `core`'s `defineConfig` schema is unchanged.
- `admin` stays REST-only, as required.

### Impact summary

| Package | Change |
|---------|--------|
| `core` | **None** |
| `db` | **None** |
| `api` | New `./graphql` subpath, new deps (isolated), opt-in mount in `app.ts`, `graphql` field on `APIAdapterOptions` |
| `admin` | **None** |
| `cli` | **None** |

Because the mount is opt-in and defaults off, and the subpath isolates the
dependencies, this is an **additive, non-breaking** change. See
[graphql-decisions.md](./graphql-decisions.md#d7) for the breaking-change
analysis.

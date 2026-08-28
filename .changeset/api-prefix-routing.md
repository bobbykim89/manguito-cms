---
"@bobbykim/manguito-cms-api": minor
---

Make the `api.prefix` config option actually route. It has been documented as functional (`docs/configuration.md`) but was inert: every public route registrator hardcoded its `/api/...` path string, so setting `prefix: '/content-api'` changed nothing and the routes stayed on `/api`.

Public route paths are now built in one module (`packages/api/src/paths.ts`) instead of being written out at each registration site, and both places that default the prefix — `createCmsApp` and `createAPIAdapter` — normalize through the same `normalizePrefix`, which adds the leading slash, strips trailing ones, and falls back to `/api` for an empty value. This is also where a later schema-version segment gets inserted, which is why it moved.

**This is a breaking change for any deployment that already sets a custom `api.prefix`.** Those routes are served from `/api/*` today, and after this upgrade they move to the configured prefix — so consumers still calling `/api/*` will get a 404. Before upgrading, either update those consumers to the configured prefix, or remove `api.prefix` from the config to stay on the default `/api`. Every public route moves together — content, taxonomy, media and `openapi.json`. Deployments that never set the option are unaffected, and two surfaces are not prefixed at all and do not move: the admin API (`/admin/api/*`) and the GraphQL endpoint (`POST /graphql`).

Also groundwork, with no behavior change today: every top-level read and write path in the api package now converts between a field's public label and its Postgres storage column at two explicit boundaries rather than assuming the two are identical (they are, for every schema the parser currently produces). See ADR api/0011.

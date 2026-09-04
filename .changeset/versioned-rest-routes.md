---
"@bobbykim/manguito-cms-api": minor
"@bobbykim/manguito-cms-cli": minor
---

Every live schema version of the public read contract now gets its own route prefix — `/api/v1/blog` and `/api/v3/blog` serve the same database row under whatever field names that version's schema declared, so a consumer can pin a version and keep receiving its exact shape after later versions are cut.

`/api/*` with no version segment still works: it resolves to the current version. Once more than one version is live, it (and any older live version's own prefix) carries `Deprecation: true` and a `Link: <...>; rel="successor-version"` naming the current version's root; the unversioned path additionally carries a `Warning: 299` explaining that it floats and will move under the consumer the next time a version is cut. A project that has never cut a version sees no new headers, and no previously-working URL changes behaviour — though `/api/v1/*` and the version-segment catch-all's JSON responses are new surface that did not exist before this release. A version number that was cut and later retired answers `410 VERSION_RETIRED`; one that was never cut answers `404 VERSION_NOT_FOUND` — both in the standard `{ ok, error }` envelope, naming the live versions.

Media and the OpenAPI document are not versioned: `MediaItem` is a fixed shape the schema never touches, and one OpenAPI document already describes every live version.

The version model is computed by `manguito build` (and by `manguito dev`, on first start and every hot reload) and baked beside the generated registry, since the api has no filesystem access to the schema at runtime — every generated server always passes a real model, single-version or not. The api's own identity-model fallback (`current: 'v1', live: ['v1'], projections: {}`) only ever applies to a `createCmsApp({ ... })` call built by hand with `versions` omitted entirely, so that caller keeps working unversioned; it is not something a generated project ever falls back to. Either way, an existing project that has never run `version:cut` keeps every previously-working URL behaving exactly as before.

Known boundary: paragraph types have no per-version projection, so nested paragraph content, programmatic fields and many-to-many references always follow the current schema's field names, regardless of which version prefix served the request. `manguito version:diff` does report a paragraph field's rename, which the served contract will not honour — pin-and-diff workflows should not rely on it for paragraph fields.

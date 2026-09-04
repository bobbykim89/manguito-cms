# Api

The HTTP layer of Manguito CMS. It generates REST routes from the parsed registry, enforces auth and permissions, runs uploads through storage adapters, and serves the OpenAPI spec. It imports from core and db (db only via injected repositories). See [docs/adr/api](../../docs/adr/api) for the decisions that shape it.

## Language

### Surfaces

**Public API**:
The unauthenticated `/api/*` surface. Always returns published content only — drafts are structurally invisible here.
_Avoid_: front-end API, read API

**Admin API**:
The authenticated `/admin/api/*` surface. Full access including drafts and all write operations.
_Avoid_: management API, private API, backend API

**GraphQL API**:
The opt-in, query-only `/graphql` surface — a second read projection over the same published-only repositories, dataloaders and programmatic resolver the public REST routes use. Mounted only when `graphql.enabled` is configured, and served from the `./graphql` subpath export so its dependencies stay out of the default bundle. An absolute path, not nested under the API `prefix`.
_Avoid_: GraphQL endpoint (when meaning the surface), gql API

**Envelope**:
The uniform response shape — `{ ok: true, data, meta? }` on success, `{ ok: false, error: { code, message, details? } }` on failure.
_Avoid_: wrapper, response object

**Versioned surface**:
Content and taxonomy routes carry a version segment — `/api/v1/blog`, `/api/v3/blog` — serving the same database row under different field names, one prefix per live version. Media and the OpenAPI document never do: `MediaItem` is a fixed shape the schema never touches, so a version segment on it would duplicate byte-identical routes per live version, and one OpenAPI document already describes every live version. `PublicPaths` (fixed) and `VersionedPaths` (schema-driven) are separate types for exactly this reason — the split makes versioning media unexpressible, not merely discouraged.
_Avoid_: version prefix, API versioning (unqualified)

**Unversioned path**:
`/api/*` with no version segment; resolves to the current live version. Once more than one version is live, it carries `Deprecation: true`, a `Link: <...>; rel="successor-version"` naming the current version's root, and a `Warning: 299` explaining that it floats and will move under the consumer when a version is cut. A project that has never cut a version sees none of this — the warning stays silent while only one version is live, since it would nag every unversioned project the moment it rebuilt. An older live version's own path also carries `Deprecation`/`Link`; the current version's own path carries neither, since a header there would train consumers to ignore it.
_Avoid_: default version, latest alias, floating version

**Retired / unknown version**:
What a requested version outside the live set is classified as — derived from the baked [[baked-version-model]] alone, nothing persisted. A number below `current`'s that is not live was cut and later retired → 410 `VERSION_RETIRED`; a number at or above `current`'s was never cut → 404 `VERSION_NOT_FOUND`. Both use the standard [[envelope]] and name the live versions; a 404 for a retired version would read as "wrong URL" and send a pinned consumer hunting for a typo instead of upgrading.
_Avoid_: invalid version, unsupported version

### Data access

**Repository**:
The `ContentRepository<T>` abstraction route handlers use instead of the ORM. Interface in core; the Drizzle implementation (`createDrizzleContentRepository`) lives in this api package and imports only the `DrizzlePostgresInstance` type from db; injected at startup.
_Avoid_: DAO, model, store, service

**Dataloader**:
The repository's request-scoped batching that resolves relations with `WHERE id IN (...)` to avoid N+1 queries. Cache is discarded after each response.
_Avoid_: batcher, cache layer

**Include**:
The `?include=` query parameter that expands a relation from IDs to full nested objects. Media is always fully resolved regardless.
_Avoid_: expand, populate, with

**Relation persistence**:
Writing a content item's paragraph and junction relations to their child/junction tables (delete + reinsert). Owned by the relation module; each persist/delete reports its [[media-delta]] for the caller to reconcile. Distinct from relation *resolution* (the read side, still in the repository).
_Avoid_: relation save, sync relations

### Field identity

**Label**:
A field's public name (`ParsedField.name`) — what API consumers, the admin panel, and GraphQL see. Mutable: a schema rename changes the label only.
_Avoid_: field name (when precision matters), key

**Storage key**:
A field's Postgres column (`db_column.column_name`). Immutable for the life of the data, so it is the field's identity across versions. Only column-backed fields have one — paragraph and many-to-many reference fields keep the label as their identity.
_Avoid_: column name (when referring to identity rather than SQL), db name

**Field key map**:
The per-content-type `FieldKeyMap` built once at startup that converts label-keyed request bodies to storage keys and storage-keyed rows back to labels. Throws on a label/column collision rather than booting ambiguous.
_Avoid_: field mapper, key translator

**Projection**:
Converting a storage-keyed row into a label-keyed response, recursively — the top-level row plus paragraph children, resolved reference targets and junction targets, each through its own type's map. Applied once per response at the outbound boundary; never mutates its input, because the relation cache shares one nested object between parents.
_Avoid_: serialization, mapping (when precision matters)

**Baked version model**:
The `{ current, live, projections }` shape `manguito build` and `manguito dev` compute and pass as `CreateCmsAppOptions['versions']` — the api has no filesystem access to the schema at runtime (in Lambda the `schemas/` tree is not deployed), so this is baked exactly as the registry is. `union` is deliberately omitted: it IS the current registry, which `createCmsApp` already receives, so baking it too would duplicate the whole registry in the generated bundle.
_Avoid_: version registry, baked schema

**Projection gap**:
Paragraph types have no [[projection]] — core's `buildProjections` iterates content and taxonomy types only. Nested paragraph content, programmatic (computed) fields, and many-to-many references therefore follow **current's** field key map on every version, never the requested one's. This is a sharp edge, not a safe default: `describeSchemaChange` *does* cover paragraph types' column-backed fields, so `manguito version:diff` reports a paragraph field's rename that the served contract then silently fails to honour.
_Avoid_: full versioning, complete projection coverage

### Auth

**auth_token / refresh_token**:
The two httpOnly JWT cookies. `auth_token` (2h) authorizes requests; `refresh_token` (7d, path-scoped to the auth endpoints) obtains a new `auth_token`.
_Avoid_: access token, session cookie, bearer token

**token_version**:
The per-user DB counter embedded in the JWT and compared on each request; bumping it instantly revokes outstanding tokens.
_Avoid_: token id, nonce, session version

**Roles registry**:
The immutable `Record<string, ParsedRole>` built once at startup and closed over by middleware for DB-free permission lookups.
_Avoid_: roles cache, permissions table

**requirePermission / requireHierarchy**:
The middleware factories. `requirePermission` checks a `target:action` against the acting role; `requireHierarchy` enforces that the acting user outranks the target role (lower `hierarchy_level`).
_Avoid_: guard, authorize, gate

**must_change_password**:
The user flag that blocks every admin route except the change-password endpoint until a forced password change is completed.
_Avoid_: password reset flag, force reset

### Storage

**Presigned upload**:
The default upload flow — the client sends the file directly to storage via a server-issued signed URL, then confirms; the server never streams the bytes. The local adapter simulates it.
_Avoid_: direct upload, proxied upload

**Orphaned media**:
A media row with `reference_count = 0` — referenced by no content and eligible for cleanup.
_Avoid_: unused media, dangling file

**Media reference tracking**:
The module that reconciles `media.reference_count` on every content write. It counts **content items**, not reference slots: a media id referenced many times by one item counts once, and a move between slots in one write is a no-op.
_Avoid_: ref counting, usage tracking

**Media delta**:
The `{ added, removed }` set of media ids a single content write gains and loses, computed for top-level fields and supplied by paragraph persistence, then merged and applied as one reconciliation.
_Avoid_: media diff, change set

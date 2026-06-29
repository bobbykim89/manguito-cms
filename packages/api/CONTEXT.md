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

**Envelope**:
The uniform response shape — `{ ok: true, data, meta? }` on success, `{ ok: false, error: { code, message, details? } }` on failure.
_Avoid_: wrapper, response object

### Data access

**Repository**:
The `ContentRepository<T>` abstraction route handlers use instead of the ORM. Interface in core, Drizzle implementation in db, injected at startup.
_Avoid_: DAO, model, store, service

**Dataloader**:
The repository's request-scoped batching that resolves relations with `WHERE id IN (...)` to avoid N+1 queries. Cache is discarded after each response.
_Avoid_: batcher, cache layer

**Include**:
The `?include=` query parameter that expands a relation from IDs to full nested objects. Media is always fully resolved regardless.
_Avoid_: expand, populate, with

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

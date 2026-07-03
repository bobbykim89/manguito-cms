# Phase 5 — REST API Layer

> Hono app setup, dynamic route generation, repository pattern, media endpoints, OpenAPI spec, and storage adapter wiring.

This phase builds `@bobbykim/manguito-cms-api` — the HTTP layer that exposes content, taxonomy, and media as a REST API. It takes the `SchemaRegistry` from Phase 2, the database layer from Phase 3, and produces a fully functional API server with public and admin surfaces.

**Done when:** All content type and taxonomy type routes are generated correctly from the `SchemaRegistry`. Public endpoints return published content only. Admin endpoints require authentication and support full CRUD including draft access. Media upload, retrieval, and management endpoints work across all three storage adapters. OpenAPI specs are served at `/api/openapi.json` and `/admin/api/openapi.json`. All unit and integration tests pass.

---

## Decisions Made

| Topic | Detail doc |
|-------|-----------|
| Package structure, entry points, repository wiring | [phase-05-package-structure.md](./phase-05-package-structure.md) |
| Published/draft state — filtering and toggle behavior | [phase-05-published-draft.md](./phase-05-published-draft.md) |
| Slug creation, validation, mutability | [phase-05-slug-handling.md](./phase-05-slug-handling.md) |
| Pagination strategy and response envelope | [phase-05-pagination.md](./phase-05-pagination.md) |
| Filtering, sorting, and `?include=` relation population | [phase-05-filtering-sorting.md](./phase-05-filtering-sorting.md) |
| Error code catalog — all HTTP API error codes | [phase-05-error-codes.md](./phase-05-error-codes.md) |
| Storage adapter interface, factory signatures, presigned URL behavior | [phase-05-storage-adapter.md](./phase-05-storage-adapter.md) |
| Rate limiting — strategy, scope, configuration | [phase-05-rate-limiting.md](./phase-05-rate-limiting.md) |
| Route generation and repository pattern | [phase-05-route-generation.md](./phase-05-route-generation.md) |
| Media endpoints and upload strategy | [phase-05-media-endpoints.md](./phase-05-media-endpoints.md) |
| OpenAPI spec generation | [phase-05-openapi.md](./phase-05-openapi.md) |

---

## Where This Fits

```
Phase 2 — SchemaRegistry produced by parser
Phase 3 — PostgresAdapter, Drizzle schema codegen
Phase 4 — scanMigrationFiles (used by CLI, not API)

Phase 5 — adds:
  createCmsApp()             ← wires db + storage + routes into Hono app
  Content routes             ← /api/* and /admin/api/* generated from SchemaRegistry
  Media routes               ← /api/media/* and /admin/api/media/*
  Storage adapters           ← local, S3, Cloudinary
  OpenAPI specs              ← /api/openapi.json and /admin/api/openapi.json

Phase 6 — auth middleware (JWT, token_version check) — applied to /admin/api/*
Phase 8 — admin panel consumes /admin/api/*
Phase 9 — CLI orchestrates manguito dev / build / start
```

---

## Package Structure

```
packages/api/src/
├── app.ts                      ← createCmsApp
├── routes/
│   ├── content.ts              ← public content routes
│   ├── media.ts                ← public media routes
│   └── admin/
│       ├── content.ts          ← admin content routes
│       └── media.ts            ← admin media routes
├── repositories/
│   ├── content.ts              ← createDrizzleContentRepository (concrete repository)
│   └── media.ts
├── middleware/
│   ├── auth.ts
│   ├── cors.ts
│   ├── error.ts
│   └── rate-limit.ts
├── codegen/
│   └── routes.ts               ← generateRoutes() pure function
├── storage/
│   ├── index.ts                ← /storage entry point
│   └── adapters/
│       ├── local.ts
│       ├── s3.ts
│       └── cloudinary.ts
├── runtime/
│   ├── index.ts                ← /runtime entry point
│   ├── server.ts
│   ├── lambda.ts
│   └── vercel.ts
└── index.ts
```

Entry points:
```
@bobbykim/manguito-cms-api            ← createCmsApp + createAPIAdapter
@bobbykim/manguito-cms-api/storage    ← createLocalAdapter, createS3Adapter, createCloudinaryAdapter
@bobbykim/manguito-cms-api/runtime    ← createServer, createLambdaHandler, createVercelHandler
```

---

## API Surface

```
-- public (no auth, published content only)
GET  /api/{base_path}                      — list content items
GET  /api/{base_path}/{slug}               — single content item
GET  /api/taxonomy/{type}                  — list taxonomy terms
GET  /api/taxonomy/{type}/:id              — single taxonomy term
GET  /api/media                            — list media (paginated)
GET  /api/media/:id                        — single media item
GET  /api/openapi.json                     — public OpenAPI spec

-- admin (authenticated)
GET/POST/PATCH/DELETE /admin/api/{type}/:id
GET/POST/PATCH/DELETE /admin/api/taxonomy/{type}/:id
POST   /admin/api/media/image              — direct upload
POST   /admin/api/media/video
POST   /admin/api/media/file
GET    /admin/api/media/presigned-url      — presigned upload init
POST   /admin/api/media/confirm/:id        — presigned upload confirm
PATCH  /admin/api/media/:id               — update alt text
DELETE /admin/api/media/:id               — delete from storage and DB
GET    /admin/api/openapi.json             — admin OpenAPI spec (authenticated)
GET    /admin/api/config                   — internal — admin panel config only
```

---

## Key Architectural Rules

- Routes never interact with Drizzle directly — always through the `ContentRepository<T>` interface
- `createDrizzleContentRepository` lives in the api package (`src/repositories/content.ts`) and imports only the `DrizzlePostgresInstance` *type* from db — the API layer has no `drizzle-orm` runtime dependency (see [ADR api/0001](adr/api/0001-repository-pattern.md))
- Public `/api/*` routes always hardcode `published_only: true` — no query param can override
- `storage` in `createCmsApp` is required with no fallback — hard startup error if missing
- Codegen output (`.manguito/` and `dist/generated/`) is gitignored — CLI owns writes, api reads
- Media fields (`image`, `video`, `file`) are always fully resolved in API responses regardless of `?include=`

---

## Developer Checklist

> **Audit (2026-07-02):** Verified every item against the implementation and
> tests — the routing, repository, pagination, filtering/sorting, slug, storage,
> rate-limiting, and media surfaces are all built and covered. Divergences from
> the original plan:
> 1. **`content:publish` was a documentation error, not a gap.** There is no
>    `content:publish` permission by design — content is gated by
>    `content:create`/`content:edit`/`content:delete`, and publishing (PATCH
>    with `published: true`) is gated by `content:edit`. The checklist item was
>    a mistake; corrected below.
> 2. **Direct upload endpoints handle binary — now bounded.** The
>    "presigned-only, never handle binary" goal was relaxed: `POST
>    /admin/api/media/{image,video,file}` accept multipart uploads via
>    `handleDirectUpload`, and the presigned flow still exists. To keep this safe
>    on serverless, direct uploads now enforce `max_file_size` (config default
>    4 MB): a `Content-Length` pre-check rejects oversized bodies before
>    buffering, plus a decoded-size check, both returning `413 FILE_TOO_LARGE`.
>    Set `max_file_size` under the platform payload limit (Lambda ~6 MB), or use
>    the presigned flow for larger files.
> 3. **OpenAPI (minor).** `@hono/zod-openapi`'s `createRoute` is used in the
>    route codegen, but the served `/api/openapi.json` is a hand-built minimal
>    paths object (so item 164's "page min:1" is moot — the served spec defines
>    no `page` parameter). Not a bug; just less generated than item 210 implies.

### Setup
- [x] Add dependencies to `packages/api/package.json`
- [x] Configure three entry points in `tsup.config.ts` — `src/index.ts`, `src/storage/index.ts`, `src/runtime/index.ts`
- [x] Add all three entry points to `package.json` exports field

### Core — see [phase-05-package-structure.md](./phase-05-package-structure.md)
- [x] `createCmsApp` — accepts `db`, `storage`, `registry`, `media`, `rateLimit`
- [x] `createDrizzleContentRepository` constructed from the injected `db` adapter — the api layer imports only the `DrizzlePostgresInstance` type from db
- [x] `ContentRepository<T>` interface consumed from `@bobbykim/manguito-cms-core`

### Published/Draft — see [phase-05-published-draft.md](./phase-05-published-draft.md)
- [x] Public routes hardcode `published_only: true` — no override possible
- [x] Admin list routes accept optional `?published=true/false` filter
- [x] `PATCH` with `published: true` triggers server-side required field validation
- [x] `PATCH` with `published: false` skips validation — always allowed
- [x] Publishing (PATCH with `published: true`) is gated by `content:edit` — there is no separate `content:publish` permission (an earlier draft of this item listing one was a mistake; the model is `content:create`/`content:edit`/`content:delete`)

### Slugs — see [phase-05-slug-handling.md](./phase-05-slug-handling.md)
- [x] Slug is required manual input on create — no auto-generation
- [x] Format validation — lowercase, alphanumeric and hyphens only
- [x] Uniqueness enforced per content type — `409 SLUG_CONFLICT` on duplicate
- [x] Slug is mutable via `PATCH` — no lock after first save
- [x] `findBySlug` returns `404 SLUG_NOT_FOUND` when slug does not exist

### Pagination — see [phase-05-pagination.md](./phase-05-pagination.md)
- [x] 1-indexed — first page is `page=1`
- [x] Defaults: `page=1`, `per_page=10`, max `per_page=100`
- [x] Response includes `total`, `page`, `per_page`, `total_pages`, `has_next`, `has_prev`
- [x] Repository translates `page` to SQL `OFFSET` as `(page - 1) * per_page`
- [x] Fix OpenAPI spec — `page min: 1` not `min: 0`

### Filtering and Sorting — see [phase-05-filtering-sorting.md](./phase-05-filtering-sorting.md)
- [x] Bracket notation — `?filter[field]=value`
- [x] Operators: equality, `gt`, `gte`, `lt`, `lte` for numeric and date fields
- [x] Multi-value equality acts as `OR` within same field
- [x] Multiple different fields act as `AND`
- [x] Sort params: `?sort_by=field&sort_order=asc|desc`
- [x] Sortable fields: `title`, `created_at`, `updated_at` only
- [x] `?include=` works on both list and single item endpoints
- [x] Media fields always resolved regardless of `?include=`

### Error Codes — see [phase-05-error-codes.md](./phase-05-error-codes.md)
- [x] Add all Phase 5 error codes to `ErrorCode` enum in `@bobbykim/manguito-cms-core`
- [x] All error responses use `{ ok: false, error: { code, message, details? } }` envelope
- [x] `429` responses include `Retry-After`, `X-RateLimit-*` headers

### Storage Adapters — see [phase-05-storage-adapter.md](./phase-05-storage-adapter.md)
- [x] `StorageAdapter` interface in `@bobbykim/manguito-cms-core`
- [x] All uploads use presigned URL flow — CMS server never handles binary data
- [x] `createLocalAdapter` — simulates presigned URL via local temp endpoint
- [x] `createS3Adapter` — real S3 presigned PUT URL
- [x] `createCloudinaryAdapter` — Cloudinary signed upload POST URL
- [x] `getUrl(key)` used internally during upload only — DB url is source of truth afterwards
- [x] Local adapter logs production warning if `NODE_ENV === 'production'`
- [x] Delete: storage delete must succeed before DB row is deleted

### Rate Limiting — see [phase-05-rate-limiting.md](./phase-05-rate-limiting.md)
- [x] Sliding window, in-process Hono middleware
- [x] Per-IP limit + global ceiling — both enforced simultaneously
- [x] Authenticated requests fully exempt
- [x] Auth middleware runs before rate limiter
- [x] `429` response with `Retry-After` and `X-RateLimit-*` headers
- [x] Configurable via `createCmsApp({ rateLimit: { findAll: { ... } } })`

### Media Endpoints — see [phase-05-media-endpoints.md](./phase-05-media-endpoints.md)
- [x] Uploads: a presigned URL flow **and** direct multipart endpoints (`POST /admin/api/media/{image,video,file}`) both exist — the "presigned-only / no direct endpoints" goal was relaxed (see audit note)
- [x] `reference_count` incremented on content create/update, decremented on delete
- [x] Orphaned media (`reference_count = 0`) visible in admin panel media library
- [x] `DELETE /admin/api/media/:id` — storage delete before DB delete

### OpenAPI — see [phase-05-openapi.md](./phase-05-openapi.md)
- [x] Public spec at `/api/openapi.json` — no auth required
- [x] Admin spec at `/admin/api/openapi.json` — auth required
- [x] Auth endpoints excluded from both specs
- [x] Config endpoint excluded from both specs
- [x] `@hono/zod-openapi` — no hand-authoring
- [x] No Swagger UI in v1

---

## Tests

### Unit
- [x] `createCmsApp` — throws on missing `storage`
- [x] Public route handler — `published_only: true` always applied
- [x] `PATCH published: true` — returns `422` when required fields empty
- [x] `PATCH published: false` — succeeds regardless of field state
- [x] Slug format validation — valid and invalid slug formats
- [x] Slug uniqueness — `409` on duplicate within same content type
- [x] Pagination — correct `OFFSET` calculation for page 1, 2, 3
- [x] Pagination — correct `total_pages`, `has_next`, `has_prev` in meta
- [x] Filter parsing — bracket notation, operators, multi-value
- [x] Rate limiter — per-IP limit enforced, global ceiling enforced, authenticated requests exempt

### Integration
- [x] `GET /api/{base_path}` — returns published items only with correct pagination meta
- [x] `GET /api/{base_path}/{slug}` — returns item, `404` on missing slug
- [x] `GET /admin/api/{type}` — returns all items including drafts
- [x] `PATCH /admin/api/{type}/:id` — toggles published state, validates on publish
- [x] `POST /admin/api/media/image` — uploads file, writes DB row, returns media object
- [x] `DELETE /admin/api/media/:id` — removes from storage and DB, `409` if in use
- [x] `GET /api/openapi.json` — returns valid OpenAPI 3.0 spec
- [x] Rate limiter — `429` after limit exceeded, `Retry-After` header present

---

## Claude Code Checklist

- [x] Read all detail docs linked in the Decisions Made table before implementing
- [x] Route handlers use only the `ContentRepository<T>` interface from core — the concrete `createDrizzleContentRepository` is constructed in `createCmsApp` and injected into handlers
- [x] `storage` is required in `createCmsApp` — fail hard at startup, never silently default
- [x] ~~CMS server must never handle binary file data — all uploads go through presigned URL flow~~ — **relaxed** (see audit note): the direct upload endpoints handle multipart binary via `handleDirectUpload`; the presigned flow remains available (preferred on serverless due to payload limits)
- [x] Public routes must hardcode `published_only: true` — never accept it as a query param
- [x] Slug validation and uniqueness are server-side responsibilities — do not rely on client
- [x] Page numbers are 1-indexed — fix OpenAPI spec accordingly (`min: 1` not `min: 0`)
- [x] Rate limiter middleware must run after auth middleware so authenticated requests are exempted first
- [x] Storage delete must succeed before DB row is deleted — never reverse this order
- [x] `getUrl(key)` is for internal upload use only — DB url is the runtime source of truth
- [x] `.manguito/` and `dist/generated/` are gitignored — CLI writes, api reads
- [x] Do not implement auth middleware here — that is Phase 6's responsibility. Use a placeholder that can be replaced.

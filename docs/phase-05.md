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
Phase 3 — DrizzleContentRepository, PostgresAdapter
Phase 4 — scanMigrationFiles (used by CLI, not API)

Phase 5 — adds:
  createAPIAdapter()         ← wires db + storage + routes into Hono app
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
├── app.ts                      ← createAPIAdapter
├── routes/
│   ├── content.ts              ← public content routes
│   ├── media.ts                ← public media routes
│   └── admin/
│       ├── content.ts          ← admin content routes
│       └── media.ts            ← admin media routes
├── repositories/
│   ├── content.ts              ← wraps DrizzleContentRepository
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
@bobbykim/manguito-cms-api            ← createAPIAdapter
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

- Routes never interact with Drizzle directly — always through `ContentRepository<T>` interface
- `DrizzleContentRepository` is injected at startup — the api package has no direct Drizzle dependency
- Public `/api/*` routes always hardcode `published_only: true` — no query param can override
- `storage` in `createAPIAdapter` is required with no fallback — hard startup error if missing
- Codegen output (`.manguito/` and `dist/generated/`) is gitignored — CLI owns writes, api reads
- Media fields (`image`, `video`, `file`) are always fully resolved in API responses regardless of `?include=`

---

## Developer Checklist

### Setup
- [ ] Add dependencies to `packages/api/package.json`
- [ ] Configure three entry points in `tsup.config.ts` — `src/index.ts`, `src/storage/index.ts`, `src/runtime/index.ts`
- [ ] Add all three entry points to `package.json` exports field

### Core — see [phase-05-package-structure.md](./phase-05-package-structure.md)
- [ ] `createAPIAdapter` — accepts `db`, `storage`, `registry`, `config`, `rateLimit`
- [ ] `DrizzleContentRepository` injected via db adapter — api never imports from db directly
- [ ] `ContentRepository<T>` interface consumed from `@bobbykim/manguito-cms-core`

### Published/Draft — see [phase-05-published-draft.md](./phase-05-published-draft.md)
- [ ] Public routes hardcode `published_only: true` — no override possible
- [ ] Admin list routes accept optional `?published=true/false` filter
- [ ] `PATCH` with `published: true` triggers server-side required field validation
- [ ] `PATCH` with `published: false` skips validation — always allowed
- [ ] `content:publish` is a distinct permission check from `content:update`

### Slugs — see [phase-05-slug-handling.md](./phase-05-slug-handling.md)
- [ ] Slug is required manual input on create — no auto-generation
- [ ] Format validation — lowercase, alphanumeric and hyphens only
- [ ] Uniqueness enforced per content type — `409 SLUG_CONFLICT` on duplicate
- [ ] Slug is mutable via `PATCH` — no lock after first save
- [ ] `findBySlug` returns `404 SLUG_NOT_FOUND` when slug does not exist

### Pagination — see [phase-05-pagination.md](./phase-05-pagination.md)
- [ ] 1-indexed — first page is `page=1`
- [ ] Defaults: `page=1`, `per_page=10`, max `per_page=100`
- [ ] Response includes `total`, `page`, `per_page`, `total_pages`, `has_next`, `has_prev`
- [ ] Repository translates `page` to SQL `OFFSET` as `(page - 1) * per_page`
- [ ] Fix OpenAPI spec — `page min: 1` not `min: 0`

### Filtering and Sorting — see [phase-05-filtering-sorting.md](./phase-05-filtering-sorting.md)
- [ ] Bracket notation — `?filter[field]=value`
- [ ] Operators: equality, `gt`, `gte`, `lt`, `lte` for numeric and date fields
- [ ] Multi-value equality acts as `OR` within same field
- [ ] Multiple different fields act as `AND`
- [ ] Sort params: `?sort_by=field&sort_order=asc|desc`
- [ ] Sortable fields: `title`, `created_at`, `updated_at` only
- [ ] `?include=` works on both list and single item endpoints
- [ ] Media fields always resolved regardless of `?include=`

### Error Codes — see [phase-05-error-codes.md](./phase-05-error-codes.md)
- [ ] Add all Phase 5 error codes to `ErrorCode` enum in `@bobbykim/manguito-cms-core`
- [ ] All error responses use `{ ok: false, error: { code, message, details? } }` envelope
- [ ] `429` responses include `Retry-After`, `X-RateLimit-*` headers

### Storage Adapters — see [phase-05-storage-adapter.md](./phase-05-storage-adapter.md)
- [ ] `StorageAdapter` interface in `@bobbykim/manguito-cms-core`
- [ ] All uploads use presigned URL flow — CMS server never handles binary data
- [ ] `createLocalAdapter` — simulates presigned URL via local temp endpoint
- [ ] `createS3Adapter` — real S3 presigned PUT URL
- [ ] `createCloudinaryAdapter` — Cloudinary signed upload POST URL
- [ ] `getUrl(key)` used internally during upload only — DB url is source of truth afterwards
- [ ] Local adapter logs production warning if `NODE_ENV === 'production'`
- [ ] Delete: storage delete must succeed before DB row is deleted

### Rate Limiting — see [phase-05-rate-limiting.md](./phase-05-rate-limiting.md)
- [ ] Sliding window, in-process Hono middleware
- [ ] Per-IP limit + global ceiling — both enforced simultaneously
- [ ] Authenticated requests fully exempt
- [ ] Auth middleware runs before rate limiter
- [ ] `429` response with `Retry-After` and `X-RateLimit-*` headers
- [ ] Configurable via `createAPIAdapter({ rateLimit: { findAll: { ... } } })`

### Media Endpoints — see [phase-05-media-endpoints.md](./phase-05-media-endpoints.md)
- [ ] All uploads use presigned URL flow — no direct upload endpoints
- [ ] `reference_count` incremented on content create/update, decremented on delete
- [ ] Orphaned media (`reference_count = 0`) visible in admin panel media library
- [ ] `DELETE /admin/api/media/:id` — storage delete before DB delete

### OpenAPI — see [phase-05-openapi.md](./phase-05-openapi.md)
- [ ] Public spec at `/api/openapi.json` — no auth required
- [ ] Admin spec at `/admin/api/openapi.json` — auth required
- [ ] Auth endpoints excluded from both specs
- [ ] Config endpoint excluded from both specs
- [ ] `@hono/zod-openapi` — no hand-authoring
- [ ] No Swagger UI in v1

---

## Tests

### Unit
- [ ] `createAPIAdapter` — throws on missing `storage`
- [ ] Public route handler — `published_only: true` always applied
- [ ] `PATCH published: true` — returns `422` when required fields empty
- [ ] `PATCH published: false` — succeeds regardless of field state
- [ ] Slug format validation — valid and invalid slug formats
- [ ] Slug uniqueness — `409` on duplicate within same content type
- [ ] Pagination — correct `OFFSET` calculation for page 1, 2, 3
- [ ] Pagination — correct `total_pages`, `has_next`, `has_prev` in meta
- [ ] Filter parsing — bracket notation, operators, multi-value
- [ ] Rate limiter — per-IP limit enforced, global ceiling enforced, authenticated requests exempt

### Integration
- [ ] `GET /api/{base_path}` — returns published items only with correct pagination meta
- [ ] `GET /api/{base_path}/{slug}` — returns item, `404` on missing slug
- [ ] `GET /admin/api/{type}` — returns all items including drafts
- [ ] `PATCH /admin/api/{type}/:id` — toggles published state, validates on publish
- [ ] `POST /admin/api/media/image` — uploads file, writes DB row, returns media object
- [ ] `DELETE /admin/api/media/:id` — removes from storage and DB, `409` if in use
- [ ] `GET /api/openapi.json` — returns valid OpenAPI 3.0 spec
- [ ] Rate limiter — `429` after limit exceeded, `Retry-After` header present

---

## Claude Code Checklist

- [ ] Read all detail docs linked in the Decisions Made table before implementing
- [ ] The api package must not import `DrizzleContentRepository` directly — only `ContentRepository<T>` from core
- [ ] `storage` is required in `createAPIAdapter` — fail hard at startup, never silently default
- [ ] CMS server must never handle binary file data — all uploads go through presigned URL flow
- [ ] Public routes must hardcode `published_only: true` — never accept it as a query param
- [ ] Slug validation and uniqueness are server-side responsibilities — do not rely on client
- [ ] Page numbers are 1-indexed — fix OpenAPI spec accordingly (`min: 1` not `min: 0`)
- [ ] Rate limiter middleware must run after auth middleware so authenticated requests are exempted first
- [ ] Storage delete must succeed before DB row is deleted — never reverse this order
- [ ] `getUrl(key)` is for internal upload use only — DB url is the runtime source of truth
- [ ] `.manguito/` and `dist/generated/` are gitignored — CLI writes, api reads
- [ ] Do not implement auth middleware here — that is Phase 6's responsibility. Use a placeholder that can be replaced.

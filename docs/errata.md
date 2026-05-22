# Documentation Errata

Cross-phase documentation audit performed 2026-05-21. Lists all known inconsistencies between decision docs, their resolution status, and — where the fix touches code — a discussion note.

---

## Status key

| Status | Meaning |
|--------|---------|
| ✅ Fixed | Doc-only error; the relevant doc has been corrected |
| 🔵 Benign | Apparent conflict that is actually two different layers; no fix needed |
| 🟡 Needs discussion | Requires a code change or new implementation decision |

---

## ✅ 1 — `content:publish` and `content:update` do not exist

**Documents affected:** `docs/decisions/phase-05/phase-05-published-draft.md`

**Conflict:** The Permission section introduced `content:publish` as a distinct permission and used `content:update` in its code example. Neither permission exists.

**Authority:** `docs/decisions/phase-02/phase-02-roles-and-auth-design.md` defines `PermissionAction = 'read' | 'create' | 'edit' | 'delete'` — the only four actions. `docs/phase-08.md` explicitly names this doc as the authority and calls out the Phase 5 error.

**Resolution:** `phase-05-published-draft.md` Permission section corrected — the description and code example now use `content:edit`. The erroneous two-permission design has been removed.

---

## ✅ 2 — OpenAPI example: `page min: 0` should be `min: 1`

**Documents affected:** `docs/decisions/phase-05/phase-05-openapi.md`

**Conflict:** The Generated Route Shape Example showed `page: z.coerce.number().int().min(0).default(0)`.

**Authority:** `docs/decisions/phase-05/phase-05-pagination.md` explicitly corrects this — minimum page is `1`, not `0`.

**Resolution:** `phase-05-openapi.md` example updated to `min(1).default(1)`. Code already used the correct value.

---

## ✅ 3 — Generated form file extension: `.ts` should be `.vue`

**Documents affected:** `docs/decisions/phase-08/phase-08-admin-panel.md`

**Conflict:** The `.manguito/forms/` directory listing showed `content--blog_post.ts` and `content--home_page.ts`.

**Authority:** `docs/decisions/phase-08/phase-08-codegen.md` consistently uses `.vue` — the generated files are Vue SFCs with `<script setup>` and `<template>` blocks.

**Resolution:** `phase-08-admin-panel.md` updated to `.vue` extensions.

---

## ✅ 4 — `manguito createsuperuser` prompts for `Username` which does not exist in the User model

**Documents affected:** `docs/decisions/phase-09/phase-09-createsuperuser.md`

**Conflict:** The interactive flow and validation table included a `Username` field. The `User` model has no `username` column — only `email`.

**Authority:** `docs/decisions/phase-02/phase-02-roles-and-auth-design.md` and `docs/decisions/phase-06/phase-06-package-boundaries.md` both define `User` without `username`. The `users` table schema in code confirms this.

**Resolution:** `phase-09-createsuperuser.md` updated — `Username` prompt and validation row removed; flow now prompts `Email` and `Password` only.

---

## ✅ 5 — `UiComponent.component = 'checkbox'` → `BooleanToggle.vue` mapping never documented

**Documents affected:** `docs/decisions/phase-08/phase-08-admin-panel.md`

**Conflict:** `phase-02-parser-output.md` defines `{ component: 'checkbox' }` as the UiComponent for boolean fields. `phase-08-admin-panel.md` lists the Vue component file as `BooleanToggle.vue`. The mapping between the parser key and the component filename was never written down, leaving an implicit gap.

**Resolution:** A mapping note added to the Field Component Map section of `phase-08-admin-panel.md`. The mapping lives explicitly in `codegen/form-generator.ts` (`COMPONENT_NAME` constant) but is now also documented.

---

## ✅ 6 — `StorageAdapter.upload()` removed from interface and all adapters

**Documents affected:** `docs/decisions/phase-02/phase-02-defineconfig.md`, `docs/decisions/phase-05/phase-05-storage-adapter.md`

**Conflict:** Phase 2 included `upload(file, options): Promise<UploadResult>` in the `StorageAdapter` interface. Phase 5 reversed this: "all uploads use the presigned URL flow exclusively — the CMS server never handles binary file data." The interface in `packages/core/src/config/types.ts` retained `upload()` from Phase 2, but the API routes never call it.

**Resolution:** `upload()` confirmed unused — all three adapter implementations threw immediately. Removed from `StorageAdapter` interface in `packages/core/src/config/types.ts`, removed from `packages/core/src/index.ts` exports, removed from all three adapter files, and deleted the dead `packages/api/src/storage/types.ts` duplicate. All uploads use the presigned URL flow exclusively, matching `phase-05-storage-adapter.md`.

---

## ✅ 7 — Rate limiting scope narrowed to list endpoints

**Documents affected:** `docs/decisions/phase-05/phase-05-rate-limiting.md`

**Conflict:** The doc says rate limiting applies to the bulk `findAll` endpoint only. `packages/api/src/app.ts` applies the middleware to all `/api/*` routes.

**Resolution:** Blanket `app.use('/api/*', ...)` removed. Rate limiter is now threaded as an optional `listRateLimit` parameter into `registerPublicContentRoutes` and `registerPublicMediaRoutes`, applied only to paginated collection routes (`GET /api/{base_path}` for `only_one: false` types, `GET /api/taxonomy/{type}`, `GET /api/media`, and the new `GET /api/content` and `GET /api/taxonomy` meta-endpoints). Single-item lookups are unthrottled. The `rateLimit.findAll` config key naming now accurately reflects the scope.

---

## ✅ 8 — `GET /admin/api/config` extended with `user` and `media` fields

**Documents affected:** `docs/decisions/phase-06/phase-06-config-schema-endpoints.md`, `docs/decisions/phase-08/phase-08-api-client.md`

**Conflict:** Phase 6 defines the config response as `{ cms_name, version, roles }`. Phase 8 defines `ConfigResponse` as `{ cms_name, version, roles, user, media }` — the admin panel uses `user` to bootstrap auth state and `media.max_file_size` for the upload size cap. The API only returns the Phase 6 shape; `user` and `media` are never sent.

**Resolution:** Config endpoint extended per `phase-08-api-client.md`. The handler now queries the DB for the acting user's `email` and `must_change_password`, and accepts an optional `max_file_size` from `CreateAPIAdapterOptions.media`. The `media` key is omitted from the response when not configured. `phase-06-config-schema-endpoints.md` should be updated separately to document the extended shape.

---

## ✅ 9 — `GET /api/content`, `GET /api/taxonomy`, `GET /admin/api/content`, `GET /admin/api/taxonomy` implemented

**Documents affected:** `docs/decisions/phase-05/phase-05-route-generation.md`, `docs/decisions/phase-08/phase-08-admin-panel.md`

**Conflict:** Both docs reference `GET /api/content` (list available content types) and `GET /api/taxonomy` (list available taxonomy types) as navigation data sources. Neither endpoint exists in the API. The admin panel's schema store uses `GET /admin/api/schema` instead.

**Resolution:** All four endpoints implemented. Public `GET /api/content` and `GET /api/taxonomy` return schema metadata (name, label, only_one) with no DB access, registered in `registerPublicContentRoutes` before the dynamic per-type routes. Admin `GET /admin/api/content` and `GET /admin/api/taxonomy` return the same metadata plus a live item count per type via `COUNT(*)`, registered in `registerSchemaRoute` behind auth middleware.

---

## 🔵 10 — Default page size: API default 10 vs admin default 50

**Documents affected:** `docs/decisions/phase-05/phase-05-pagination.md`, `docs/decisions/phase-08/phase-08-admin-panel.md`

**Apparent conflict:** Phase 5 sets the API's server-side default at `per_page=10`. Phase 8 sets the admin panel's requested page size at 50.

**Resolution:** Not a conflict — these are different layers. The API default applies only when no `per_page` parameter is sent. The admin panel always sends an explicit `per_page=50`. Both are correct; the docs describe different defaults at different layers. No fix needed.

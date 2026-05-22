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

## 🟡 6 — `StorageAdapter.upload()` is in the interface but never used

**Documents affected:** `docs/decisions/phase-02/phase-02-defineconfig.md`, `docs/decisions/phase-05/phase-05-storage-adapter.md`

**Conflict:** Phase 2 included `upload(file, options): Promise<UploadResult>` in the `StorageAdapter` interface. Phase 5 reversed this: "all uploads use the presigned URL flow exclusively — the CMS server never handles binary file data." The interface in `packages/core/src/config/types.ts` retained `upload()` from Phase 2, but the API routes never call it.

**Decision needed:** Remove `upload()` from the interface entirely (breaking change for any adapter implementations), or document it as intentionally reserved for direct-upload environments (not the default Neon/Lambda setup). See Phase 5 storage adapter doc for context.

---

## 🟡 7 — Rate limiting scope: `findAll` only (doc) vs all `/api/*` (code)

**Documents affected:** `docs/decisions/phase-05/phase-05-rate-limiting.md`

**Conflict:** The doc says rate limiting applies to the bulk `findAll` endpoint only. `packages/api/src/app.ts` applies the middleware to all `/api/*` routes.

**Decision needed:** Was the broader scope intentional? If yes, update the doc. If the doc is correct, refactor the middleware registration to be path-specific.

---

## 🟡 8 — `GET /admin/api/config` missing `user` and `media` fields

**Documents affected:** `docs/decisions/phase-06/phase-06-config-schema-endpoints.md`, `docs/decisions/phase-08/phase-08-api-client.md`

**Conflict:** Phase 6 defines the config response as `{ cms_name, version, roles }`. Phase 8 defines `ConfigResponse` as `{ cms_name, version, roles, user, media }` — the admin panel uses `user` to bootstrap auth state and `media.max_file_size` for the upload size cap. The API only returns the Phase 6 shape; `user` and `media` are never sent.

**Decision needed:** Extend the config endpoint to include `user` (current authenticated user) and `media` (global media settings), or define a separate bootstrap mechanism. The admin panel's `must_change_password` redirect and upload size cap cannot work correctly until this is resolved.

---

## 🟡 9 — `GET /api/content` and `GET /api/taxonomy` meta-endpoints are documented but not implemented

**Documents affected:** `docs/decisions/phase-05/phase-05-route-generation.md`, `docs/decisions/phase-08/phase-08-admin-panel.md`

**Conflict:** Both docs reference `GET /api/content` (list available content types) and `GET /api/taxonomy` (list available taxonomy types) as navigation data sources. Neither endpoint exists in the API. The admin panel's schema store uses `GET /admin/api/schema` instead.

**Decision needed:** Implement the documented endpoints, or remove the references and confirm `GET /admin/api/schema` is the single source for navigation generation. If removed, update `phase-05-route-generation.md` and the navigation section of `phase-08-admin-panel.md`.

---

## 🔵 10 — Default page size: API default 10 vs admin default 50

**Documents affected:** `docs/decisions/phase-05/phase-05-pagination.md`, `docs/decisions/phase-08/phase-08-admin-panel.md`

**Apparent conflict:** Phase 5 sets the API's server-side default at `per_page=10`. Phase 8 sets the admin panel's requested page size at 50.

**Resolution:** Not a conflict — these are different layers. The API default applies only when no `per_page` parameter is sent. The admin panel always sends an explicit `per_page=50`. Both are correct; the docs describe different defaults at different layers. No fix needed.

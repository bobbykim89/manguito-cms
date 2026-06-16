# Decision — Config and Schema Endpoints

> GET /admin/api/config and GET /admin/api/schema — purpose, response shape, and access rules.

---

## Access Rules

Both endpoints sit behind `authMiddleware` only. No `requirePermission` is needed — every authenticated user regardless of role needs these endpoints to initialize the admin panel. Both are excluded from the OpenAPI spec (internal use only).

---

## GET /admin/api/config

Returns CMS metadata and roles filtered by the acting user's hierarchy level. Used by the admin panel to bootstrap its UI state on load.

**Response shape:**
```json
{
  "ok": true,
  "data": {
    "cms_name": "My Blog CMS",
    "version": "1.0.0",
    "roles": [
      { "name": "editor",  "label": "Editor",  "hierarchy_level": 2 },
      { "name": "writer",  "label": "Writer",  "hierarchy_level": 3 },
      { "name": "viewer",  "label": "Viewer",  "hierarchy_level": 4 }
    ]
  }
}
```

**`cms_name`** — sourced from the `name` field in `manguito.config.ts`. This is a new optional field added to `ManguitoConfig`:

```ts
// manguito.config.ts
export default defineConfig({
  name: 'My Blog CMS',   // optional — defaults to 'Manguito CMS'
  db: createPostgresAdapter(),
  // ...
})
```

Default value: `'Manguito CMS'`. Existing configs without `name` are unaffected.

**`version`** — sourced internally from the package's own `package.json`. Not user-configurable.

**`roles`** — filtered by acting user's `hierarchy_level`. The response only includes roles with `hierarchy_level` strictly greater than the acting user's level — i.e. roles the acting user is allowed to assign. Admins see all roles below admin. Managers see editor, writer, viewer. The `admin` role is never included in this list regardless of who is asking.

**Sanitization — what is never returned:**
- Storage adapter type or config
- DB connection string or config
- `AUTH_SECRET` or any environment variable values
- Server adapter type or deployment config
- Any internal configuration details

---

## GET /admin/api/schema

Returns the full schema definitions derived from `ParsedSchema`. Used by the admin panel to render dynamic content forms without hardcoding field structures.

**Response shape:**
```json
{
  "ok": true,
  "data": {
    "content_types": [
      {
        "name": "blog-post",
        "label": "Blog Post",
        "only_one": false,
        "fields": [
          { "name": "title", "type": "text/plain", "required": true, "label": "Title" },
          { "name": "body",  "type": "text/rich",  "required": true, "label": "Body" }
        ]
      }
    ],
    "taxonomy_types": [...],
    "paragraph_types": [...],
    "enum_types": [...]
  }
}
```

Field names, types, labels, and validation rules are all safe to expose — nothing in the schema definitions is sensitive. This endpoint gives the admin panel everything it needs to build forms, validate inputs, and display field labels correctly.

**No filtering by role** — all authenticated users see the full schema. Permissions govern what they can do with the data, not whether they can see the structure.

# Phase 2 — Schema Parser, Field Type Registry, and defineConfig

> Core schema format, parser output shape, field type registry, and the defineConfig contract.

This phase produces the foundational application logic that every subsequent phase depends on. The schema parser is the single source of truth from which the DB, API, and admin panel are all derived. Getting this right is worth the time — every downstream module depends on the contracts established here.

**Done when:** The schema parser correctly validates and normalises all four schema types into a typed `ParsedSchema` registry. `defineConfig` resolves a fully typed config object with defaults applied. The field type registry maps every supported field type to its DB column definition, API serialization shape, and admin UI component hint. All unit tests pass.

---

## Decisions Made

### Schema Format

See full detail: [phase-02-schema-format.md](./decisions/phase-02/phase-02-schema-format.md)

Four schema types are supported, each with a mandatory naming convention:

| Schema type | File prefix | Example |
| ----------- | ----------- | ------- |
| `content-type` | `content--` | `content--blog_post.json` |
| `paragraph-type` | `paragraph--` | `paragraph--photo_card.json` |
| `taxonomy-type` | `taxonomy--` | `taxonomy--daily_post.json` |
| `enum-type` | `enum--` | `enum--link_target.json` |

All machine names follow `[type]--[name_with_underscores]` format. All JSON field names use snake_case throughout.

Schema files live under a configurable base path (default `./schemas`) in type-specific subdirectories. A dedicated `routes.json` at the base path root defines valid base paths for content types.

---

### Parser Output Shape

See full detail: [phase-02-parser-output.md](./decisions/phase-02/phase-02-parser-output.md)

The parser produces a flat `SchemaRegistry` — a plain serializable object keyed by machine name. Every cross-reference is stored as a name string only, never inlined. Consumers resolve references by looking up the registry.

```ts
type SchemaRegistry = {
  routes: ParsedRoutes
  roles: ParsedRoles
  schemas: Record<string, ParsedSchema>
  content_types: Record<string, ParsedContentType>
  paragraph_types: Record<string, ParsedParagraphType>
  taxonomy_types: Record<string, ParsedTaxonomyType>
  enum_types: Record<string, ParsedEnumType>
}
```

Parser output is always serializable plain objects — no class instances, no functions. This allows the registry to be written to `dist/generated/schema.ts` at build time and re-imported with no overhead at runtime.

---

### Field Type Registry

The field type registry is the architectural keystone. Every supported field type registers three things simultaneously:

- A `DbColumn` definition (used by DB codegen in Phase 3)
- A `FieldValidation` shape (used by API layer in Phase 5)
- A `UiComponent` hint (used by admin panel in Phase 8)

All three are always in sync because they derive from the same registry entry. The registry lives in `@bobbykim/manguito-cms-core` and has no dependencies on `db`, `api`, or `admin`.

Supported field types in v1:

| Type | DB storage | Admin UI component |
| ---- | ---------- | ------------------ |
| `text/plain` | varchar | Text input |
| `text/rich` | text | Rich text editor (Tiptap) |
| `integer` | integer | Number input |
| `float` | decimal | Number input |
| `boolean` | boolean | Toggle |
| `date` | timestamp | Date picker |
| `image` | FK → media | Media modal |
| `video` | FK → media | Media modal |
| `file` | FK → media | Media modal |
| `enum` | varchar + check | Select |
| `paragraph` | polymorphic parent ref | Paragraph embed |
| `reference` | FK or junction table | Typeahead select |

---

### defineConfig Shape

See full detail: [phase-02-defineconfig.md](./decisions/phase-02/phase-02-defineconfig.md)

`defineConfig` is the single file users write to configure the entire system. Every section has sensible defaults — a minimal working config requires only `db`, `storage`, `server`, `api`, and `admin`.

```ts
export default defineConfig({
  schema: {                          // fully optional
    base_path: './schemas',
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
      roles: 'roles',
    }
  },
  db: createPostgresAdapter(),       // required
  migrations: {                      // optional — omit for non-relational DBs
    table: '__manguito_migrations',
    folder: './migrations',
  },
  storage: createLocalAdapter(),     // required
  server: createServer({ port: 3000 }), // required
  api: createAPIAdapter({            // required
    prefix: '/api',
    media: { max_file_size: 4 * 1024 * 1024 }
  }),
  admin: createAdminAdapter({        // required
    prefix: '/admin',
  }),
})
```

All adapter factory functions follow the same pattern — options are optional with sensible defaults, credentials default to environment variables.

---

### Roles and Permissions

See full detail: [phase-02-roles-and-auth-design.md](./decisions/phase-02/phase-02-roles-and-auth-design.md)

Roles are defined in `schemas/roles/roles.json` and parsed into `ParsedRoles`. They are schema-defined only — no runtime role creation through the admin panel. Five default system roles ship with every project:

| Role | Hierarchy level | Notable permissions |
| ---- | --------------- | ------------------- |
| `admin` | 0 | All permissions including `users:*` and `roles:read` |
| `manager` | 1 | All except `users:delete` and role management |
| `editor` | 2 | Content, media, taxonomy read/write |
| `writer` | 3 | Content and media create/edit, taxonomy read |
| `viewer` | 4 | Read only |

Each user has exactly one role. Admin promotion and demotion is CLI-only. At least one admin must exist at all times.

---

## Architecture Notes

### Layer Boundaries

The parser (`core`) has no knowledge of how its output is consumed. It produces plain data. Each consuming package reads only its relevant section:

```
SchemaRegistry
    ├── DB codegen reads → fields[].db_column, system_fields, db meta
    ├── API layer reads  → fields[].validation, api meta, routes
    └── Admin panel reads → fields[].ui_component, ui.tabs, field order
```

### Dev vs Build Mode

**Dev mode (`manguito dev`):**
- Schemas parsed dynamically at startup
- Output written to `.manguito/` folder (gitignored)
- File watcher triggers incremental re-parse on schema change
- `drizzle-kit push` applied automatically on schema change

**Production (`manguito build`):**
- Schemas compiled to static artifacts in `dist/generated/`
- Runtime imports pre-built code — no parse overhead
- Migration files generated for review before applying

### Serialization Requirement

Parser output must be serializable plain objects at all times. This is enforced by:
- No class instances in output types
- No functions in output types
- All enum references resolved to inline values before output
- Cross-references stored as name strings only

---

## Packages Involved

| Package | Role in this phase |
| ------- | ------------------ |
| `@bobbykim/manguito-cms-core` | Schema parser, field type registry, `defineConfig` |
| `@bobbykim/manguito-cms-db` | `createPostgresAdapter` factory (interface defined in core) |
| `@bobbykim/manguito-cms-api` | `createLocalAdapter`, `createS3Adapter`, `createCloudinaryAdapter`, `createServer`, `createLambdaHandler`, `createVercelHandler`, `createAPIAdapter` |
| `@bobbykim/manguito-cms-admin` | `createAdminAdapter` |

---

## Checklist

**Schema parser**

- [ ] Implement Zod validators for all four schema types
- [ ] Implement JSON and YAML file loader
- [ ] Implement schema directory walker respecting config folder names
- [ ] Parse and validate `routes.json`
- [ ] Parse and validate `roles/roles.json`
- [ ] Implement system field injection per schema type
- [ ] Implement tab stripping — produce flat fields array alongside UiMeta tabs
- [ ] Implement enum reference resolution — inline standalone enum values
- [ ] Implement cross-reference validation — unknown refs produce parse errors
- [ ] Implement circular reference detection for paragraph nesting
- [ ] Implement `only_one` validation — slug handling per mode
- [ ] Implement `default_base_path` validation against `routes.json`
- [ ] Produce `ParseResult` — `{ ok: true, schema }` or `{ ok: false, errors }`
- [ ] Produce `SchemaRegistry` from all parsed schemas

**Field type registry**

- [ ] Define `DbColumn` type in core
- [ ] Define `FieldValidation` type in core
- [ ] Define `UiComponent` type in core
- [ ] Implement registry entry per field type
- [ ] Validate `max_size` string normalization to bytes
- [ ] Validate field-level `max_size` does not exceed global config limit

**defineConfig**

- [ ] Implement `defineConfig` function with default resolution
- [ ] Implement `resolveSchemaConfig` with folder defaults
- [ ] Implement `resolveMigrationsConfig` — returns null for non-relational adapters
- [ ] Define `DbAdapter` interface in core
- [ ] Define `StorageAdapter` interface in core
- [ ] Define `ServerAdapter` interface in core
- [ ] Implement `createPostgresAdapter` in `manguito-cms-db`
- [ ] Implement `createLocalAdapter` in `manguito-cms-api`
- [ ] Implement `createS3Adapter` in `manguito-cms-api`
- [ ] Implement `createCloudinaryAdapter` in `manguito-cms-api`
- [ ] Implement `createServer` in `manguito-cms-api`
- [ ] Implement `createLambdaHandler` in `manguito-cms-api`
- [ ] Implement `createVercelHandler` in `manguito-cms-api`
- [ ] Implement `createAPIAdapter` in `manguito-cms-api`
- [ ] Implement `createAdminAdapter` in `manguito-cms-admin`

**Roles parser**

- [ ] Implement Zod validator for `roles.json`
- [ ] Validate no duplicate `hierarchy_level` values
- [ ] Validate no unknown permission strings
- [ ] Produce `ParsedRoles` with roles sorted by `hierarchy_level`
- [ ] Add `ParsedRoles` to `SchemaRegistry`

**Tests**

- [ ] Unit tests for schema parser — valid schemas for all four types
- [ ] Unit tests for parser error cases — all `ParseErrorCode` values
- [ ] Unit tests for field type registry — every field type
- [ ] Unit tests for `defineConfig` — default resolution, partial overrides
- [ ] Unit tests for roles parser — valid roles, duplicate hierarchy, unknown permissions
- [ ] Integration test — full parse of a realistic schema directory

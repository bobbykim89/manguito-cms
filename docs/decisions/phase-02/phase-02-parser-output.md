# Decision — Parser Output Shape

> Defines the TypeScript types produced by the schema parser and consumed by DB codegen, API route generation, and admin panel form generation.

---

## Core Principles

**Serializable plain objects only.** Parser output contains no class instances and no functions. This allows the registry to be written to `dist/generated/schema.ts` at build time and re-imported cleanly at runtime with zero overhead.

**Reference by name, never inline.** Cross-references between schemas are stored as machine name strings only. Consumers resolve references by looking up the registry. This prevents duplication and eliminates circular resolution risks.

**One registry, three consumers.** A single `SchemaRegistry` serves DB codegen, API route generation, and admin panel form generation. Each consumer reads only its relevant section. The registry is the single source of truth.

**Flat fields, separate UI structure.** The `fields` array is always flat — tab wrappers from the schema file are stripped. Tab structure is preserved separately in `UiMeta` for the admin panel only. DB and API consumers never see tabs.

---

## ParseResult

The parser returns a `ParseResult` per schema file — never throws for expected failures:

```ts
type ParseResult =
  | { ok: true; schema: ParsedSchema }
  | { ok: false; errors: ParseError[] }

type ParseError = {
  file: string          // "schemas/content-types/content--blog_post.json"
  code: ParseErrorCode  // machine-readable — see schema format decision
  message: string       // human-readable description
  path?: string         // "fields[2].max_size" — location within the schema file
}
```

The `path` field pinpoints exactly where in the schema file the error is. This powers the `manguito validate` CLI command with precise, actionable error messages.

---

## SchemaRegistry

The top-level output produced from all schema files in the project:

```ts
type SchemaRegistry = {
  routes: ParsedRoutes
  roles: ParsedRoles
  schemas: Record<string, ParsedSchema>         // all schemas keyed by machine name
  content_types: Record<string, ParsedContentType>
  paragraph_types: Record<string, ParsedParagraphType>
  taxonomy_types: Record<string, ParsedTaxonomyType>
  enum_types: Record<string, ParsedEnumType>
}
```

Convenience lookup maps (`content_types`, `paragraph_types`, etc.) are derived from `schemas` and saved for fast consumer access — DB codegen iterates `content_types`, API layer iterates `content_types` and `taxonomy_types`, admin panel uses the full registry.

---

## ParsedSchema Union

```ts
type ParsedSchema =
  | ParsedContentType
  | ParsedParagraphType
  | ParsedTaxonomyType
  | ParsedEnumType

type ParsedSchemaBase = {
  schema_type: "content-type" | "paragraph-type" | "taxonomy-type" | "enum-type"
  name: string          // "content--blog_post"
  label: string         // "Blog Post"
  source_file: string   // "schemas/content-types/content--blog_post.json"
}
```

---

## ParsedContentType

```ts
type ParsedContentType = ParsedSchemaBase & {
  schema_type: "content-type"
  only_one: boolean
  default_base_path: string       // validated against routes.json
  system_fields: SystemField[]
  fields: ParsedField[]           // flat — tabs stripped
  ui: UiMeta                      // tabs preserved here for admin panel only
  db: ContentDbMeta
  api: ContentApiMeta
}
```

---

## ParsedParagraphType

```ts
type ParsedParagraphType = ParsedSchemaBase & {
  schema_type: "paragraph-type"
  system_fields: SystemField[]
  fields: ParsedField[]           // flat, no tabs
  db: ParagraphDbMeta
  // no api section — paragraphs are never standalone API endpoints
  // no ui.tabs — paragraphs use flat field layout
}
```

---

## ParsedTaxonomyType

```ts
type ParsedTaxonomyType = ParsedSchemaBase & {
  schema_type: "taxonomy-type"
  system_fields: SystemField[]
  fields: ParsedField[]
  db: TaxonomyDbMeta
  api: TaxonomyApiMeta
}
```

---

## ParsedEnumType

```ts
type ParsedEnumType = ParsedSchemaBase & {
  schema_type: "enum-type"
  values: string[]      // ["_self", "_blank"]
  // no fields, no db, no api — enums are validation-only
}
```

---

## SystemField

Auto-injected fields that authors never write in schema files:

```ts
type SystemField = {
  name: string
  db_type: "uuid" | "timestamp" | "varchar" | "boolean" | "integer"
  primary_key?: boolean
  default?: string      // "gen_random_uuid()", "now()", "false"
  nullable: boolean
}
```

**Content type system fields:**
```ts
[
  { name: "id", db_type: "uuid", primary_key: true, default: "gen_random_uuid()", nullable: false },
  { name: "slug", db_type: "varchar", nullable: false },
  { name: "base_path_id", db_type: "uuid", nullable: false },
  { name: "published", db_type: "boolean", default: "false", nullable: false },
  { name: "created_at", db_type: "timestamp", default: "now()", nullable: false },
  { name: "updated_at", db_type: "timestamp", default: "now()", nullable: false },
]
```

**Paragraph type system fields:**
```ts
[
  { name: "id", db_type: "uuid", primary_key: true, default: "gen_random_uuid()", nullable: false },
  { name: "parent_id", db_type: "uuid", nullable: false },
  { name: "parent_type", db_type: "varchar", nullable: false },
  { name: "parent_field", db_type: "varchar", nullable: false },
  { name: "order", db_type: "integer", default: "0", nullable: false },
  { name: "created_at", db_type: "timestamp", default: "now()", nullable: false },
  { name: "updated_at", db_type: "timestamp", default: "now()", nullable: false },
]
```

**Taxonomy type system fields:**
```ts
[
  { name: "id", db_type: "uuid", primary_key: true, default: "gen_random_uuid()", nullable: false },
  { name: "published", db_type: "boolean", default: "false", nullable: false },
  { name: "created_at", db_type: "timestamp", default: "now()", nullable: false },
  { name: "updated_at", db_type: "timestamp", default: "now()", nullable: false },
]
```

---

## ParsedField

The core field output shape. Every consumer reads from this:

```ts
type ParsedField = {
  name: string
  label: string
  field_type: FieldType
  required: boolean
  nullable: boolean         // derived from required
  order: number             // position in schema array, preserved
  validation: FieldValidation
  db_column: DbColumn
  ui_component: UiComponent
}
```

### FieldValidation

```ts
type FieldValidation = {
  required: boolean
  min?: number              // integer, float
  max?: number              // integer, float
  limit?: number            // text/plain max character count
  max_size?: number         // image/video/file — normalized to bytes
  pattern?: string          // regex string — admin panel input validation only
  max_items?: number        // paragraph, reference
  allowed_values?: string[] // enum — always resolved inline, never a ref
  allowed_mime_types?: string[] // image/video/file
}
```

### DbColumn

```ts
type DbColumn = {
  column_name: string
  column_type: DbColumnType
  nullable: boolean
  check_constraint?: string[]   // enum allowed values
  foreign_key?: {
    table: string
    column: string
    on_delete: "CASCADE" | "SET NULL" | "RESTRICT"
  }
  junction?: {                  // many-to-many reference fields only
    table_name: string
    left_column: string
    right_column: string
    right_table: string
    order_column: boolean
  }
}

type DbColumnType =
  | "uuid"
  | "varchar"
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "timestamp"
```

### UiComponent

```ts
type UiComponent =
  | { component: "text-input" }
  | { component: "rich-text-editor" }
  | { component: "number-input"; step: number }
  | { component: "checkbox" }
  | { component: "date-picker" }
  | { component: "file-upload"; accepted_mime_types: string[] }
  | { component: "select"; options: string[] }
  | { component: "typeahead-select"; ref: string; rel: RelationType }
  | { component: "paragraph-embed"; ref: string; rel: RelationType; max?: number }

type RelationType = "one-to-one" | "one-to-many" | "many-to-many"
```

`typeahead-select` is used for `reference` fields (content type and taxonomy references).
`paragraph-embed` is used for `paragraph` fields — renders an inline form array directly in the parent content form.

---

## UiMeta

Preserved tab structure for the admin panel. Only content types have tabs:

```ts
type UiMeta = {
  tabs: UiTab[]
}

type UiTab = {
  name: string
  label: string
  fields: string[]    // ordered list of field names — not full field objects
}
```

Tabs store field names only. The admin panel looks up the full field from the flat `fields` array by name. No duplication between `fields` and `ui.tabs`.

---

## ContentDbMeta

```ts
type ContentDbMeta = {
  table_name: string              // "content_blog_post"
  junction_tables: JunctionTable[] // only for many-to-many reference fields
}

type JunctionTable = {
  table_name: string    // "junction_content_blog_post_blog_related"
  left_column: string   // "left_id"
  right_column: string  // "right_id"
  right_table: string   // "content_blog_post"
  order_column: boolean
}
```

Junction tables are only created for `many-to-many` reference fields. Paragraph relations use the polymorphic parent approach (no junction tables). One-to-one and one-to-many reference fields use a FK column on the content table itself.

---

## ParagraphDbMeta

```ts
type ParagraphDbMeta = {
  table_name: string              // "paragraph_photo_card"
  // parent reference columns are in system_fields — not repeated here
}
```

Each paragraph type gets exactly one DB table regardless of how many content types reference it. The polymorphic `parent_id` + `parent_type` + `parent_field` system columns handle the association.

---

## TaxonomyDbMeta

```ts
type TaxonomyDbMeta = {
  table_name: string              // "taxonomy_daily_post"
}
```

---

## ContentApiMeta

```ts
type ContentApiMeta = {
  default_base_path: string       // "blog" — seeds DB on first run
  http_methods: HttpMethod[]
  // only_one: true  → ["GET", "PUT", "PATCH"]
  // only_one: false → ["GET", "POST", "PUT", "PATCH", "DELETE"]
  collection_path?: string        // "/api/blog-post" — only_one: false only
  item_path: string               // "/api/blog-post/:slug" or "/api/tuition/cost-calculator"
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
```

Paths are resolved at parse time from `default_base_path` and the content type machine name. Since `base_path` is runtime-editable, these are default paths only — the actual runtime path is resolved from the DB at request time.

---

## TaxonomyApiMeta

```ts
type TaxonomyApiMeta = {
  collection_path: string         // "/api/taxonomy/daily-post"
  item_path: string               // "/api/taxonomy/daily-post/:id"
}
```

---

## ParsedRoutes

```ts
type ParsedRoutes = {
  base_paths: ParsedBasePath[]
}

type ParsedBasePath = {
  name: string      // "blog"
  path: string      // "/blog-post"
}
```

---

## Field Type → DbColumn Mapping

| Field type | `column_type` | Notes |
| ---------- | ------------- | ----- |
| `text/plain` | `varchar` | |
| `text/rich` | `text` | Stored as sanitized HTML |
| `integer` | `integer` | |
| `float` | `decimal` | |
| `boolean` | `boolean` | |
| `date` | `timestamp` | |
| `image` | `uuid` | FK → `media.id`, SET NULL on delete |
| `video` | `uuid` | FK → `media.id`, SET NULL on delete |
| `file` | `uuid` | FK → `media.id`, SET NULL on delete |
| `enum` | `varchar` | `check_constraint` contains allowed values |
| `paragraph` one-to-one | — | No column on content table — stored on paragraph table via `parent_id` |
| `paragraph` one-to-many | — | No column on content table — stored on paragraph table via `parent_id` |
| `reference` one-to-one | `uuid` | FK column on content table, SET NULL on delete |
| `reference` one-to-many | `uuid` | FK column on content table, SET NULL on delete |
| `reference` many-to-many | — | No column — junction table handles association |

---

## Field Type → UiComponent Mapping

| Field type | `component` | Notes |
| ---------- | ----------- | ----- |
| `text/plain` | `text-input` | |
| `text/rich` | `rich-text-editor` | Tiptap |
| `integer` | `number-input` | `step: 1` |
| `float` | `number-input` | `step: 0.01` |
| `boolean` | `checkbox` | |
| `date` | `date-picker` | |
| `image` | `file-upload` | `accepted_mime_types: ["image/*"]` |
| `video` | `file-upload` | `accepted_mime_types: ["video/*"]` |
| `file` | `file-upload` | `accepted_mime_types: ["application/pdf"]` |
| `enum` | `select` | `options` populated from resolved `allowed_values` |
| `paragraph` | `paragraph-embed` | Inline sortable form array |
| `reference` | `typeahead-select` | Search and select existing entities |

---

## System Tables

System tables are not derived from schema files. They are created automatically by the DB module on first run.

| Table | Purpose |
| ----- | ------- |
| `media` | All uploaded files — images, videos, PDFs |
| `base_paths` | Valid base paths seeded from `routes.json` |
| `roles` | Roles seeded from `roles.json` |
| `users` | User accounts |

**MediaType:**
```ts
type MediaType = {
  id: string
  url: string
  mime_type: string
  alt?: string
  file_size: number       // bytes
  width?: number          // images and video
  height?: number         // images and video
  duration?: number       // video only, seconds
  reference_count: number // incremented/decremented on content create/delete
  created_at: Date
  updated_at: Date
}
```

`reference_count` tracks how many content items reference this media item. When it reaches 0 the media is considered orphaned and can be reviewed for deletion in the admin panel.

---

## dist/generated/ Output

`manguito build` writes the registry to static files:

```
dist/generated/
├── schema.ts       ← SchemaRegistry export
├── routes.ts       ← Hono route registrations
├── repositories.ts ← Repository instances per content/taxonomy type
└── forms.ts        ← Vue form component definitions
```

```ts
// dist/generated/schema.ts — example shape
export const registry: SchemaRegistry = {
  routes: { base_paths: [...] },
  roles: { roles: [...], valid_permissions: [...] },
  schemas: {
    "content--blog_post": { ... },
    "paragraph--photo_card": { ... },
    "taxonomy--daily_post": { ... },
    "enum--link_target": { ... },
  },
  content_types: { "content--blog_post": { ... } },
  paragraph_types: { "paragraph--photo_card": { ... } },
  taxonomy_types: { "taxonomy--daily_post": { ... } },
  enum_types: { "enum--link_target": { ... } },
}
```

In dev mode the same output is written to `.manguito/` instead, updated incrementally on schema file changes.

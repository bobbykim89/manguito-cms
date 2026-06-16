# Decision — Schema Format

> Defines the structure, naming conventions, and field types for all schema files authored by developers.

---

## Naming Conventions

All machine names follow the format `[type]--[name_with_underscores]`:

| Schema type | Prefix | Example |
| ----------- | ------ | ------- |
| Content type | `content--` | `content--blog_post` |
| Paragraph type | `paragraph--` | `paragraph--photo_card` |
| Taxonomy type | `taxonomy--` | `taxonomy--daily_post` |
| Enum type | `enum--` | `enum--link_target` |

The double-dash separator is unambiguous — single underscores are used within the name segment so `--` reliably splits type prefix from name. The parser can determine schema type from the machine name alone without reading the file.

All JSON field names within schema files use **snake_case** throughout — no camelCase, no kebab-case.

---

## Directory Structure

Schema files live under a configurable base path (default `./schemas`). Subdirectory names are configurable with the following defaults:

```
schemas/
├── routes.json                  ← fixed filename, not configurable
├── content-types/               ← default folder name, configurable
│   └── content--blog_post.json
├── paragraph-types/
│   └── paragraph--photo_card.json
├── taxonomy-types/
│   └── taxonomy--daily_post.json
├── enum-types/
│   └── enum--link_target.json
└── roles/
    └── roles.json
```

`routes.json` is always at the base path root with a fixed filename. It is created automatically by `manguito init` and defines the valid base paths for content types.

The parser validates that each file found in a folder matches the expected schema type — a `paragraph-type` schema found inside `content-types/` is an immediate parse error.

---

## routes.json

Defines the valid base paths that content types can reference:

```json
{
  "base_paths": [
    { "name": "root", "path": "/" },
    { "name": "blog", "path": "/blog-post" },
    { "name": "tuition", "path": "/tuition" }
  ]
}
```

---

## Schema Types

### Content Type

```json
{
  "name": "content--blog_post",
  "label": "Blog Post",
  "type": "content-type",
  "default_base_path": "blog",
  "only_one": false,
  "fields": [
    {
      "tab": {
        "name": "primary_tab",
        "label": "Primary",
        "fields": [
          {
            "name": "blog_title",
            "label": "Title",
            "type": "text/plain",
            "required": true
          },
          {
            "name": "blog_hero_image",
            "label": "Hero Image",
            "type": "image",
            "max_size": "2MB",
            "alt": true,
            "required": false
          },
          {
            "name": "blog_desc",
            "label": "Description",
            "type": "text/rich",
            "required": true
          }
        ]
      }
    },
    {
      "tab": {
        "name": "relations_tab",
        "label": "Relations",
        "fields": [
          {
            "name": "blog_cards",
            "label": "Cards",
            "type": "paragraph",
            "ref": "paragraph--photo_card",
            "rel": "one-to-many",
            "max": 8,
            "required": false
          },
          {
            "name": "blog_category",
            "label": "Category",
            "type": "reference",
            "target": "taxonomy--daily_post",
            "rel": "one-to-one",
            "required": false
          },
          {
            "name": "blog_related",
            "label": "Related Posts",
            "type": "reference",
            "target": "content--blog_post",
            "rel": "many-to-many",
            "max": 10,
            "required": false
          }
        ]
      }
    },
    {
      "tab": {
        "name": "meta_tab",
        "label": "Meta",
        "fields": [
          {
            "name": "blog_meta_title",
            "label": "Meta Title",
            "type": "text/plain",
            "required": true
          },
          {
            "name": "blog_meta_desc",
            "label": "Meta Description",
            "type": "text/plain",
            "required": true
          }
        ]
      }
    }
  ]
}
```

**Top-level fields:**

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | Yes | Machine name — `content--[name]` |
| `label` | Yes | Human-readable label for admin panel |
| `type` | Yes | Always `"content-type"` |
| `default_base_path` | Yes | References a name in `routes.json` — validated at parse time |
| `only_one` | Yes | `true` = singleton page, `false` = many items with slugs |
| `fields` | Yes | Array of tab objects |

**`only_one` behavior:**

| `only_one` | API route | Admin behavior | Slug |
| ---------- | --------- | -------------- | ---- |
| `true` | `/api/[base_path]/[content-name]` | Single edit form, no list | Fixed, derived from content type name at route level |
| `false` | `/api/[base_path]/:slug` | List view + create/edit/delete | Per-item, user-editable in admin panel |

Slug is always a runtime value stored in the DB — never defined in the schema file. This allows content type renaming/versioning without redeployment (e.g. `content--financial_aid_v2` can serve the same slug as `content--financial_aid` after unpublishing the old version).

`default_base_path` is also runtime-editable in the admin panel. The schema value seeds the initial DB value only.

**Tab structure:**

Tabs are purely cosmetic — they organize fields in the admin panel only. The parser strips tab wrappers when producing the flat `fields` array. The tab structure is preserved separately in `UiMeta` for the admin panel to consume.

Paragraph and taxonomy schema types use flat `fields` arrays — no tabs. Tabs are content type only.

---

### Paragraph Type

```json
{
  "name": "paragraph--photo_card",
  "label": "Photo Card",
  "type": "paragraph-type",
  "fields": [
    {
      "name": "photo_card_title",
      "label": "Title",
      "type": "text/plain",
      "required": true
    },
    {
      "name": "photo_card_image",
      "label": "Image",
      "type": "image",
      "max_size": "512KB",
      "alt": true,
      "required": true
    },
    {
      "name": "photo_card_text",
      "label": "Text",
      "type": "text/rich",
      "required": false
    },
    {
      "name": "photo_card_link",
      "label": "Link",
      "type": "paragraph",
      "ref": "paragraph--link_item",
      "rel": "one-to-one",
      "required": false
    }
  ]
}
```

Paragraph types are reusable field groups owned by a parent content type. They are never exposed as standalone API endpoints. They cascade-delete with their parent.

**Nesting rule:** Paragraphs support **one level of nesting** — a paragraph may reference another paragraph, but that nested paragraph may not reference yet another paragraph. This prevents circular references and keeps the parser and API resolution logic tractable.

**Allowed `ref` targets for paragraph fields inside a paragraph:**
- `paragraph-type` only
- Not `content-type` or `taxonomy-type`

**Auto-injected system fields:** `id` (UUID PK), `created_at`, `updated_at`, `parent_id`, `parent_type`, `parent_field`, `order`

The `parent_id`, `parent_type`, and `parent_field` columns implement a polymorphic parent association — one paragraph table can be owned by multiple different content types without separate tables per content type.

---

### Taxonomy Type

```json
{
  "name": "taxonomy--daily_post",
  "label": "Daily Post",
  "type": "taxonomy-type",
  "fields": [
    {
      "name": "daily_title",
      "label": "Title",
      "type": "text/plain",
      "required": true
    },
    {
      "name": "daily_desc",
      "label": "Description",
      "type": "text/rich",
      "required": false
    }
  ]
}
```

Taxonomy types are flat vocabularies used for categorizing and querying content. Custom fields are optional — a taxonomy with no custom fields is valid and defaults to just the system fields.

**Auto-injected system fields:** `id` (UUID PK), `created_at`, `updated_at`, `published`

---

### Enum Type

Two variants — standalone (reusable) and inline (one-off):

**Standalone enum schema file:**
```json
{
  "name": "enum--link_target",
  "label": "Link Target",
  "type": "enum-type",
  "values": ["_self", "_blank"]
}
```

**Referencing a standalone enum in a field:**
```json
{
  "name": "link_target",
  "label": "Target",
  "type": "enum",
  "ref": "enum--link_target",
  "required": true
}
```

**Inline enum (defined directly on a field, no separate file):**
```json
{
  "name": "status",
  "label": "Status",
  "type": "enum",
  "values": ["draft", "review", "approved"],
  "required": true
}
```

The parser normalizes both variants into the same output shape — `allowed_values` is always an inlined string array in the parser output. Consumers never see a reference to an enum schema.

---

## Auto-Injected System Fields

| Field | Content | Paragraph | Taxonomy |
| ----- | ------- | --------- | -------- |
| `id` (UUID PK) | ✓ | ✓ | ✓ |
| `created_at` | ✓ | ✓ | ✓ |
| `updated_at` | ✓ | ✓ | ✓ |
| `slug` | ✓ | — | — |
| `base_path_id` | ✓ | — | — |
| `published` | ✓ | — | ✓ |
| `parent_id` | — | ✓ | — |
| `parent_type` | — | ✓ | — |
| `parent_field` | — | ✓ | — |
| `order` | — | ✓ | — |

System fields are injected by the parser. Authors never write them in schema files.

---

## Field Types

### Primitive Fields

| Type | DB storage | Options |
| ---- | ---------- | ------- |
| `text/plain` | varchar | `limit` (max length), `pattern` (regex) |
| `text/rich` | text | none — stored as sanitized HTML |
| `integer` | integer | `min`, `max` |
| `float` | decimal | `min`, `max` |
| `boolean` | boolean | none |
| `date` | timestamp | none |

### Media Fields

| Type | Accepted mime types | Options |
| ---- | ------------------- | ------- |
| `image` | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml` | `max_size`, `alt` |
| `video` | `video/mp4`, `video/webm`, `video/quicktime` | `max_size`, `alt` |
| `file` | `application/pdf` | `max_size`, `alt` |

All media fields store a FK to the shared `media` table. The `media` table is system-managed — not derived from any schema file.

`max_size` values in schema files are human-readable strings (`"512KB"`, `"2MB"`). The parser normalizes these to bytes in the output.

`alt: true` indicates the field should display an alt text input. For images this is displayed inline after upload. For video and PDF it is required at upload time.

### Relation Fields

**`paragraph` field:**

```json
{
  "name": "blog_cards",
  "label": "Cards",
  "type": "paragraph",
  "ref": "paragraph--photo_card",
  "rel": "one-to-many",
  "max": 8,
  "required": false
}
```

| Property | Required | Description |
| -------- | -------- | ----------- |
| `ref` | Yes | Machine name of a `paragraph-type` schema |
| `rel` | Yes | `"one-to-one"` or `"one-to-many"` |
| `max` | No | Maximum number of instances |
| `required` | Yes | Whether at least one instance is required |

Paragraphs are owned by the parent. Deleting the parent cascades to all paragraph instances.

**`reference` field:**

```json
{
  "name": "blog_related",
  "label": "Related Posts",
  "type": "reference",
  "target": "content--blog_post",
  "rel": "many-to-many",
  "max": 10,
  "required": false
}
```

| Property | Required | Description |
| -------- | -------- | ----------- |
| `target` | Yes | Machine name of a `content-type` or `taxonomy-type` schema |
| `rel` | Yes | `"one-to-one"`, `"one-to-many"`, or `"many-to-many"` |
| `max` | No | Maximum number of referenced items |
| `required` | Yes | Whether at least one reference is required |

References are independent. Deleting a referenced entity sets the FK to NULL — it does not cascade.

### Enum Field

```json
{
  "name": "link_target",
  "label": "Target",
  "type": "enum",
  "ref": "enum--link_target",
  "required": true
}
```

Either `ref` (standalone enum) or `values` (inline enum) must be present. Both normalize to `allowed_values` in parser output.

---

## Field-Level Properties Reference

| Property | Applies to | Description |
| -------- | ---------- | ----------- |
| `name` | all | Machine name, snake_case |
| `label` | all | Human-readable label for admin panel |
| `type` | all | Field type string |
| `required` | all | Whether field is nullable |
| `limit` | `text/plain` | Maximum character count |
| `pattern` | `text/plain` | Regex validation string — admin panel input validation only |
| `min` | `integer`, `float` | Minimum value |
| `max` | `integer`, `float` | Maximum value |
| `max_size` | `image`, `video`, `file` | Maximum file size — human-readable string, normalized to bytes |
| `alt` | `image`, `video`, `file` | Whether to show alt text input |
| `values` | inline `enum` | Array of allowed values |
| `ref` | `enum` (standalone), `paragraph` | Machine name of referenced schema |
| `target` | `reference` | Machine name of referenced content or taxonomy type |
| `rel` | `paragraph`, `reference` | Relationship type |
| `max` | `paragraph`, `reference` | Maximum number of items |

---

## Relation Storage Summary

| Relation type | DB storage mechanism | Delete behavior |
| ------------- | -------------------- | --------------- |
| `paragraph` one-to-one | `parent_id` + `parent_type` + `parent_field` on paragraph table | CASCADE |
| `paragraph` one-to-many | same + `order` column | CASCADE |
| `reference` one-to-one | FK column on content table | SET NULL |
| `reference` one-to-many | FK column on content table | SET NULL |
| `reference` many-to-many | Junction table | Row deleted from junction |

---

## Parse Error Codes

| Code | Condition |
| ---- | --------- |
| `INVALID_SCHEMA_TYPE` | `type` field is not a known schema type |
| `INVALID_FIELD_TYPE` | `type` on a field is not a known field type |
| `UNKNOWN_BASE_PATH` | `default_base_path` not found in `routes.json` |
| `UNKNOWN_REF` | `ref` or `target` points to a non-existent schema |
| `INVALID_REF_TARGET` | e.g. paragraph referencing a content type |
| `DUPLICATE_FIELD_NAME` | Two fields in the same schema share a name |
| `DUPLICATE_SCHEMA_NAME` | Two schema files share the same machine name |
| `INVALID_MACHINE_NAME` | Machine name does not match `[type]--[name]` convention |
| `CIRCULAR_REFERENCE` | Paragraph A references paragraph B which references paragraph A |
| `MISSING_REQUIRED_FIELD` | A required top-level field is absent |
| `MAX_SIZE_EXCEEDS_GLOBAL_LIMIT` | Field `max_size` exceeds the global `media.max_file_size` in config |
| `SCHEMA_DIR_NOT_FOUND` | `base_path` directory does not exist |
| `SCHEMA_FOLDER_NOT_FOUND` | A configured subfolder does not exist |
| `DUPLICATE_SCHEMA_FOLDER` | Two folder config values resolve to the same path |
| `ROUTES_FILE_NOT_FOUND` | `routes.json` missing from base path root |

# Schema authoring guide

The schema is the source of truth for Manguito CMS. Content types, paragraph
types, taxonomy types, and enum types are all defined as JSON documents on
disk; the parser (`@bobbykim/manguito-cms-core`) reads them, validates them,
and generates the database schema, REST API routes, and admin panel forms
from them. There is no separate "modeling" step in a database GUI — the
schema files *are* the model.

Schema documents live under four fixed folders inside `schema.base_path`
(configured in `manguito.config.ts` — see
[`configuration.md`](./configuration.md#schema)):

```
schemas/
├── content-types/
├── paragraph-types/
├── taxonomy-types/
└── enum-types/
```

Each folder holds one JSON file per document. Two more fixed files —
`roles.json` and `routes.json` — sit directly under `base_path`, not in a
folder (see [Roles](#roles) and [Public routes](#public-routes) below).

## Schema document types

Every schema document has a `type` field with one of four literal values:
`content-type`, `paragraph-type`, `taxonomy-type`, `enum-type`. The `type`
value must match the folder the file lives in.

Every document also has a `name`, which is a **machine name** prefixed by its
document type, followed by `--` and a `snake_case` identifier:

| Document type | Prefix | Example |
| --- | --- | --- |
| `content-type` | `content--` | `content--blog_post` |
| `paragraph-type` | `paragraph--` | `paragraph--photo_card` |
| `taxonomy-type` | `taxonomy--` | `taxonomy--daily_post` |
| `enum-type` | `enum--` | `enum--link_target` |

### The tab-vs-flat rule

This is the single most important structural fact about schema documents,
and it differs by document type:

- **Content types wrap their fields in `tab`s.** The top-level `fields` array
  is an array of `{ "tab": { "name", "label", "fields": [...] } }` wrapper
  objects, **not** an array of fields directly. At least one tab is
  required. Tabs are cosmetic groupings shown in the admin panel form — the
  parser strips them to produce a flat field list internally.
- **Paragraph types and taxonomy types use a flat `fields[]` array.** No
  tabs — each entry in `fields` is a field definition directly. An empty
  `fields` array is valid (system fields like `id` are always injected) —
  note this only applies to this top-level `fields[]`; a content-type
  *tab's* internal `fields` array still requires at least one field.
- **Enum types have no `fields` at all.** They have a `values[]` array of
  strings instead.

A content-type document that is *not* wrapped in tabs (e.g. a flat
`{ "name": "...", "fields": { ... } }` object, or a top-level fields array
without `tab` wrappers) is invalid and will fail schema validation.

Content-type example (tabs **required**):

```json
{
  "name": "content--blog_post",
  "label": "Blog Post",
  "type": "content-type",
  "default_base_path": "posts",
  "only_one": false,
  "fields": [
    { "tab": { "name": "content", "label": "Content", "fields": [
      { "name": "blog_title", "label": "Title", "type": "text/plain", "required": true },
      { "name": "blog_body", "label": "Body", "type": "text/rich", "required": true }
    ] } }
  ]
}
```

Content types also carry two additional required properties beyond `name`,
`label`, `type`, `fields`: `default_base_path` (the default public route
this content type is served under — see [Public routes](#public-routes)) and
`only_one` (whether this content type is a singleton, e.g. a site-settings
page, rather than a collection of entries).

Taxonomy-type example (flat `fields[]`, no tabs):

```json
{
  "name": "taxonomy--tag",
  "label": "Tag",
  "type": "taxonomy-type",
  "fields": [
    { "name": "tag_name", "label": "Name", "type": "text/plain", "required": true },
    { "name": "tag_slug", "label": "Slug", "type": "text/plain", "required": true }
  ]
}
```

Paragraph-type example (flat `fields[]`, no tabs — same shape as
taxonomy-type):

```json
{
  "name": "paragraph--photo_card",
  "label": "Photo Card",
  "type": "paragraph-type",
  "fields": [
    { "name": "photo_image", "label": "Image", "type": "image", "required": true },
    { "name": "photo_caption", "label": "Caption", "type": "text/plain", "required": false }
  ]
}
```

Enum-type example (no `fields`, just `values[]`):

```json
{ "name": "enum--link_target", "label": "Link Target", "type": "enum-type", "values": ["self", "blank"] }
```

## Field types

Every field — regardless of document type — has three properties in common:
`name` (`snake_case`), `label`, and `required` (boolean). Beyond that, each
field's `type` determines which extra options it accepts:

| Type | Extra options | Notes |
| --- | --- | --- |
| `text/plain` | `limit?`, `pattern?` | Single-line text |
| `text/rich` | — | Rich text |
| `integer` | `min?`, `max?` | Integer value bounds |
| `float` | `min?`, `max?` | Float value bounds |
| `boolean` | — | True/false |
| `date` | — | Date |
| `image` | `max_size?`, `alt?` | Media upload |
| `video` | `max_size?`, `alt?` | Media upload |
| `file` | `max_size?`, `alt?` | Media upload |
| `enum` | `ref?` XOR `values?` | Exactly one of `ref` (standalone enum) or inline `values[]` |
| `paragraph` | `ref`, `rel` (1:1/1:many), `max?` | Embedded paragraph blocks |
| `reference` | `target`, `rel` (1:1/1:many/m:m), `max?` | Reference to content-type/taxonomy-type |
| `programmatic` | — | Value computed at read time by a resolver — no column. See [programmatic-fields.md](./programmatic-fields.md) |

That's 13 field types in total.

### The `enum` field's XOR rule

An `enum` field must have **either** `ref` **or** `values` — never both,
never neither:

- `ref` points to a standalone `enum-type` document by machine name (e.g.
  `"ref": "enum--link_target"`) — reuse the same enum across multiple
  content types.
- `values` is an inline array of allowed strings defined directly on the
  field, for one-off enumerations that don't warrant a shared `enum-type`
  document.

```json
{ "name": "link_target", "label": "Open In", "type": "enum", "required": false, "ref": "enum--link_target" }
```

```json
{ "name": "status", "label": "Status", "type": "enum", "required": true, "values": ["draft", "published"] }
```

### Programmatic fields

A `programmatic` field has no column and no input — its value is computed at read
time by a resolver function you write in TypeScript. In the schema you only
declare that the field exists (`required` is ignored, since there is nothing to
author):

```json
{ "name": "blog_summary", "label": "Summary", "type": "programmatic" }
```

The resolver itself lives in a separate file and is bound to the field by machine
name. Programmatic fields are supported on content and taxonomy types. See
[`programmatic-fields.md`](./programmatic-fields.md) for the full guide.

## Relationships

Two field types express relationships between schema documents: `paragraph`
and `reference`. Both accept a `rel` (relation cardinality) and an optional
`max` (cap on the number of related items).

There are three relation values in the system: `one-to-one`, `one-to-many`,
`many-to-many`. Support differs by field type:

- **`paragraph`** fields support only `one-to-one` and `one-to-many`.
  `many-to-many` is not valid for paragraphs, because a paragraph is a
  polymorphic child owned by exactly one parent — it can't belong to
  multiple parents at once.
- **`reference`** fields support all three: `one-to-one`, `one-to-many`,
  `many-to-many`. `target` must be the machine name of a `content-type` or
  `taxonomy-type` (not a paragraph-type or enum-type).

```json
{ "name": "body_blocks", "label": "Body Blocks", "type": "paragraph", "required": false, "ref": "paragraph--photo_card", "rel": "one-to-many" }
```

```json
{ "name": "related_tags", "label": "Related Tags", "type": "reference", "required": false, "target": "taxonomy--tag", "rel": "many-to-many" }
```

## Roles

`roles.json` sits at the root of `schema.base_path` and defines the roles
available to users of the admin panel and API. There are five built-in
system roles, each with a fixed `hierarchy_level` (lower number = more
privileged):

| Role | Level | Highlights |
| --- | --- | --- |
| `admin` | 0 | Full permissions incl. `users:*`, `roles:read` |
| `manager` | 1 | Content/media/taxonomy CRUD + `users:read` |
| `editor` | 2 | Content/media/taxonomy CRUD |
| `writer` | 3 | `content:read/create`, `media:read/create` |
| `viewer` | 4 | `content:read`, `media:read` |

All five are `is_system: true`. Custom roles beyond these five are a v2+
item — not currently supported.

`roles.json` shape:

```json
{
  "roles": [
    { "name": "...", "label": "...", "is_system": true, "hierarchy_level": 0, "permissions": ["..."] }
  ]
}
```

Each entry in `roles` has `name`, `label`, `is_system`, `hierarchy_level`,
and `permissions[]`.

## Public routes

`routes.json` sits at the root of `schema.base_path` and defines the valid
public base paths that content types can be served under (referenced by a
content type's `default_base_path`, see [Schema document types](#schema-document-types)
above). Shape:

```json
{
  "base_paths": [
    { "name": "posts", "path": "/posts" }
  ]
}
```

Each entry in `base_paths` has a `name` and a `path` (must start with `/`).

## See also

- [`README.md`](../README.md) — project overview and quick start.
- [`configuration.md`](./configuration.md) — the full config reference:
  `manguito.config.ts` blocks, adapter factories, and environment variables.
- [`programmatic-fields.md`](./programmatic-fields.md) — computed, read-time
  fields backed by TypeScript resolvers.

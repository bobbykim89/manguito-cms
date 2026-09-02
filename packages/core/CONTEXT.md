# Core

The schema kernel of Manguito CMS. It parses developer-authored schema files into a single serializable registry, defines the adapter interfaces the rest of the system implements, and holds the framework-agnostic primitives (config resolution, password hashing) shared across packages. See [docs/adr/core](../../docs/adr/core) for the decisions that shape it.

## Language

### Schema types

**Content type**:
A top-level, independently addressable piece of content with its own API routes (e.g. a blog post). Either a singleton (`only_one: true`) or a collection of slugged items.
_Avoid_: model, entity, document

**Paragraph type**:
A reusable field group owned by a parent content type, embedded inline and never exposed as its own API endpoint. Cascade-deletes with its parent. Nests at most one level deep.
_Avoid_: component, block, fragment

**Taxonomy type**:
A flat vocabulary used to categorize and query content. Has its own API but no slug or base path.
_Avoid_: category, tag, term type

**Enum type**:
A validation-only set of allowed string values. Either standalone (its own file) or inline on a field; both normalize to an inlined `allowed_values` array.
_Avoid_: option set, choice list

### Fields and structure

**Field**:
One typed value on a schema. Authored inside tabs but emitted flat; the type determines its DB column and admin UI component.

**Field type registry**:
The single internal table mapping each field type to its **field builder**. The one place a field type's DB-column, UI-component, and validation behaviour is defined.
_Avoid_: type map, field map, schema for fields

**Field builder**:
A pure function `(raw, ctx) => { validation, db_column, ui_component }` that turns one authored field of a given type into its parsed parts. The parser dispatches to the builder for the field's type rather than branching per type.
_Avoid_: field handler, mapper, transformer

**System field**:
A field auto-injected by the parser (`id`, `created_at`, `slug`, `parent_id`, …). Authors never write these in schema files.
_Avoid_: built-in field, meta field

**Tab**:
A purely cosmetic grouping of fields for the admin panel. Stripped from the flat `fields` array and preserved only in `UiMeta`. Content types only.
_Avoid_: section, group, fieldset

**Machine name**:
A schema's stable identifier in `[type]--[name_with_underscores]` form (e.g. `content--blog_post`). The type prefix is derivable without reading the file.
_Avoid_: slug, id, key

**Registry**:
The single assembled `SchemaRegistry` that is the one source of truth for db, api, and admin. Cross-references are stored as machine-name strings and resolved by lookup.
_Avoid_: catalog, manifest, index

### Versioning

A content field has a public **label** (`ParsedField.name`) and a storage **column** (`db_column.column_name`). They are identical for every schema the parser produces on its own; schema versioning is what lets them diverge, by renaming a label while leaving the column untouched.

**Live version**:
A version currently served — every cut snapshot under `schemas/versions/vN/` plus the current working schema. The current version is always live; its projection is the identity only when no rename applies to it — a `pending.json` rename still in effect between cuts means even the current version's columns diverge from its labels.
_Avoid_: active version, supported version

**Cut**:
Freezing the current schema as a named version. `version:cut` snapshots the schema files into `versions/vN/`, appends `pending.json`'s declarations to `history.json` tagged with `vN`, and clears `pending.json`. The workflow is cut first, then break things.
_Avoid_: tag, release, freeze

**Snapshot**:
A frozen copy of one past version's schema files, stored under `versions/vN/` and never edited after being cut. Read using the current schema's `config.folders`, never hardcoded folder names, so a snapshot cut before a folder rename still loads correctly. Retirement deletes the directory outright — the version's renames still stand in `history.json`, which is never pruned.
_Avoid_: frozen version, archive

**pending.json / history.json**:
The two declaration files — plus one snapshot directory per version for the frozen schema files themselves (see **Snapshot**) — distinguished by who writes them. `pending.json` is hand-written and carries three keys covering changes since the last cut: `renames`, `drops` (see **Declared drop**), and `fallbacks` (see **Fallback**). `history.json` is machine-written by `version:cut`, append-only, and **never pruned** — a field's column is recovered by folding over its renames, so retiring a version must not remove the ones it recorded. A field renamed during a since-retired version's life still needs that entry to resolve its column.
_Avoid_: changes file, changelog

**Declared drop**:
Confirmation, keyed `"<type>.<label>"`, that a field's disappearance was an intentional removal rather than an undeclared rename — the label is the one the `AMBIGUOUS_RENAME` error names. Lives in `pending.json`'s `drops` array before a cut; `version:cut` carries it into `history.json`'s `drops`, each entry there tagged with the version it was cut in.
_Avoid_: deletion, removal flag

**Fallback**:
The value served in place of null for a retained column, declared in `pending.json`'s or `history.json`'s `fallbacks` map and keyed `"<type>.<column_name>"` — by column, not label, because a field that was renamed and later dropped has no single unambiguous label to key by.
_Avoid_: default value, null replacement

**Union registry**:
An ordinary `SchemaRegistry` — not a distinct type — holding every live version's fields merged and keyed by column. Feeds db codegen and drift detection. Differs from a plain merge in two ways: a column the current schema no longer exposes is retained and forced nullable, since rows created after the drop cannot populate it; and a field current still exposes has its `db_column.column_name` corrected to its real column whenever a live or historical rename touches it — current's own label is never assumed to already be the column. Every map on it agrees: `schemas` holds the same objects as `content_types` and `taxonomy_types`, so reading a type either way shows the same folded and retained columns.

Retention has a boundary: it covers columns inside content and taxonomy types that the current schema **still defines**. A type a live version exposes but current deleted is not carried, and paragraph types are passed through untouched — a paragraph type's own column removed from current is not retained, and a declared rename of a paragraph type's own field is a no-op. Whether paragraph tables take part in versioning at all is left to 2b/2e; until then, a project in one of those shapes is refused with `VERSION_RETENTION_UNSUPPORTED` rather than handed a union that silently omits live storage.
_Avoid_: merged registry, combined schema

**Projection**:
What one live version exposes: per type, each column and the label that version exposes it under, plus any fallback. The current version's projection is the identity only when no rename applies — the zero-config case, which is what lets the API layer skip a special case for an unversioned project. A `pending.json` rename still in effect between cuts makes even the current version's projection diverge from identity.
_Avoid_: view, mapping

**Retained column**:
A column present in the union registry but absent from the current schema, kept because an older live version still exposes it under some label. Dropped from the union only when the last version referencing it retires.
_Avoid_: legacy column, orphan column

### Routing and identity

**Base path**:
A named, runtime-editable URL prefix a content type publishes under, seeded from `routes.json`. The schema value is only the initial DB seed.
_Avoid_: route, mount point, prefix

**Slug**:
A per-item, user-editable URL identifier for collection content. Always a runtime DB value, never defined in a schema file.
_Avoid_: permalink, handle

### Permissions

**Role**:
A schema-defined, version-controlled set of permissions with a `hierarchy_level`. Read-only at runtime; never created or edited through the UI.
_Avoid_: group, profile, access level

**Permission**:
A `target:action` string (e.g. `content:edit`). The only valid `roles` permission is `roles:read`.
_Avoid_: grant, scope, capability

**Hierarchy level**:
An integer giving roles a total ordering — lower is higher privilege. Drives the rule that a user may only assign roles strictly below their own.
_Avoid_: rank, tier, priority

### Adapters

**Adapter**:
A factory-produced implementation of a core-defined interface for a swappable concern (db, storage, server, api, admin). Interfaces live in core; implementations live in sibling packages.
_Avoid_: driver, provider, plugin

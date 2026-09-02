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

**Declared column**:
`column` on a field: its storage column, defaulting to `name`. Renaming a field means changing `name` and pinning `column`; the data never moves.
_Avoid_: storage key, db name

**Live version**:
A version currently served — every cut snapshot under `schemas/versions/vN/` plus the current working schema. The current version is always live; its projection is the identity over the union whenever no field declares a `column`.
_Avoid_: active version, supported version

**Cut**:
Freezing the current schema as a named version. `version:cut` copies the schema folders into `versions/vN/` and bumps the current version. There is **no sealing step**: nothing is appended anywhere, because renames and retention live on the fields themselves, not on a record of the cut.
_Avoid_: tag, release, freeze

**Snapshot**:
A frozen copy of one past version's schema files, stored under `versions/vN/` and never edited after being cut. Read using the current schema's `config.folders`, never hardcoded folder names, so a snapshot cut before a folder rename still loads correctly. Retirement deletes the directory outright, and the author deletes the matching tombstones — which `ORPHANED_TOMBSTONE` requires. Nothing is "never pruned" any more.
_Avoid_: frozen version, archive

**Tombstone**:
A field marked `removed: true`. Its column is retained for older live versions and this version does not expose it. Included in db codegen, excluded from core's own projections. Excluding it from the api and the admin panel is an obligation, not yet implemented — see the design doc's "Cross-package consequences" (docs/superpowers/specs/2026-09-02-declarative-version-model-design.md).
_Avoid_: soft delete, retained field

**Fallback**:
The value served in place of the real one for a tombstoned column, for versions that no longer write it. Declared on current's tombstone and consumed by the older live versions' projections that still read that column, keyed by column rather than label.
_Avoid_: default value, null replacement

**Union registry**:
The current registry itself — `=== current` by reference, tombstones included. No merging, no column correction, no retention boundary: a field's `db_column.column_name` is exactly what it declares. Feeds db codegen and drift detection.
_Avoid_: merged registry, combined schema

**Projection**:
A read of one live version's own schema files: per type, each column and the label that version exposes it under, plus any fallback. The current version's projection is the identity over the union whenever no field declares a `column` — the zero-config case, which is what lets the API layer skip a special case for an unversioned project.
_Avoid_: view, mapping

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

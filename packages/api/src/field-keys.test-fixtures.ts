import type { ParsedField } from '@bobbykim/manguito-cms-core'

// A field whose public label differs from its storage column — the case this
// whole stage exists to support. Stage 2 produces these by folding a rename
// chain; here they are hand-built, which is legitimate because parser output is
// plain serializable objects (ADR core/0002).
// NOTE: `ParsedField` carries `required`, `nullable` and `order` alongside
// `validation` — see the BLOG_TYPE fixture in
// packages/api/src/routes/__tests__/content.test.ts for the authoritative shape.
// Keep these fixtures fully typed (no `as ParsedField` cast) so a shape drift
// fails the build rather than a test.
export const divergentTextField: ParsedField = {
  name: 'title',
  label: 'Title',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 0,
  validation: { required: false },
  db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

export const divergentMediaField: ParsedField = {
  name: 'hero',
  label: 'Hero',
  field_type: 'image',
  required: false,
  nullable: true,
  order: 1,
  validation: { required: false },
  db_column: { column_name: 'blog_hero_image', column_type: 'uuid', nullable: true },
  ui_component: { component: 'file-upload', accepted_mime_types: [] },
}

export const identityTextField: ParsedField = {
  name: 'summary',
  label: 'Summary',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 2,
  validation: { required: false },
  db_column: { column_name: 'summary', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

export const paragraphField: ParsedField = {
  name: 'cards',
  label: 'Cards',
  field_type: 'paragraph',
  required: false,
  nullable: true,
  order: 3,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'paragraph-embed', ref: 'paragraph--photo_card', rel: 'one-to-many' },
}

// A one-to-one reference field whose label diverges from its storage column.
// Exercises the gap in resolveRelationBareIds (packages/api/src/relations.ts):
// it has no `reference` branch, so a bare (non-`?include=d`) read leaves the
// row keyed by the raw FK column from `SELECT *`. Unlike manyToManyField
// (junction-backed, no column at all), this field IS column-backed — it has a
// real `foreign_key`, not a `junction` — so it participates in label/storage
// mapping the same way divergentTextField does.
export const divergentReferenceField: ParsedField = {
  name: 'category',
  label: 'Category',
  field_type: 'reference',
  required: false,
  nullable: true,
  order: 5,
  validation: { required: false },
  db_column: {
    column_name: 'category_id',
    column_type: 'uuid',
    nullable: true,
    foreign_key: { table: 'taxonomy--category', column: 'id', on_delete: 'SET NULL' },
  },
  ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-one' },
}

// A tombstone that was renamed before being removed — it carries BOTH `column`
// (the original, still-live storage column) and `removed`. Name and column are
// deliberately distinct so a test can tell whether a consumer is keying off
// the column or the field's current name (a fixture where they coincide can't
// distinguish the two — see field-keys.test.ts).
export const renamedTombstoneField: ParsedField = {
  name: 'legacy_desc',
  label: 'Legacy Description',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 6,
  validation: { required: false },
  db_column: { column_name: 'blog_desc', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
  removed: true,
}

// The collision-check trap from the brief: a LIVE field's label equals a
// TOMBSTONE's column. `createFieldKeyMap` must still throw for this pair —
// excluding tombstoned columns from the collision check before it runs would
// silently drop the live field's column from every response instead.
export const collisionLiveField: ParsedField = {
  name: 'description',
  label: 'Description',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 7,
  validation: { required: false },
  db_column: { column_name: 'd2', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

export const collisionTombstoneField: ParsedField = {
  name: 'x',
  label: 'X',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 8,
  validation: { required: false },
  db_column: { column_name: 'description', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
  removed: true,
}

// A tombstone whose retained column is exactly what an OLDER live version's
// projection still maps to a label — the "un-drop" case for
// createFieldKeyMapFromProjection: the version being served genuinely exposes
// this column, so it must NOT be stripped even though the field itself is a
// tombstone in the current schema. Name and column are deliberately distinct
// (see renamedTombstoneField above) so a test can't pass under a name-keyed
// implementation.
export const retainedColumnTombstoneField: ParsedField = {
  name: 'legacy_title',
  label: 'Legacy Title',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 10,
  validation: { required: false },
  db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
  removed: true,
}

export const manyToManyField: ParsedField = {
  name: 'tags',
  label: 'Tags',
  field_type: 'reference',
  required: false,
  nullable: true,
  order: 4,
  validation: { required: false },
  db_column: {
    column_name: '',
    column_type: 'uuid',
    nullable: true,
    junction: {
      table_name: 'junction_content_blog_post_tags',
      left_column: 'left_id',
      right_column: 'right_id',
      right_table: 'taxonomy_tag',
      order_column: false,
    },
  },
  ui_component: { component: 'typeahead-select', ref: 'taxonomy--tag', rel: 'many-to-many' },
}

import type { ParsedContentType, ParsedParagraphType } from '@bobbykim/manguito-cms-core'

// A paragraph type whose single field's label ('title') differs from its
// storage column ('blog_title'). Reuses divergentTextField above.
export const divergentParagraphType: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--card',
  label: 'Card',
  source_file: 'paragraph--card.json',
  system_fields: [],
  fields: [divergentTextField],
  db: { table_name: 'paragraph_card' },
}

// A reference/junction TARGET type with the same divergence.
export const divergentTargetType: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--category',
  label: 'Category',
  source_file: 'content--category.json',
  only_one: false,
  default_base_path: 'category',
  system_fields: [],
  fields: [divergentTextField],
  ui: { tabs: [] },
  db: { table_name: 'content_category', junction_tables: [] },
  api: {
    default_base_path: 'category',
    http_methods: ['GET'],
    item_path: '/api/category/:slug',
  },
}

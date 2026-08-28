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

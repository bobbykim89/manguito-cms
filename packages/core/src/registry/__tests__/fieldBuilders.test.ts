import { describe, it, expect } from 'vitest'
import { fieldTypeRegistry, machineNameToTableName } from '../fieldTypeRegistry'
import type { FieldType } from '../types'
import type {
  RawTextField,
  RawTextRichField,
  RawIntegerField,
  RawFloatField,
  RawBooleanField,
  RawDateField,
  RawImageField,
  RawEnumField,
  RawParagraphField,
  RawReferenceField,
} from '../../parser/validators'

const ctx = { ownerTableName: 'content_blog_post' }

// ─── Completeness ─────────────────────────────────────────────────────────────

const ALL_FIELD_TYPES: FieldType[] = [
  'text/plain', 'text/rich', 'integer', 'float', 'boolean', 'date',
  'image', 'video', 'file', 'enum', 'paragraph', 'reference',
]

describe('fieldTypeRegistry — completeness', () => {
  it('has a builder for every supported field type', () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(typeof fieldTypeRegistry[type], `missing builder for "${type}"`).toBe('function')
    }
  })
})

// ─── Primitives ───────────────────────────────────────────────────────────────

describe('field builders — primitives', () => {
  it('text/plain — varchar column, text-input, nullable from required', () => {
    const raw: RawTextField = { name: 'title', label: 'Title', type: 'text/plain', required: true }
    const built = fieldTypeRegistry['text/plain'](raw, ctx)
    expect(built.db_column).toEqual({ column_name: 'title', column_type: 'varchar', nullable: false })
    expect(built.ui_component).toEqual({ component: 'text-input' })
    expect(built.validation).toEqual({ required: true })
  })

  it('text/plain — overlays limit and pattern only when present', () => {
    const raw: RawTextField = { name: 'slug', label: 'Slug', type: 'text/plain', required: false, limit: 80, pattern: '^[a-z-]+$' }
    const built = fieldTypeRegistry['text/plain'](raw, ctx)
    expect(built.validation).toEqual({ required: false, limit: 80, pattern: '^[a-z-]+$' })
    expect(built.db_column?.nullable).toBe(true)
  })

  it('text/rich — text column, rich-text-editor', () => {
    const raw: RawTextRichField = { name: 'body', label: 'Body', type: 'text/rich', required: false }
    const built = fieldTypeRegistry['text/rich'](raw, ctx)
    expect(built.db_column?.column_type).toBe('text')
    expect(built.ui_component).toEqual({ component: 'rich-text-editor' })
  })

  it('integer — integer column, number-input step 1, overlays min/max', () => {
    const raw: RawIntegerField = { name: 'qty', label: 'Qty', type: 'integer', required: true, min: 0, max: 99 }
    const built = fieldTypeRegistry['integer'](raw, ctx)
    expect(built.db_column?.column_type).toBe('integer')
    expect(built.ui_component).toEqual({ component: 'number-input', step: 1 })
    expect(built.validation).toEqual({ required: true, min: 0, max: 99 })
  })

  it('float — decimal column, number-input step 0.01', () => {
    const raw: RawFloatField = { name: 'price', label: 'Price', type: 'float', required: false }
    const built = fieldTypeRegistry['float'](raw, ctx)
    expect(built.db_column?.column_type).toBe('decimal')
    expect(built.ui_component).toEqual({ component: 'number-input', step: 0.01 })
  })

  it('boolean — column is always NOT NULL regardless of required', () => {
    const raw: RawBooleanField = { name: 'featured', label: 'Featured', type: 'boolean', required: false }
    const built = fieldTypeRegistry['boolean'](raw, ctx)
    expect(built.db_column).toEqual({ column_name: 'featured', column_type: 'boolean', nullable: false })
    expect(built.ui_component).toEqual({ component: 'checkbox' })
  })

  it('date — timestamp column, date-picker', () => {
    const raw: RawDateField = { name: 'published_at', label: 'Published', type: 'date', required: false }
    const built = fieldTypeRegistry['date'](raw, ctx)
    expect(built.db_column?.column_type).toBe('timestamp')
    expect(built.ui_component).toEqual({ component: 'date-picker' })
  })
})

// ─── Media ────────────────────────────────────────────────────────────────────

describe('field builders — media', () => {
  it('image — uuid FK to media SET NULL, file-upload image/*, specific mime validation', () => {
    const raw: RawImageField = { name: 'hero', label: 'Hero', type: 'image', required: false }
    const built = fieldTypeRegistry['image'](raw, ctx)
    expect(built.db_column).toEqual({
      column_name: 'hero',
      column_type: 'uuid',
      nullable: true,
      foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
    })
    expect(built.ui_component).toEqual({ component: 'file-upload', accepted_mime_types: ['image/*'] })
    expect(built.validation.allowed_mime_types).toEqual([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    ])
  })

  it('image — parses human-readable max_size to bytes', () => {
    const raw: RawImageField = { name: 'hero', label: 'Hero', type: 'image', required: false, max_size: '2MB' }
    const built = fieldTypeRegistry['image'](raw, ctx)
    expect(built.validation.max_size).toBe(2 * 1_048_576)
  })

  it('file — accepts application/pdf only', () => {
    const built = fieldTypeRegistry['file']({ name: 'doc', label: 'Doc', type: 'file', required: false }, ctx)
    expect(built.validation.allowed_mime_types).toEqual(['application/pdf'])
    expect(built.ui_component).toEqual({ component: 'file-upload', accepted_mime_types: ['application/pdf'] })
  })
})

// ─── Enum ─────────────────────────────────────────────────────────────────────

describe('field builders — enum', () => {
  it('inline enum — fills allowed_values, check_constraint and options from values', () => {
    const raw: RawEnumField = { name: 'status', label: 'Status', type: 'enum', required: true, values: ['draft', 'live'] }
    const built = fieldTypeRegistry['enum'](raw, ctx)
    expect(built.validation.allowed_values).toEqual(['draft', 'live'])
    expect(built.db_column?.check_constraint).toEqual(['draft', 'live'])
    expect(built.ui_component).toEqual({ component: 'select', options: ['draft', 'live'] })
  })

  it('ref enum — leaves values empty and stashes enum_ref sentinel for the assembly pass', () => {
    const raw: RawEnumField = { name: 'target', label: 'Target', type: 'enum', required: true, ref: 'enum--link_target' }
    const built = fieldTypeRegistry['enum'](raw, ctx)
    expect(built.validation.allowed_values).toEqual([])
    expect(built.db_column?.check_constraint).toEqual([])
    expect(built.ui_component).toEqual({ component: 'select', options: [], enum_ref: 'enum--link_target' })
  })
})

// ─── Paragraph ────────────────────────────────────────────────────────────────

describe('field builders — paragraph', () => {
  it('produces no column and a paragraph-embed carrying ref/rel/max', () => {
    const raw: RawParagraphField = { name: 'cards', label: 'Cards', type: 'paragraph', required: false, ref: 'paragraph--photo_card', rel: 'one-to-many', max: 8 }
    const built = fieldTypeRegistry['paragraph'](raw, ctx)
    expect(built.db_column).toBeNull()
    expect(built.ui_component).toEqual({ component: 'paragraph-embed', ref: 'paragraph--photo_card', rel: 'one-to-many', max: 8 })
    expect(built.validation).toEqual({ required: false, max_items: 8 })
  })
})

// ─── Reference ────────────────────────────────────────────────────────────────

describe('field builders — reference', () => {
  it('one-to-one — FK column to the resolved target table, SET NULL', () => {
    const raw: RawReferenceField = { name: 'category', label: 'Category', type: 'reference', required: false, target: 'taxonomy--daily_post', rel: 'one-to-one' }
    const built = fieldTypeRegistry['reference'](raw, ctx)
    expect(built.db_column).toEqual({
      column_name: 'category',
      column_type: 'uuid',
      nullable: true,
      foreign_key: { table: 'taxonomy_daily_post', column: 'id', on_delete: 'SET NULL' },
    })
    expect(built.ui_component).toEqual({ component: 'typeahead-select', ref: 'taxonomy--daily_post', rel: 'one-to-one' })
  })

  it('many-to-many — junction table named from owner + field, no FK column', () => {
    const raw: RawReferenceField = { name: 'related', label: 'Related', type: 'reference', required: false, target: 'content--blog_post', rel: 'many-to-many', max: 10 }
    const built = fieldTypeRegistry['reference'](raw, ctx)
    expect(built.db_column).toEqual({
      column_name: '',
      column_type: 'uuid',
      nullable: true,
      junction: {
        table_name: 'junction_content_blog_post_related',
        left_column: 'left_id',
        right_column: 'right_id',
        right_table: 'content_blog_post',
        order_column: false,
      },
    })
    expect(built.validation).toEqual({ required: false, max_items: 10 })
  })
})

// ─── Shared helper ────────────────────────────────────────────────────────────

describe('machineNameToTableName', () => {
  it('replaces the -- separator with a single underscore', () => {
    expect(machineNameToTableName('content--blog_post')).toBe('content_blog_post')
    expect(machineNameToTableName('taxonomy--daily_post')).toBe('taxonomy_daily_post')
  })
})

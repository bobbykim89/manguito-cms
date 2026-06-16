import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'
import type {
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedEnumType,
} from '../parseSchema'

// ─── Minimal valid fixtures ───────────────────────────────────────────────────

const MINIMAL_CONTENT: unknown = {
  name: 'content--blog_post',
  label: 'Blog Post',
  type: 'content-type',
  default_base_path: 'blog',
  only_one: false,
  fields: [
    {
      tab: {
        name: 'primary_tab',
        label: 'Primary',
        fields: [
          { name: 'title', label: 'Title', type: 'text/plain', required: true },
        ],
      },
    },
  ],
}

const MINIMAL_PARAGRAPH: unknown = {
  name: 'paragraph--photo_card',
  label: 'Photo Card',
  type: 'paragraph-type',
  fields: [
    { name: 'card_title', label: 'Title', type: 'text/plain', required: true },
  ],
}

const MINIMAL_TAXONOMY: unknown = {
  name: 'taxonomy--daily_post',
  label: 'Daily Post',
  type: 'taxonomy-type',
  fields: [
    { name: 'daily_title', label: 'Title', type: 'text/plain', required: true },
  ],
}

const MINIMAL_ENUM: unknown = {
  name: 'enum--link_target',
  label: 'Link Target',
  type: 'enum-type',
  values: ['_self', '_blank'],
}

// ─── Content type ─────────────────────────────────────────────────────────────

describe('parseSchema — content-type', () => {
  it('parses a minimal valid content type', () => {
    const result = parseSchema(MINIMAL_CONTENT, 'content-type', 'schemas/content-types/content--blog_post.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.schema_type).toBe('content-type')
    expect(schema.name).toBe('content--blog_post')
    expect(schema.label).toBe('Blog Post')
    expect(schema.only_one).toBe(false)
    expect(schema.default_base_path).toBe('blog')
    expect(schema.source_file).toBe('schemas/content-types/content--blog_post.json')
  })

  it('injects content system fields', () => {
    const result = parseSchema(MINIMAL_CONTENT, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    const sysNames = schema.system_fields.map((f) => f.name)
    expect(sysNames).toEqual(['id', 'slug', 'base_path_id', 'published', 'created_at', 'updated_at'])
    expect(schema.system_fields.find((f) => f.name === 'id')?.primary_key).toBe(true)
  })

  it('strips tabs — fields array is flat', () => {
    const raw: unknown = {
      name: 'content--blog_post',
      label: 'Blog Post',
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'tab_a',
            label: 'A',
            fields: [
              { name: 'field_a', label: 'Field A', type: 'text/plain', required: true },
            ],
          },
        },
        {
          tab: {
            name: 'tab_b',
            label: 'B',
            fields: [
              { name: 'field_b', label: 'Field B', type: 'integer', required: false },
            ],
          },
        },
      ],
    }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.fields).toHaveLength(2)
    expect(schema.fields[0]?.name).toBe('field_a')
    expect(schema.fields[1]?.name).toBe('field_b')
  })

  it('preserves tab structure in ui.tabs', () => {
    const raw: unknown = {
      name: 'content--blog_post',
      label: 'Blog Post',
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: [
              { name: 'title', label: 'Title', type: 'text/plain', required: true },
              { name: 'body', label: 'Body', type: 'text/rich', required: false },
            ],
          },
        },
        {
          tab: {
            name: 'meta_tab',
            label: 'Meta',
            fields: [
              { name: 'meta_title', label: 'Meta Title', type: 'text/plain', required: true },
            ],
          },
        },
      ],
    }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.ui.tabs).toHaveLength(2)
    expect(schema.ui.tabs[0]?.name).toBe('primary_tab')
    expect(schema.ui.tabs[0]?.fields).toEqual(['title', 'body'])
    expect(schema.ui.tabs[1]?.name).toBe('meta_tab')
    expect(schema.ui.tabs[1]?.fields).toEqual(['meta_title'])
  })

  it('derives table name from machine name', () => {
    const result = parseSchema(MINIMAL_CONTENT, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.db.table_name).toBe('content_blog_post')
  })

  it('sets api paths and http methods for only_one: false', () => {
    const result = parseSchema(MINIMAL_CONTENT, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.api.collection_path).toBe('/api/blog-post')
    expect(schema.api.item_path).toBe('/api/blog-post/:slug')
    expect(schema.api.http_methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  })

  it('sets api paths and http methods for only_one: true', () => {
    const raw: unknown = {
      ...MINIMAL_CONTENT as object,
      name: 'content--cost_calculator',
      only_one: true,
      default_base_path: 'tuition',
    }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.api.collection_path).toBeUndefined()
    expect(schema.api.item_path).toBe('/api/tuition/cost-calculator')
    expect(schema.api.http_methods).toEqual(['GET', 'PUT', 'PATCH'])
  })

  it('emits a junction table for many-to-many reference fields', () => {
    const raw: unknown = {
      name: 'content--blog_post',
      label: 'Blog Post',
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'relations_tab',
            label: 'Relations',
            fields: [
              {
                name: 'blog_related',
                label: 'Related Posts',
                type: 'reference',
                target: 'content--blog_post',
                rel: 'many-to-many',
                required: false,
              },
            ],
          },
        },
      ],
    }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.db.junction_tables).toHaveLength(1)
    const jt = schema.db.junction_tables[0]!
    expect(jt.table_name).toBe('junction_content_blog_post_blog_related')
    expect(jt.left_column).toBe('left_id')
    expect(jt.right_column).toBe('right_id')
    expect(jt.right_table).toBe('content_blog_post')
  })

  it('has no junction tables when no many-to-many reference fields', () => {
    const result = parseSchema(MINIMAL_CONTENT, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedContentType
    expect(schema.db.junction_tables).toHaveLength(0)
  })

  it('returns DUPLICATE_FIELD_NAME error for duplicate field names', () => {
    const raw: unknown = {
      name: 'content--blog_post',
      label: 'Blog Post',
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: [
              { name: 'title', label: 'Title', type: 'text/plain', required: true },
              { name: 'title', label: 'Title Again', type: 'text/plain', required: false },
            ],
          },
        },
      ],
    }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('DUPLICATE_FIELD_NAME')
  })

  it('returns INVALID_MACHINE_NAME error for wrong content name prefix', () => {
    const raw: unknown = { ...MINIMAL_CONTENT as object, name: 'paragraph--blog_post' }
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_MACHINE_NAME')
  })

  it('returns MISSING_REQUIRED_FIELD error when required top-level field is absent', () => {
    const { only_one: _omit, ...withoutOnlyOne } = MINIMAL_CONTENT as Record<string, unknown>
    const result = parseSchema(withoutOnlyOne, 'content-type')
    expect(result.ok).toBe(false)
  })
})

// ─── Paragraph type ───────────────────────────────────────────────────────────

describe('parseSchema — paragraph-type', () => {
  it('parses a minimal valid paragraph type', () => {
    const result = parseSchema(MINIMAL_PARAGRAPH, 'paragraph-type', 'schemas/paragraph-types/paragraph--photo_card.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect(schema.schema_type).toBe('paragraph-type')
    expect(schema.name).toBe('paragraph--photo_card')
    expect(schema.label).toBe('Photo Card')
    expect(schema.source_file).toBe('schemas/paragraph-types/paragraph--photo_card.json')
  })

  it('injects paragraph system fields', () => {
    const result = parseSchema(MINIMAL_PARAGRAPH, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    const sysNames = schema.system_fields.map((f) => f.name)
    expect(sysNames).toEqual(['id', 'parent_id', 'parent_type', 'parent_field', 'order', 'created_at', 'updated_at'])
  })

  it('has no api section', () => {
    const result = parseSchema(MINIMAL_PARAGRAPH, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect('api' in schema).toBe(false)
  })

  it('has no ui.tabs section', () => {
    const result = parseSchema(MINIMAL_PARAGRAPH, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect('ui' in schema).toBe(false)
  })

  it('accepts an empty fields array', () => {
    const raw: unknown = {
      name: 'paragraph--photo_card',
      label: 'Photo Card',
      type: 'paragraph-type',
      fields: [],
    }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect(schema.fields).toHaveLength(0)
  })

  it('derives table name from machine name', () => {
    const result = parseSchema(MINIMAL_PARAGRAPH, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect(schema.db.table_name).toBe('paragraph_photo_card')
  })

  it('returns DUPLICATE_FIELD_NAME error for duplicate field names', () => {
    const raw: unknown = {
      name: 'paragraph--photo_card',
      label: 'Photo Card',
      type: 'paragraph-type',
      fields: [
        { name: 'card_title', label: 'Title', type: 'text/plain', required: true },
        { name: 'card_title', label: 'Title 2', type: 'text/plain', required: false },
      ],
    }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('DUPLICATE_FIELD_NAME')
  })

  it('returns error for wrong paragraph name prefix', () => {
    const raw: unknown = { ...MINIMAL_PARAGRAPH as object, name: 'content--photo_card' }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_MACHINE_NAME')
  })
})

// ─── Taxonomy type ────────────────────────────────────────────────────────────

describe('parseSchema — taxonomy-type', () => {
  it('parses a minimal valid taxonomy type', () => {
    const result = parseSchema(MINIMAL_TAXONOMY, 'taxonomy-type', 'schemas/taxonomy-types/taxonomy--daily_post.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedTaxonomyType
    expect(schema.schema_type).toBe('taxonomy-type')
    expect(schema.name).toBe('taxonomy--daily_post')
    expect(schema.label).toBe('Daily Post')
  })

  it('injects taxonomy system fields', () => {
    const result = parseSchema(MINIMAL_TAXONOMY, 'taxonomy-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedTaxonomyType
    const sysNames = schema.system_fields.map((f) => f.name)
    expect(sysNames).toEqual(['id', 'published', 'created_at', 'updated_at'])
  })

  it('derives correct taxonomy api paths', () => {
    const result = parseSchema(MINIMAL_TAXONOMY, 'taxonomy-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedTaxonomyType
    expect(schema.api.collection_path).toBe('/api/taxonomy/daily-post')
    expect(schema.api.item_path).toBe('/api/taxonomy/daily-post/:id')
  })

  it('derives table name from machine name', () => {
    const result = parseSchema(MINIMAL_TAXONOMY, 'taxonomy-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedTaxonomyType
    expect(schema.db.table_name).toBe('taxonomy_daily_post')
  })

  it('accepts an empty fields array', () => {
    const raw: unknown = {
      name: 'taxonomy--daily_post',
      label: 'Daily Post',
      type: 'taxonomy-type',
      fields: [],
    }
    const result = parseSchema(raw, 'taxonomy-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedTaxonomyType
    expect(schema.fields).toHaveLength(0)
  })
})

// ─── Enum type ────────────────────────────────────────────────────────────────

describe('parseSchema — enum-type', () => {
  it('parses a minimal valid enum type', () => {
    const result = parseSchema(MINIMAL_ENUM, 'enum-type', 'schemas/enum-types/enum--link_target.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedEnumType
    expect(schema.schema_type).toBe('enum-type')
    expect(schema.name).toBe('enum--link_target')
    expect(schema.label).toBe('Link Target')
    expect(schema.values).toEqual(['_self', '_blank'])
  })

  it('has no fields, db, or api section', () => {
    const result = parseSchema(MINIMAL_ENUM, 'enum-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedEnumType
    expect('fields' in schema).toBe(false)
    expect('db' in schema).toBe(false)
    expect('api' in schema).toBe(false)
  })

  it('requires at least one value', () => {
    const raw: unknown = {
      name: 'enum--link_target',
      label: 'Link Target',
      type: 'enum-type',
      values: [],
    }
    const result = parseSchema(raw, 'enum-type')
    expect(result.ok).toBe(false)
  })

  it('returns error for wrong enum name prefix', () => {
    const raw: unknown = { ...MINIMAL_ENUM as object, name: 'content--link_target' }
    const result = parseSchema(raw, 'enum-type')
    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_MACHINE_NAME')
  })
})

// ─── Field type handling ──────────────────────────────────────────────────────

describe('parseSchema — field types', () => {
  function makeContentWithField(field: unknown): unknown {
    return {
      name: 'content--blog_post',
      label: 'Blog Post',
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields: [field] } }],
    }
  }

  it('text/plain — db column is varchar, ui is text-input', () => {
    const raw = makeContentWithField({ name: 'title', label: 'Title', type: 'text/plain', required: true, limit: 200, pattern: '^[A-Z]' })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.field_type).toBe('text/plain')
    expect(f.db_column?.column_type).toBe('varchar')
    expect(f.ui_component.component).toBe('text-input')
    expect(f.validation.limit).toBe(200)
    expect(f.validation.pattern).toBe('^[A-Z]')
  })

  it('text/rich — db column is text, ui is rich-text-editor', () => {
    const raw = makeContentWithField({ name: 'body', label: 'Body', type: 'text/rich', required: false })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('text')
    expect(f.ui_component.component).toBe('rich-text-editor')
    expect(f.nullable).toBe(true)
  })

  it('integer — db column is integer, ui is number-input with step 1', () => {
    const raw = makeContentWithField({ name: 'count', label: 'Count', type: 'integer', required: true, min: 0, max: 100 })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('integer')
    const ui = f.ui_component as { component: string; step: number }
    expect(ui.component).toBe('number-input')
    expect(ui.step).toBe(1)
    expect(f.validation.min).toBe(0)
    expect(f.validation.max).toBe(100)
  })

  it('float — db column is decimal, ui is number-input with step 0.01', () => {
    const raw = makeContentWithField({ name: 'price', label: 'Price', type: 'float', required: true })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('decimal')
    const ui = f.ui_component as { component: string; step: number }
    expect(ui.step).toBe(0.01)
  })

  it('boolean — db column is always NOT NULL', () => {
    const raw = makeContentWithField({ name: 'active', label: 'Active', type: 'boolean', required: false })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('boolean')
    expect(f.db_column?.nullable).toBe(false) // always NOT NULL for boolean
    expect(f.ui_component.component).toBe('checkbox')
  })

  it('date — db column is timestamp, ui is date-picker', () => {
    const raw = makeContentWithField({ name: 'publish_at', label: 'Publish At', type: 'date', required: false })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('timestamp')
    expect(f.ui_component.component).toBe('date-picker')
  })

  it('image — db column is uuid FK to media, ui is file-upload', () => {
    const raw = makeContentWithField({ name: 'hero', label: 'Hero', type: 'image', required: true, max_size: '2MB', alt: true })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('uuid')
    expect(f.db_column?.foreign_key?.table).toBe('media')
    expect(f.db_column?.foreign_key?.on_delete).toBe('SET NULL')
    expect(f.validation.max_size).toBe(2 * 1024 * 1024)
    expect(f.validation.allowed_mime_types).toContain('image/jpeg')
    expect(f.validation.allowed_mime_types).toContain('image/png')
    const ui = f.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.component).toBe('file-upload')
    expect(ui.accepted_mime_types).toEqual(['image/*'])
  })

  it('video — ui accepted_mime_types is ["video/*"]', () => {
    const raw = makeContentWithField({ name: 'clip', label: 'Clip', type: 'video', required: false, max_size: '50MB' })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.max_size).toBe(50 * 1024 * 1024)
    expect(f.validation.allowed_mime_types).toContain('video/mp4')
    const ui = f.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.accepted_mime_types).toEqual(['video/*'])
  })

  it('file — validation mime types is ["application/pdf"]', () => {
    const raw = makeContentWithField({ name: 'brochure', label: 'Brochure', type: 'file', required: false })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.allowed_mime_types).toEqual(['application/pdf'])
    const ui = f.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.accepted_mime_types).toEqual(['application/pdf'])
  })

  it('enum inline — allowed_values inlined, db column is varchar with check_constraint', () => {
    const raw = makeContentWithField({
      name: 'status',
      label: 'Status',
      type: 'enum',
      values: ['draft', 'review', 'approved'],
      required: true,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_type).toBe('varchar')
    expect(f.db_column?.check_constraint).toEqual(['draft', 'review', 'approved'])
    expect(f.validation.allowed_values).toEqual(['draft', 'review', 'approved'])
    const ui = f.ui_component as { component: string; options: string[] }
    expect(ui.component).toBe('select')
    expect(ui.options).toEqual(['draft', 'review', 'approved'])
  })

  it('enum ref — allowed_values is empty array (deferred to registry builder)', () => {
    const raw = makeContentWithField({
      name: 'link_target',
      label: 'Target',
      type: 'enum',
      ref: 'enum--link_target',
      required: true,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.allowed_values).toEqual([])
    expect(f.db_column?.check_constraint).toEqual([])
  })

  it('enum with both ref and values — validation error', () => {
    const raw = makeContentWithField({
      name: 'status',
      label: 'Status',
      type: 'enum',
      ref: 'enum--link_target',
      values: ['a', 'b'],
      required: true,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(false)
  })

  it('enum with neither ref nor values — validation error', () => {
    const raw = makeContentWithField({
      name: 'status',
      label: 'Status',
      type: 'enum',
      required: true,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(false)
  })

  it('paragraph — db_column is null, ui is paragraph-embed', () => {
    const raw = makeContentWithField({
      name: 'cards',
      label: 'Cards',
      type: 'paragraph',
      ref: 'paragraph--photo_card',
      rel: 'one-to-many',
      max: 8,
      required: false,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column).toBeNull()
    expect(f.field_type).toBe('paragraph')
    const ui = f.ui_component as { component: string; ref: string; rel: string; max: number }
    expect(ui.component).toBe('paragraph-embed')
    expect(ui.ref).toBe('paragraph--photo_card')
    expect(ui.rel).toBe('one-to-many')
    expect(ui.max).toBe(8)
    expect(f.validation.max_items).toBe(8)
  })

  it('reference one-to-one — FK column on owning table, SET NULL on delete', () => {
    const raw = makeContentWithField({
      name: 'blog_category',
      label: 'Category',
      type: 'reference',
      target: 'taxonomy--daily_post',
      rel: 'one-to-one',
      required: false,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.column_name).toBe('blog_category')
    expect(f.db_column?.column_type).toBe('uuid')
    expect(f.db_column?.foreign_key?.table).toBe('taxonomy_daily_post')
    expect(f.db_column?.foreign_key?.on_delete).toBe('SET NULL')
    const ui = f.ui_component as { component: string; ref: string; rel: string }
    expect(ui.component).toBe('typeahead-select')
    expect(ui.ref).toBe('taxonomy--daily_post')
    expect(ui.rel).toBe('one-to-one')
  })

  it('reference many-to-many — junction table defined on db_column', () => {
    const raw = makeContentWithField({
      name: 'blog_related',
      label: 'Related Posts',
      type: 'reference',
      target: 'content--blog_post',
      rel: 'many-to-many',
      max: 10,
      required: false,
    })
    const result = parseSchema(raw, 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.db_column?.junction).toBeDefined()
    expect(f.db_column?.junction?.table_name).toBe('junction_content_blog_post_blog_related')
    expect(f.db_column?.junction?.right_table).toBe('content_blog_post')
    expect(f.validation.max_items).toBe(10)
  })
})

// ─── max_size normalization ───────────────────────────────────────────────────

describe('parseSchema — max_size normalization', () => {
  function makeContentWithImage(max_size: string): unknown {
    return {
      name: 'content--test',
      label: 'Test',
      type: 'content-type',
      default_base_path: 'root',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: [{ name: 'img', label: 'Image', type: 'image', required: false, max_size }],
          },
        },
      ],
    }
  }

  it('normalizes "512KB" to 524288 bytes', () => {
    const result = parseSchema(makeContentWithImage('512KB'), 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.max_size).toBe(512 * 1024)
  })

  it('normalizes "2MB" to 2097152 bytes', () => {
    const result = parseSchema(makeContentWithImage('2MB'), 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.max_size).toBe(2 * 1024 * 1024)
  })

  it('normalizes "1GB" to 1073741824 bytes', () => {
    const result = parseSchema(makeContentWithImage('1GB'), 'content-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedContentType).fields[0]!
    expect(f.validation.max_size).toBe(1024 * 1024 * 1024)
  })

  it('rejects invalid max_size string', () => {
    const result = parseSchema(makeContentWithImage('5 megabytes'), 'content-type')
    expect(result.ok).toBe(false)
  })
})

// ─── Field order preservation ─────────────────────────────────────────────────

describe('parseSchema — field order', () => {
  it('assigns order based on position in schema array', () => {
    const raw: unknown = {
      name: 'paragraph--link_item',
      label: 'Link Item',
      type: 'paragraph-type',
      fields: [
        { name: 'link_text', label: 'Text', type: 'text/plain', required: true },
        { name: 'link_url', label: 'URL', type: 'text/plain', required: true },
        { name: 'link_target', label: 'Target', type: 'enum', values: ['_self', '_blank'], required: true },
      ],
    }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const schema = result.schema as ParsedParagraphType
    expect(schema.fields[0]?.order).toBe(0)
    expect(schema.fields[1]?.order).toBe(1)
    expect(schema.fields[2]?.order).toBe(2)
  })
})

// ─── nullable derivation ──────────────────────────────────────────────────────

describe('parseSchema — nullable derivation', () => {
  it('required: true → nullable: false', () => {
    const raw: unknown = {
      name: 'paragraph--item',
      label: 'Item',
      type: 'paragraph-type',
      fields: [{ name: 'title', label: 'Title', type: 'text/plain', required: true }],
    }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedParagraphType).fields[0]!
    expect(f.nullable).toBe(false)
  })

  it('required: false → nullable: true', () => {
    const raw: unknown = {
      name: 'paragraph--item',
      label: 'Item',
      type: 'paragraph-type',
      fields: [{ name: 'subtitle', label: 'Subtitle', type: 'text/plain', required: false }],
    }
    const result = parseSchema(raw, 'paragraph-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const f = (result.schema as ParsedParagraphType).fields[0]!
    expect(f.nullable).toBe(true)
  })
})

// ─── source_file propagation ──────────────────────────────────────────────────

describe('parseSchema — source_file', () => {
  it('defaults to empty string when sourceFile is omitted', () => {
    const result = parseSchema(MINIMAL_ENUM, 'enum-type')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.schema.source_file).toBe('')
  })

  it('includes source_file in parse errors', () => {
    const raw: unknown = { name: 'bad--name', label: 'X', type: 'taxonomy-type', fields: [] }
    const result = parseSchema(raw, 'taxonomy-type', 'schemas/taxonomy-types/bad--name.json')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.file).toBe('schemas/taxonomy-types/bad--name.json')
  })
})

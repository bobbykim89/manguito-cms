import { describe, it, expect } from 'vitest'
import type { ParsedContentType, ParsedParagraphType, ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'
import { generateFormComponent } from '../form-generator'

const contentTypeFixture: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--article',
  label: 'Article',
  source_file: 'article.ts',
  only_one: false,
  default_base_path: 'content',
  system_fields: [],
  fields: [
    {
      name: 'title',
      label: 'Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'body',
      label: 'Body',
      field_type: 'text/rich',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: { column_name: 'body', column_type: 'text', nullable: true },
      ui_component: { component: 'rich-text-editor' },
    },
    {
      name: 'cover',
      label: 'Cover',
      field_type: 'image',
      required: false,
      nullable: true,
      order: 2,
      validation: {
        required: false,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
      },
      db_column: {
        column_name: 'cover',
        column_type: 'uuid',
        nullable: true,
        foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
      },
      ui_component: { component: 'file-upload', accepted_mime_types: ['image/*'] },
    },
    {
      name: 'status',
      label: 'Status',
      field_type: 'enum',
      required: false,
      nullable: true,
      order: 3,
      validation: { required: false, allowed_values: ['draft', 'published'] },
      db_column: {
        column_name: 'status',
        column_type: 'varchar',
        nullable: true,
        check_constraint: ['draft', 'published'],
      },
      ui_component: { component: 'select', options: ['draft', 'published'] },
    },
    {
      name: 'cards',
      label: 'Cards',
      field_type: 'paragraph',
      required: false,
      nullable: true,
      order: 4,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--pull_quote', rel: 'one-to-many' },
    },
  ],
  ui: {
    tabs: [
      { name: 'content', label: 'Content', fields: ['title', 'body', 'status', 'cards'] },
      { name: 'media', label: 'Media', fields: ['cover'] },
    ],
  },
  db: { table_name: 'content_article', junction_tables: [] },
  api: {
    default_base_path: 'content',
    http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    collection_path: '/api/article',
    item_path: '/api/article/:slug',
  },
}

const paragraphTypeFixture: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--pull_quote',
  label: 'Pull Quote',
  source_file: 'pull_quote.ts',
  system_fields: [],
  fields: [
    {
      name: 'quote',
      label: 'Quote',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'quote', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'attribution',
      label: 'Attribution',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: { column_name: 'attribution', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: 'paragraph_pull_quote' },
}

const taxonomyTypeFixture: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--tag',
  label: 'Tag',
  source_file: 'tag.ts',
  system_fields: [],
  fields: [
    {
      name: 'label',
      label: 'Label',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'label', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: 'taxonomy_tag' },
  api: {
    collection_path: '/api/taxonomy/tag',
    item_path: '/api/taxonomy/tag/:id',
  },
}

describe('generateFormComponent', () => {
  it('generates correct SFC for content type', () => {
    expect(generateFormComponent(contentTypeFixture)).toMatchSnapshot()
  })

  it('generates correct SFC for paragraph type', () => {
    expect(generateFormComponent(paragraphTypeFixture)).toMatchSnapshot()
  })

  it('generates correct SFC for taxonomy type', () => {
    expect(generateFormComponent(taxonomyTypeFixture)).toMatchSnapshot()
  })

  it('content type output starts with AUTO-GENERATED comment', () => {
    expect(generateFormComponent(contentTypeFixture)).toMatch(/<!-- AUTO-GENERATED/)
  })

  it('paragraph field in content type uses ParagraphEmbed with formComponent prop', () => {
    expect(generateFormComponent(contentTypeFixture)).toContain('ParagraphEmbed')
    expect(generateFormComponent(contentTypeFixture)).toContain(':formComponent=')
  })

  it('all imports use package path not relative path', () => {
    const output = generateFormComponent(contentTypeFixture)
    expect(output).not.toContain('../../')
    expect(output).not.toContain('../')
    expect(output).toContain('@bobbykim/manguito-cms-admin/src/components')
  })
})

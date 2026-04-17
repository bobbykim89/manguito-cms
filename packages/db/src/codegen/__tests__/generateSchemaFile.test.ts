import { describe, it, expect } from 'vitest'
import type {
  DbColumn,
  ParsedContentType,
  ParsedField,
  ParsedParagraphType,
  ParsedTaxonomyType,
  SchemaRegistry,
  SystemField,
} from '@bobbykim/manguito-cms-core'
import {
  generateFieldColumn,
  generateSchemaFile,
  generateSystemFieldColumn,
  orderParagraphTypes,
} from '../index'

// ─── Shared Fixtures ─────────────────────────────────────────────────────────

const ID_FIELD: SystemField = {
  name: 'id',
  db_type: 'uuid',
  primary_key: true,
  nullable: false,
}

const CONTENT_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'slug', db_type: 'varchar', nullable: false },
  { name: 'base_path_id', db_type: 'uuid', nullable: false },
  { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const PARAGRAPH_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'parent_id', db_type: 'uuid', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const TAXONOMY_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

function makeEmptyRegistry(): SchemaRegistry {
  return {
    routes: { base_paths: [] },
    roles: { roles: [], valid_permissions: [] },
    schemas: {},
    content_types: {},
    paragraph_types: {},
    taxonomy_types: {},
    enum_types: {},
    all_schemas: [],
  }
}

function makeField(
  name: string,
  dbColumn: DbColumn | null,
  fieldType: ParsedField['field_type'] = 'text/plain',
): ParsedField {
  return {
    name,
    label: name,
    field_type: fieldType,
    required: true,
    nullable: dbColumn?.nullable ?? false,
    order: 0,
    validation: { required: true },
    db_column: dbColumn,
    ui_component: { component: 'text-input' },
  }
}

function makeContentType(
  name: string,
  fields: ParsedField[],
  junctionTables: ParsedContentType['db']['junction_tables'] = [],
): ParsedContentType {
  return {
    schema_type: 'content-type',
    name,
    label: name,
    source_file: `${name}.json`,
    only_one: false,
    default_base_path: 'content',
    system_fields: CONTENT_SYSTEM_FIELDS,
    fields,
    ui: { tabs: [] },
    db: { table_name: `content_${name}`, junction_tables: junctionTables },
    api: {
      default_base_path: 'content',
      http_methods: ['GET'],
      collection_path: `/content/${name}`,
      item_path: `/content/${name}/:slug`,
    },
  }
}

function makeParagraphType(
  name: string,
  fields: ParsedField[],
): ParsedParagraphType {
  return {
    schema_type: 'paragraph-type',
    name,
    label: name,
    source_file: `${name}.json`,
    system_fields: PARAGRAPH_SYSTEM_FIELDS,
    fields,
    db: { table_name: `paragraph_${name}` },
  }
}

function makeTaxonomyType(name: string): ParsedTaxonomyType {
  return {
    schema_type: 'taxonomy-type',
    name,
    label: name,
    source_file: `${name}.json`,
    system_fields: TAXONOMY_SYSTEM_FIELDS,
    fields: [],
    db: { table_name: `taxonomy_${name}` },
    api: { collection_path: `/taxonomy/${name}`, item_path: `/taxonomy/${name}/:id` },
  }
}

// ─── System Tables ────────────────────────────────────────────────────────────

describe('generateSchemaFile — system tables', () => {
  it('empty registry includes all 4 system tables', () => {
    const output = generateSchemaFile(makeEmptyRegistry())
    expect(output).toContain("export const media = s.pgTable('media'")
    expect(output).toContain("export const base_paths = s.pgTable('base_paths'")
    expect(output).toContain("export const roles = s.pgTable('roles'")
    expect(output).toContain("export const users = s.pgTable('users'")
  })

  it('users table has role_id FK with onDelete restrict', () => {
    const output = generateSchemaFile(makeEmptyRegistry())
    expect(output).toContain(
      ".references(() => roles.id, { onDelete: 'restrict' })",
    )
  })

  it('file starts with correct import lines', () => {
    const output = generateSchemaFile(makeEmptyRegistry())
    expect(output.startsWith("import * as s from 'drizzle-orm/pg-core'")).toBe(
      true,
    )
    expect(output).toContain("import { sql } from 'drizzle-orm'")
  })
})

// ─── Field Column Generation ──────────────────────────────────────────────────

describe('generateFieldColumn — DbColumnType mapping', () => {
  it('varchar produces varchar with length from validation.limit', () => {
    const field = makeField('title', {
      column_name: 'title',
      column_type: 'varchar',
      nullable: false,
    })
    field.validation.limit = 100
    expect(generateFieldColumn(field)).toBe(
      "s.varchar('title', { length: 100 }).notNull()",
    )
  })

  it('varchar defaults to length 255 when no validation.limit', () => {
    const field = makeField('title', {
      column_name: 'title',
      column_type: 'varchar',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe(
      "s.varchar('title', { length: 255 }).notNull()",
    )
  })

  it('text produces s.text', () => {
    const field = makeField('body', {
      column_name: 'body',
      column_type: 'text',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe("s.text('body').notNull()")
  })

  it('integer produces s.integer', () => {
    const field = makeField('count', {
      column_name: 'count',
      column_type: 'integer',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe("s.integer('count').notNull()")
  })

  it('decimal produces s.decimal with fixed precision and scale', () => {
    const field = makeField('price', {
      column_name: 'price',
      column_type: 'decimal',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe(
      "s.decimal('price', { precision: 10, scale: 4 }).notNull()",
    )
  })

  it('boolean produces s.boolean', () => {
    const field = makeField('active', {
      column_name: 'active',
      column_type: 'boolean',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe("s.boolean('active').notNull()")
  })

  it('timestamp produces s.timestamp', () => {
    const field = makeField('published_at', {
      column_name: 'published_at',
      column_type: 'timestamp',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe(
      "s.timestamp('published_at').notNull()",
    )
  })

  it('uuid produces s.uuid', () => {
    const field = makeField('ref_id', {
      column_name: 'ref_id',
      column_type: 'uuid',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toBe("s.uuid('ref_id').notNull()")
  })

  it('paragraph field returns null', () => {
    const field = makeField('card', null, 'paragraph')
    expect(generateFieldColumn(field)).toBeNull()
  })

  it('many-to-many reference field (junction set) returns null', () => {
    const field = makeField(
      'related',
      {
        column_name: 'related_id',
        column_type: 'uuid',
        nullable: false,
        junction: {
          table_name: 'junction_content_post_related',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'content_post',
          order_column: false,
        },
      },
      'reference',
    )
    expect(generateFieldColumn(field)).toBeNull()
  })

  it('FK references use () => callback form', () => {
    const field = makeField('cover_id', {
      column_name: 'cover_id',
      column_type: 'uuid',
      nullable: true,
      foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
    })
    const result = generateFieldColumn(field)
    expect(result).toContain(".references(() => media.id, { onDelete: 'set null' })")
    expect(result).not.toContain('.references(media.id')
  })

  it('maps all three on_delete values correctly', () => {
    const cascade = makeField('a_id', {
      column_name: 'a_id',
      column_type: 'uuid',
      nullable: false,
      foreign_key: { table: 'other', column: 'id', on_delete: 'CASCADE' },
    })
    const setNull = makeField('b_id', {
      column_name: 'b_id',
      column_type: 'uuid',
      nullable: true,
      foreign_key: { table: 'other', column: 'id', on_delete: 'SET NULL' },
    })
    const restrict = makeField('c_id', {
      column_name: 'c_id',
      column_type: 'uuid',
      nullable: false,
      foreign_key: { table: 'other', column: 'id', on_delete: 'RESTRICT' },
    })
    expect(generateFieldColumn(cascade)).toContain("onDelete: 'cascade'")
    expect(generateFieldColumn(setNull)).toContain("onDelete: 'set null'")
    expect(generateFieldColumn(restrict)).toContain("onDelete: 'restrict'")
  })

  it('non-nullable field gets .notNull()', () => {
    const field = makeField('title', {
      column_name: 'title',
      column_type: 'text',
      nullable: false,
    })
    expect(generateFieldColumn(field)).toContain('.notNull()')
  })

  it('nullable field omits .notNull()', () => {
    const field = makeField('subtitle', {
      column_name: 'subtitle',
      column_type: 'text',
      nullable: true,
    })
    expect(generateFieldColumn(field)).not.toContain('.notNull()')
  })

  it('enum varchar has no length argument', () => {
    const field = makeField('status', {
      column_name: 'status',
      column_type: 'varchar',
      nullable: false,
      check_constraint: ['draft', 'review', 'approved'],
    })
    const result = generateFieldColumn(field)
    expect(result).toContain("s.varchar('status')")
    expect(result).not.toContain('length')
  })
})

describe('generateSystemFieldColumn', () => {
  it('uuid PK gets primaryKey().defaultRandom()', () => {
    expect(generateSystemFieldColumn(ID_FIELD)).toBe(
      "s.uuid('id').primaryKey().defaultRandom()",
    )
  })

  it('timestamp with now() default gets .defaultNow()', () => {
    const field: SystemField = {
      name: 'created_at',
      db_type: 'timestamp',
      default: 'now()',
      nullable: false,
    }
    expect(generateSystemFieldColumn(field)).toBe(
      "s.timestamp('created_at').defaultNow().notNull()",
    )
  })

  it('boolean with false default gets .default(false)', () => {
    const field: SystemField = {
      name: 'published',
      db_type: 'boolean',
      default: 'false',
      nullable: false,
    }
    expect(generateSystemFieldColumn(field)).toBe(
      "s.boolean('published').default(false).notNull()",
    )
  })

  it('integer with default 0 gets .default(0)', () => {
    const field: SystemField = {
      name: 'order',
      db_type: 'integer',
      default: '0',
      nullable: false,
    }
    expect(generateSystemFieldColumn(field)).toBe(
      "s.integer('order').default(0).notNull()",
    )
  })
})

// ─── Enum Check Constraints ───────────────────────────────────────────────────

describe('generateSchemaFile — enum check constraints', () => {
  it('content type with enum field produces table-level check constraint', () => {
    const registry = makeEmptyRegistry()
    const ct = makeContentType('blog_post', [
      makeField('status', {
        column_name: 'status',
        column_type: 'varchar',
        nullable: false,
        check_constraint: ['draft', 'review', 'approved'],
      }),
    ])
    registry.content_types['blog_post'] = ct

    const output = generateSchemaFile(registry)
    expect(output).toContain('(table) => ({')
    expect(output).toContain('status_check: s.check(')
    expect(output).toContain("'status_check'")
    expect(output).toContain("'draft', 'review', 'approved'")
  })

  it('content type with no enum fields omits the third pgTable() argument', () => {
    const registry = makeEmptyRegistry()
    const ct = makeContentType('article', [
      makeField('title', {
        column_name: 'title',
        column_type: 'varchar',
        nullable: false,
      }),
    ])
    registry.content_types['article'] = ct

    const output = generateSchemaFile(registry)
    // The content_article table definition should not have a third argument
    const tableStart = output.indexOf("export const content_article")
    const nextExport = output.indexOf('\nexport', tableStart + 1)
    const tableDef =
      nextExport === -1 ? output.slice(tableStart) : output.slice(tableStart, nextExport)
    expect(tableDef).not.toContain('(table) => ({')
  })
})

// ─── Paragraph Topological Sort ───────────────────────────────────────────────

describe('orderParagraphTypes — topological sort', () => {
  it('nested paragraph (A embeds B) sorts B before A', () => {
    const childItem = makeParagraphType('child_item', [])
    const parentCard = makeParagraphType('parent_card', [
      {
        name: 'items',
        label: 'Items',
        field_type: 'paragraph',
        required: false,
        nullable: true,
        order: 0,
        validation: { required: false },
        db_column: null,
        ui_component: {
          component: 'paragraph-embed',
          ref: 'child_item',
          rel: 'one-to-many',
        },
      },
    ])

    // put parent first in insertion order to confirm sorting overrides it
    const result = orderParagraphTypes({
      parent_card: parentCard,
      child_item: childItem,
    })

    expect(result[0]?.name).toBe('child_item')
    expect(result[1]?.name).toBe('parent_card')
  })

  it('flat paragraphs (no nesting) return in stable insertion order', () => {
    const alpha = makeParagraphType('alpha', [])
    const beta = makeParagraphType('beta', [])
    const gamma = makeParagraphType('gamma', [])

    const result = orderParagraphTypes({ alpha, beta, gamma })

    expect(result.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma'])
  })
})

// ─── Junction Tables ──────────────────────────────────────────────────────────

describe('generateSchemaFile — junction tables', () => {
  it('many-to-many field produces junction table with left and right FK columns', () => {
    const registry = makeEmptyRegistry()
    registry.content_types['post'] = makeContentType(
      'post',
      [
        makeField(
          'tags',
          {
            column_name: 'tag_id',
            column_type: 'uuid',
            nullable: false,
            junction: {
              table_name: 'junction_content_post_tags',
              left_column: 'left_id',
              right_column: 'right_id',
              right_table: 'content_tag',
              order_column: false,
            },
          },
          'reference',
        ),
      ],
      [
        {
          table_name: 'junction_content_post_tags',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'content_tag',
          order_column: false,
        },
      ],
    )

    const output = generateSchemaFile(registry)
    expect(output).toContain(
      "export const junction_content_post_tags = s.pgTable(",
    )
    expect(output).toContain("left_id: s.uuid('left_id')")
    expect(output).toContain("right_id: s.uuid('right_id')")
    expect(output).toContain(
      ".references(() => content_post.id, { onDelete: 'cascade' })",
    )
    expect(output).toContain(
      ".references(() => content_tag.id, { onDelete: 'cascade' })",
    )
  })

  it('self-referencing content type produces junction table with both columns pointing to same table', () => {
    const registry = makeEmptyRegistry()
    registry.content_types['blog_post'] = makeContentType(
      'blog_post',
      [],
      [
        {
          table_name: 'junction_content_blog_post_related',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'content_blog_post',
          order_column: false,
        },
      ],
    )

    const output = generateSchemaFile(registry)
    expect(output).toContain(
      "export const junction_content_blog_post_related = s.pgTable(",
    )
    // both FK columns reference the same table
    const junctionStart = output.indexOf(
      'export const junction_content_blog_post_related',
    )
    const junctionDef = output.slice(junctionStart)
    const selfRefCount = (
      junctionDef.match(/references\(\(\) => content_blog_post\.id/g) ?? []
    ).length
    expect(selfRefCount).toBe(2)
  })

  it('ordered relation includes order column', () => {
    const registry = makeEmptyRegistry()
    registry.content_types['post'] = makeContentType(
      'post',
      [],
      [
        {
          table_name: 'junction_content_post_chapters',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'content_chapter',
          order_column: true,
        },
      ],
    )

    const output = generateSchemaFile(registry)
    expect(output).toContain("order: s.integer('order').notNull().default(0)")
  })
})

// ─── Table Output Order ───────────────────────────────────────────────────────

describe('generateSchemaFile — table output order', () => {
  it('sections appear in system → taxonomy → paragraph → content → junction order', () => {
    const registry = makeEmptyRegistry()

    registry.taxonomy_types['tag'] = makeTaxonomyType('tag')

    registry.paragraph_types['card'] = makeParagraphType('card', [])

    registry.content_types['post'] = makeContentType(
      'post',
      [],
      [
        {
          table_name: 'junction_content_post_tags',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'taxonomy_tag',
          order_column: false,
        },
      ],
    )

    const output = generateSchemaFile(registry)

    const systemPos = output.indexOf('// ─── System Tables')
    const taxonomyPos = output.indexOf('// ─── Taxonomy Types')
    const paragraphPos = output.indexOf('// ─── Paragraph Types')
    const contentPos = output.indexOf('// ─── Content Types')
    const junctionPos = output.indexOf('// ─── Junction Tables')

    expect(systemPos).toBeGreaterThanOrEqual(0)
    expect(taxonomyPos).toBeGreaterThanOrEqual(0)
    expect(paragraphPos).toBeGreaterThanOrEqual(0)
    expect(contentPos).toBeGreaterThanOrEqual(0)
    expect(junctionPos).toBeGreaterThanOrEqual(0)

    expect(systemPos).toBeLessThan(taxonomyPos)
    expect(taxonomyPos).toBeLessThan(paragraphPos)
    expect(paragraphPos).toBeLessThan(contentPos)
    expect(contentPos).toBeLessThan(junctionPos)
  })

  it('empty sections are omitted from output', () => {
    const output = generateSchemaFile(makeEmptyRegistry())
    expect(output).not.toContain('// ─── Taxonomy Types')
    expect(output).not.toContain('// ─── Paragraph Types')
    expect(output).not.toContain('// ─── Content Types')
    expect(output).not.toContain('// ─── Junction Tables')
  })
})

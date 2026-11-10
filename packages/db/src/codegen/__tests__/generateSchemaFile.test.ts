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
import { buildSchemaRegistry, parseSchema } from '@bobbykim/manguito-cms-core'
import type { ParsedSchema } from '@bobbykim/manguito-cms-core'
import { testParsedSchema } from '@bobbykim/manguito-cms-test-utils'
import { codegenForeignKeyName } from '../../constraint-names'
import { linkUniqueName } from '../../link-tables'
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
    db: { table_name: `taxonomy_${name}`, junction_tables: [] },
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

  // A tombstone (`removed: true`) retains its column so OLDER live versions
  // can still read it — db codegen must go on emitting it. `generateFieldColumn`
  // keys only off `field_type`, `db_column` and `junction`, never `removed`,
  // so this is already correct; the test pins that so a future "skip removed
  // fields" change in db codegen gets caught. Name and column are deliberately
  // distinct — a tombstone that was renamed before removal carries both — so
  // this can't pass by accident from name/column happening to coincide.
  it('tombstone (removed: true) still emits its retained column, nullable', () => {
    const field: ParsedField = {
      ...makeField('legacy_desc', {
        column_name: 'blog_desc',
        column_type: 'varchar',
        nullable: true,
      }),
      removed: true,
    }
    const result = generateFieldColumn(field)
    expect(result).toContain("s.varchar('blog_desc'")
    expect(result).not.toContain('.notNull()')
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

  function registryWithLink(table: string) {
    const registry = makeEmptyRegistry()
    const jt = {
      table_name: table,
      left_column: 'left_id',
      right_column: 'right_id',
      right_table: 'content_tag',
      order_column: false,
    }
    registry.content_types['post'] = makeContentType(
      'post',
      [
        makeField(
          'tags',
          {
            column_name: 'tag_id',
            column_type: 'uuid',
            nullable: false,
            junction: jt,
          },
          'reference',
        ),
      ],
      [jt],
    )
    return registry
  }

  // MUTATION: emitting `s.unique().on(...)` with no name fails this case.
  it('link table declares a named unique (left, right) constraint', () => {
    const output = generateSchemaFile(
      registryWithLink('junction_content_post_tags'),
    )
    const start = output.indexOf('export const junction_content_post_tags')
    const def = output.slice(start)
    expect(def).toContain('(table) => ({')
    expect(def).toContain(
      "s.unique('junction_content_post_tags_unique').on(table.left_id, table.right_id)",
    )
  })

  // MUTATION: emitting `s.unique().on(...)` with no name, or `<name>_unique`
  // without the long-name fallback, fails this case.
  it('link table with a 60-character name uses the shortened unique name', () => {
    const table = `junction_content_post_${'t'.repeat(38)}`
    expect(table).toHaveLength(60)
    const output = generateSchemaFile(registryWithLink(table))
    const expected = linkUniqueName(table)
    expect(expected).toHaveLength(63)
    expect(output).toContain(
      `s.unique('${expected}').on(table.left_id, table.right_id)`,
    )
  })

  it('self-referencing content type produces junction table with both columns pointing to same table', () => {
    // Short names, so the foreign keys keep their inline references (a long
    // link table names them explicitly; see the #88 tests below).
    const registry = makeEmptyRegistry()
    registry.content_types['post'] = makeContentType(
      'post',
      [],
      [
        {
          table_name: 'junction_content_post_related',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'content_post',
          order_column: false,
        },
      ],
    )

    const output = generateSchemaFile(registry)
    expect(output).toContain(
      "export const junction_content_post_related = s.pgTable(",
    )
    // both FK columns reference the same table
    const junctionStart = output.indexOf(
      'export const junction_content_post_related',
    )
    const junctionDef = output.slice(junctionStart)
    const selfRefCount = (
      junctionDef.match(/references\(\(\) => content_post\.id/g) ?? []
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

  it('a taxonomy type\'s many-to-many field gets its link table (#55)', () => {
    // MUTATION: loop over content types only, or leave junction_tables out of
    // the taxonomy parser. The table is then never migrated, and the admin
    // taxonomy edit screen fails on the missing relation.
    const parsed = parseSchema(
      {
        name: 'taxonomy--tag',
        label: 'Tag',
        type: 'taxonomy-type',
        fields: [
          { name: 'related_tags', label: 'Related', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false },
        ],
      },
      'taxonomy-type',
      'tag.json',
    )
    if (!parsed.ok || parsed.schema.schema_type !== 'taxonomy-type') throw new Error('fixture failed to parse')
    const tag = parsed.schema
    const registry = makeEmptyRegistry()
    registry.taxonomy_types[tag.name] = tag

    const jt = tag.db.junction_tables[0]!
    const output = generateSchemaFile(registry)
    const start = `export const ${jt.table_name} = s.pgTable(`
    expect(output).toContain(start)
    const def = output.slice(output.indexOf(start))
    expect((def.match(/references\(\(\) => taxonomy_tag\.id/g) ?? []).length).toBe(2)
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

  it('nested paragraph: child variable declaration appears before parent in output string', () => {
    const registry = makeEmptyRegistry()
    const child = makeParagraphType('child_item', [])
    const parent = makeParagraphType('parent_card', [
      {
        name: 'items',
        label: 'Items',
        field_type: 'paragraph',
        required: false,
        nullable: true,
        order: 0,
        validation: { required: false },
        db_column: null,
        ui_component: { component: 'paragraph-embed', ref: 'child_item', rel: 'one-to-many' },
      },
    ])
    // insert parent first — confirms topological sort overrides insertion order
    registry.paragraph_types['parent_card'] = parent
    registry.paragraph_types['child_item'] = child

    const output = generateSchemaFile(registry)

    const childPos = output.indexOf("export const paragraph_child_item =")
    const parentPos = output.indexOf("export const paragraph_parent_card =")

    expect(childPos).toBeGreaterThanOrEqual(0)
    expect(parentPos).toBeGreaterThanOrEqual(0)
    expect(childPos).toBeLessThan(parentPos)
  })
})

// ─── Long foreign-key names (#88) ─────────────────────────────────────────────

describe('generateSchemaFile — long foreign-key names (#88)', () => {
  type Raw = Record<string, unknown>
  const parseOrThrow = (raw: Raw, type: 'content-type' | 'taxonomy-type' | 'paragraph-type'): ParsedSchema => {
    const result = parseSchema(raw, type, `${String(raw['name'])}.json`)
    if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
    return result.schema
  }
  const text: Raw = { name: 'title', label: 'Title', type: 'text/plain', required: false }
  const tag = parseOrThrow({ name: 'taxonomy--tag', label: 'Tag', type: 'taxonomy-type', fields: [text] }, 'taxonomy-type')
  const post = (name: string, fields: Raw[]): ParsedSchema =>
    parseOrThrow(
      { name, label: name, type: 'content-type', default_base_path: 'posts', only_one: false, fields: [{ tab: { name: 'main', label: 'Main', fields } }] },
      'content-type',
    )
  const registryOf = (...schemas: ParsedSchema[]): SchemaRegistry =>
    buildSchemaRegistry(schemas, { base_paths: [] }, { roles: [], valid_permissions: [] })
  const field = (name: string, extra: Raw = {}): Raw => ({ name, label: name, type: 'reference', target: 'taxonomy--tag', rel: 'one-to-one', required: false, ...extra })
  const tableOf = (output: string, table: string): string => {
    const start = output.indexOf(`export const ${table} = s.pgTable(`)
    expect(start).toBeGreaterThan(-1)
    const next = output.indexOf('\nexport const ', start + 1)
    return next === -1 ? output.slice(start) : output.slice(start, next)
  }

  const LONG_TYPE = 'content--a_long_content_type_name'
  const LONG_FIELD = 'a_long_reference_field_name'
  const OWNER_TABLE = 'content_a_long_content_type_name'

  it('names a long link table\'s foreign keys explicitly and drops their inline references', () => {
    // MUTATION: keep the inline `.references(...)` as well as the explicit key.
    // The `left_id:` line then holds `.references(`, and drizzle plans a second,
    // default-named foreign key.
    const owner = post(LONG_TYPE, [field('tags_with_a_rather_long_name', { rel: 'many-to-many' })])
    const registry = registryOf(tag, owner)
    const jt = registry.content_types[LONG_TYPE]!.db.junction_tables[0]!
    const left = codegenForeignKeyName(jt.table_name, 'left_id', OWNER_TABLE, 'id')
    const def = tableOf(generateSchemaFile(registry), jt.table_name)
    expect(foreignKeyNameLength(jt.table_name, 'left_id', OWNER_TABLE)).toBeGreaterThan(63)
    expect(def).toContain(`s.foreignKey({ name: '${left}'`)
    expect(def).toContain(`s.foreignKey({ name: '${codegenForeignKeyName(jt.table_name, 'right_id', 'taxonomy_tag', 'id')}'`)
    expect(def).toContain(".onDelete('cascade')")
    const leftLine = def.split('\n').find((l) => l.trimStart().startsWith('left_id:'))!
    expect(leftLine).not.toContain('.references(')
    expect(def).not.toContain('.references(')
  })

  it('gives a self-referencing long type two differently named foreign keys', () => {
    // MUTATION: hash the table name only. The two columns then share a
    // 51-character prefix and a hash, so both foreign keys get one name.
    const type = 'taxonomy--a_very_long_self_referencing_taxonomy_type_name'
    const self = parseOrThrow(
      { name: type, label: 'Self', type: 'taxonomy-type', fields: [text, field('parent', { target: type }), field('related', { target: type })] },
      'taxonomy-type',
    )
    const output = generateSchemaFile(registryOf(self))
    const def = tableOf(output, type.replace('--', '_'))
    const names = [...def.matchAll(/s\.foreignKey\(\{ name: '([^']+)'/g)].map((m) => m[1]!)
    expect(names).toHaveLength(2)
    expect(names[0]).not.toBe(names[1])
    expect(names.every((n) => n.length === 63)).toBe(true)
    // MUTATION: target the table's own exported const. It is then read inside
    // its own initializer, which tsc reports as implicitly any (TS7022).
    expect(def).toContain('foreignColumns: [table.id]')
    expect(def).not.toContain(`foreignColumns: [${type.replace('--', '_')}.id]`)
  })

  it('emits a constraint callback for a long reference when the type has no enum', () => {
    // MUTATION: emit the callback only when enum fields exist. The explicit
    // foreign key is then dropped, and so is the column's only foreign key.
    const output = generateSchemaFile(registryOf(tag, post(LONG_TYPE, [field(LONG_FIELD)])))
    const def = tableOf(output, OWNER_TABLE)
    expect(def).toContain('(table) => ({')
    expect(def).toContain(`${LONG_FIELD}_fk: s.foreignKey({ name: '${codegenForeignKeyName(OWNER_TABLE, LONG_FIELD, 'taxonomy_tag', 'id')}'`)
    expect(def).toContain(`columns: [table.${LONG_FIELD}]`)
    expect(def).toContain('foreignColumns: [taxonomy_tag.id]')
    expect(def).not.toContain('s.check(')
    expect(def).not.toContain('.references(')
  })

  it('puts a long foreign key and an enum check in one callback', () => {
    // MUTATION: a second callback argument for the foreign keys. pgTable then
    // takes two callbacks and drizzle ignores one.
    const enumField: Raw = { name: 'status', label: 'Status', type: 'enum', values: ['a', 'b'], required: false }
    const output = generateSchemaFile(registryOf(tag, post(LONG_TYPE, [field(LONG_FIELD), enumField])))
    const def = tableOf(output, OWNER_TABLE)
    expect(def.match(/\(table\) => \(\{/g)).toHaveLength(1)
    expect(def).toContain('s.check(')
    expect(def).toContain('s.foreignKey(')
  })

  it('names a long media column\'s foreign key on the media table', () => {
    // MUTATION: emit foreign keys for type tables only. The paragraph table
    // keeps no explicit key and drizzle's long name returns.
    const para = parseOrThrow(
      { name: 'paragraph--a_paragraph_type_with_a_long_name', label: 'P', type: 'paragraph-type', fields: [{ name: 'a_rather_long_media_column_name', label: 'M', type: 'image', required: false, max_size: '2MB', alt: true }] },
      'paragraph-type',
    )
    const output = generateSchemaFile(registryOf(para))
    const def = tableOf(output, 'paragraph_a_paragraph_type_with_a_long_name')
    expect(def).toContain('s.foreignKey(')
    expect(def).toContain('foreignColumns: [media.id]')
    expect(def).toContain(`'${codegenForeignKeyName('paragraph_a_paragraph_type_with_a_long_name', 'a_rather_long_media_column_name', 'media', 'id')}'`)
  })

  it('maps the foreign key\'s on_delete into the explicit key', () => {
    // MUTATION: hard-code `'cascade'`. A non-required reference is SET NULL.
    const output = generateSchemaFile(registryOf(tag, post(LONG_TYPE, [field(LONG_FIELD)])))
    const def = tableOf(output, OWNER_TABLE)
    expect(def).toContain(".onDelete('set null')")
    expect(def).not.toContain(".onDelete('cascade')")
  })

  it('keeps inline references for names within 63 characters', () => {
    // MUTATION: always emit explicit foreign keys (for link tables; the
    // snapshot test covers type tables). The short link table then loses its
    // inline `.references(`.
    const owner = post('content--short', [field('tags', { rel: 'many-to-many' })])
    const output = generateSchemaFile(registryOf(tag, owner))
    expect(output).not.toContain('s.foreignKey(')
    expect(output).toContain('.references(')
  })
})

function foreignKeyNameLength(table: string, column: string, target: string): number {
  return `${table}_${column}_${target}_id_fk`.length
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

describe('generateSchemaFile — snapshot', () => {
  it('matches snapshot for testParsedSchema fixture', () => {
    expect(generateSchemaFile(testParsedSchema)).toMatchSnapshot()
  })
})

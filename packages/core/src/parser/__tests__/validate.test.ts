import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'
import { buildSchemaRegistry, validateCrossReferences } from '../validate'
import type {
  ParsedRoutes,
  ParsedRoles,
  SchemaRegistry,
} from '../validate'
import type { ParsedParagraphType, ParsedContentType, ParsedEnumType } from '../parseSchema'
import type { ParsedField, FieldType, RelationType } from '../../registry/types'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

// ─── Schema factories (via parseSchema) ──────────────────────────────────────

function makeContentType(
  name: string,
  fields: unknown[] = [],
  sourceFile = `schemas/content-types/${name}.json`
) {
  return parseSchema(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'blog',
      only_one: false,
      fields: [
        { tab: { name: 'primary_tab', label: 'Primary', fields: fields.length ? fields : [{ name: 'title', label: 'Title', type: 'text/plain', required: true }] } },
      ],
    },
    'content-type',
    sourceFile
  )
}

function makeParagraphType(
  name: string,
  fields: unknown[] = [],
  sourceFile = `schemas/paragraph-types/${name}.json`
) {
  return parseSchema(
    { name, label: name, type: 'paragraph-type', fields },
    'paragraph-type',
    sourceFile
  )
}

function makeTaxonomyType(
  name: string,
  sourceFile = `schemas/taxonomy-types/${name}.json`
) {
  return parseSchema(
    { name, label: name, type: 'taxonomy-type', fields: [] },
    'taxonomy-type',
    sourceFile
  )
}

function makeEnumType(
  name: string,
  values: string[] = ['a', 'b'],
  sourceFile = `schemas/enum-types/${name}.json`
) {
  return parseSchema(
    { name, label: name, type: 'enum-type', values },
    'enum-type',
    sourceFile
  )
}

// Helpers to extract parsed schemas from ParseResult (throws if parse failed — test bug)
function okSchema<T>(result: ReturnType<typeof parseSchema>): T {
  if (!result.ok) throw new Error(`Expected parse success but got errors: ${JSON.stringify(result.errors)}`)
  return result.schema as T
}

// ─── Helper: manually build a paragraph type with paragraph fields ─────────────────

function makeParagraphTypeWithParagraphRefs(
  name: string,
  refs: string[],
  sourceFile = `schemas/paragraph-types/${name}.json`
): ParsedParagraphType {
  const fields: ParsedField[] = refs.map((ref, i) => ({
    name: `ref_field_${i}`,
    label: `Ref Field ${i}`,
    field_type: 'paragraph' as FieldType,
    required: false,
    nullable: true,
    order: i,
    validation: { required: false },
    db_column: null,
    ui_component: { component: 'paragraph-embed' as const, ref, rel: 'one-to-many' as RelationType },
  }))

  return {
    schema_type: 'paragraph-type',
    name,
    label: name,
    source_file: sourceFile,
    system_fields: [],
    fields,
    db: { table_name: name.replace('--', '_') },
  }
}

// ─── buildSchemaRegistry ──────────────────────────────────────────────────────

describe('buildSchemaRegistry', () => {
  it('assembles schemas into correct typed maps', () => {
    const content = okSchema<ParsedContentType>(makeContentType('content--blog_post'))
    const para = okSchema<ParsedParagraphType>(makeParagraphType('paragraph--photo_card'))
    const tax = okSchema<ReturnType<typeof makeTaxonomyType> extends { ok: true; schema: infer S } ? S : never>(makeTaxonomyType('taxonomy--daily_post'))
    const enumSchema = okSchema<ParsedEnumType>(makeEnumType('enum--link_target', ['_self', '_blank']))

    const registry = buildSchemaRegistry(
      [content, para, tax as ParsedContentType, enumSchema],
      EMPTY_ROUTES,
      EMPTY_ROLES
    )

    expect(registry.schemas['content--blog_post']).toBeDefined()
    expect(registry.content_types['content--blog_post']).toBeDefined()
    expect(registry.schemas['paragraph--photo_card']).toBeDefined()
    expect(registry.paragraph_types['paragraph--photo_card']).toBeDefined()
    expect(registry.schemas['taxonomy--daily_post']).toBeDefined()
    expect(registry.taxonomy_types['taxonomy--daily_post']).toBeDefined()
    expect(registry.schemas['enum--link_target']).toBeDefined()
    expect(registry.enum_types['enum--link_target']).toBeDefined()
  })

  it('preserves all_schemas including duplicates', () => {
    const a = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'file_a.json'))
    const b = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'file_b.json'))

    const registry = buildSchemaRegistry([a, b], EMPTY_ROUTES, EMPTY_ROLES)

    expect(registry.all_schemas).toHaveLength(2)
    expect(registry.schemas['content--blog_post']?.source_file).toBe('file_b.json') // last-write-wins
  })

  it('attaches routes and roles to the registry', () => {
    const routes: ParsedRoutes = { base_paths: [{ name: 'blog', path: '/blog' }] }
    const roles: ParsedRoles = {
      roles: [{ name: 'admin', label: 'Admin', hierarchy_level: 0, permissions: ['*'] }],
      valid_permissions: ['*'],
    }
    const registry = buildSchemaRegistry([], routes, roles)

    expect(registry.routes.base_paths).toHaveLength(1)
    expect(registry.roles.roles[0]?.name).toBe('admin')
  })

  it('resolves enum refs: populates allowed_values and options from enum-type', () => {
    const enumSchema = okSchema<ParsedEnumType>(makeEnumType('enum--status', ['draft', 'published']))

    // Content type with an enum ref field
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'status', label: 'Status', type: 'enum', ref: 'enum--status', required: true },
                ],
              },
            },
          ],
        },
        'content-type',
        'content--article.json'
      )
    )

    // Before registry: allowed_values is empty (deferred)
    expect(content.fields[0]?.validation.allowed_values).toEqual([])

    const registry = buildSchemaRegistry([content, enumSchema], EMPTY_ROUTES, EMPTY_ROLES)

    // After registry: resolved from enum-type
    const statusField = registry.content_types['content--article']?.fields[0]!
    expect(statusField.validation.allowed_values).toEqual(['draft', 'published'])
    expect(statusField.db_column?.check_constraint).toEqual(['draft', 'published'])
    const ui = statusField.ui_component as { component: string; options: string[] }
    expect(ui.options).toEqual(['draft', 'published'])
  })

  it('leaves enum ref fields unresolved when the enum schema does not exist', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'status', label: 'Status', type: 'enum', ref: 'enum--missing', required: true },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    // Build without the referenced enum — should not throw, should leave empty
    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const statusField = registry.content_types['content--article']?.fields[0]!
    expect(statusField.validation.allowed_values).toEqual([]) // unresolved
  })
})

// ─── validateCrossReferences — DUPLICATE_SCHEMA_NAME ─────────────────────────

describe('validateCrossReferences — DUPLICATE_SCHEMA_NAME', () => {
  it('emits DUPLICATE_SCHEMA_NAME when two schemas share the same machine name', () => {
    const a = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'file_a.json'))
    const b = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'file_b.json'))

    const registry = buildSchemaRegistry([a, b], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    const dupe = errors.filter((e) => e.code === 'DUPLICATE_SCHEMA_NAME')
    expect(dupe).toHaveLength(1)
    expect(dupe[0]?.file).toBe('file_b.json') // second occurrence
    expect(dupe[0]?.message).toContain('content--blog_post')
    expect(dupe[0]?.message).toContain('file_a.json') // names first occurrence
  })

  it('reports multiple duplicates independently', () => {
    const a = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'a.json'))
    const b = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'b.json'))
    const c = okSchema<ParsedContentType>(makeContentType('content--blog_post', [], 'c.json'))

    const registry = buildSchemaRegistry([a, b, c], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    const dupes = errors.filter((e) => e.code === 'DUPLICATE_SCHEMA_NAME')
    expect(dupes).toHaveLength(2) // b and c are duplicates of a
  })

  it('emits no DUPLICATE_SCHEMA_NAME when all names are unique', () => {
    const a = okSchema<ParsedContentType>(makeContentType('content--blog_post'))
    const b = okSchema<ParsedParagraphType>(makeParagraphType('paragraph--photo_card'))

    const registry = buildSchemaRegistry([a, b], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    expect(errors.filter((e) => e.code === 'DUPLICATE_SCHEMA_NAME')).toHaveLength(0)
  })
})

// ─── validateCrossReferences — UNKNOWN_REF ────────────────────────────────────

describe('validateCrossReferences — UNKNOWN_REF', () => {
  it('emits UNKNOWN_REF when a paragraph field refs a non-existent paragraph type', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
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
                  {
                    name: 'cards',
                    label: 'Cards',
                    type: 'paragraph',
                    ref: 'paragraph--ghost',
                    rel: 'one-to-many',
                    required: false,
                  },
                ],
              },
            },
          ],
        },
        'content-type',
        'content--blog_post.json'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    const unknownRef = errors.filter((e) => e.code === 'UNKNOWN_REF')
    expect(unknownRef).toHaveLength(1)
    expect(unknownRef[0]?.message).toContain('paragraph--ghost')
    expect(unknownRef[0]?.file).toBe('content--blog_post.json')
    expect(unknownRef[0]?.path).toBe('fields[0].ref')
  })

  it('emits UNKNOWN_REF when a reference field targets a non-existent schema', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
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
                  {
                    name: 'category',
                    label: 'Category',
                    type: 'reference',
                    target: 'taxonomy--ghost',
                    rel: 'one-to-one',
                    required: false,
                  },
                ],
              },
            },
          ],
        },
        'content-type',
        'content--blog_post.json'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    const unknownRef = errors.filter((e) => e.code === 'UNKNOWN_REF')
    expect(unknownRef).toHaveLength(1)
    expect(unknownRef[0]?.message).toContain('taxonomy--ghost')
    expect(unknownRef[0]?.path).toBe('fields[0].target')
  })

  it('emits UNKNOWN_REF when an enum ref field refs a non-existent enum-type', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'status', label: 'Status', type: 'enum', ref: 'enum--missing', required: true },
                ],
              },
            },
          ],
        },
        'content-type',
        'content--article.json'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    const unknownRef = errors.filter((e) => e.code === 'UNKNOWN_REF')
    expect(unknownRef).toHaveLength(1)
    expect(unknownRef[0]?.message).toContain('enum--missing')
    expect(unknownRef[0]?.path).toBe('fields[0].ref')
  })

  it('emits no UNKNOWN_REF when all refs resolve correctly', () => {
    const para = okSchema<ParsedParagraphType>(makeParagraphType('paragraph--photo_card'))
    const tax = okSchema(makeTaxonomyType('taxonomy--daily_post'))
    const enumSchema = okSchema<ParsedEnumType>(makeEnumType('enum--status', ['draft', 'published']))

    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
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
                  { name: 'cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--photo_card', rel: 'one-to-many', required: false },
                  { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--daily_post', rel: 'one-to-one', required: false },
                  { name: 'status', label: 'Status', type: 'enum', ref: 'enum--status', required: true },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry(
      [content, para, tax as ParsedContentType, enumSchema],
      EMPTY_ROUTES,
      EMPTY_ROLES
    )
    const errors = validateCrossReferences(registry)

    expect(errors.filter((e) => e.code === 'UNKNOWN_REF')).toHaveLength(0)
  })
})

// ─── validateCrossReferences — INVALID_REF_TARGET ────────────────────────────

describe('validateCrossReferences — INVALID_REF_TARGET', () => {
  it('emits INVALID_REF_TARGET when a paragraph field refs a schema that exists but is not a paragraph-type', () => {
    // Manually construct a registry with a paragraph field pointing at a content type.
    // (Zod validators prevent this via normal parsing, so we construct directly.)
    const contentSchema: ParsedContentType = {
      schema_type: 'content-type',
      name: 'content--blog_post',
      label: 'Blog Post',
      source_file: 'content--blog_post.json',
      only_one: false,
      default_base_path: 'blog',
      system_fields: [],
      fields: [],
      ui: { tabs: [] },
      db: { table_name: 'content_blog_post', junction_tables: [] },
      api: { default_base_path: 'blog', http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], collection_path: '/api/blog-post', item_path: '/api/blog-post/:slug' },
    }

    // A paragraph type that has a paragraph field pointing at content--blog_post
    const paraWithBadRef = makeParagraphTypeWithParagraphRefs(
      'paragraph--photo_card',
      ['content--blog_post'],
      'paragraph--photo_card.json'
    )

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: {
        'content--blog_post': contentSchema,
        'paragraph--photo_card': paraWithBadRef,
      },
      content_types: { 'content--blog_post': contentSchema },
      paragraph_types: { 'paragraph--photo_card': paraWithBadRef },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [contentSchema, paraWithBadRef],
    }

    const errors = validateCrossReferences(registry)

    const invalidTarget = errors.filter((e) => e.code === 'INVALID_REF_TARGET')
    expect(invalidTarget).toHaveLength(1)
    expect(invalidTarget[0]?.message).toContain('content--blog_post')
    expect(invalidTarget[0]?.message).toContain('not a paragraph-type')
  })

  it('emits INVALID_REF_TARGET when a reference field targets a schema that exists but is not content/taxonomy', () => {
    // Construct a reference field that points at a paragraph-type (impossible
    // through normal parsing, tested via direct registry construction).
    const paraTarget = okSchema<ParsedParagraphType>(makeParagraphType('paragraph--photo_card'))

    // Construct the content schema manually with the wrong target type
    const fieldWithBadTarget: ParsedField = {
      name: 'bad_ref',
      label: 'Bad Ref',
      field_type: 'reference',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'bad_ref', column_type: 'uuid', nullable: true },
      ui_component: { component: 'typeahead-select', ref: 'paragraph--photo_card', rel: 'one-to-one' },
    }

    const contentSchema: ParsedContentType = {
      schema_type: 'content-type',
      name: 'content--blog_post',
      label: 'Blog Post',
      source_file: 'content--blog_post.json',
      only_one: false,
      default_base_path: 'blog',
      system_fields: [],
      fields: [fieldWithBadTarget],
      ui: { tabs: [] },
      db: { table_name: 'content_blog_post', junction_tables: [] },
      api: { default_base_path: 'blog', http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], collection_path: '/api/blog-post', item_path: '/api/blog-post/:slug' },
    }

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: {
        'content--blog_post': contentSchema,
        'paragraph--photo_card': paraTarget,
      },
      content_types: { 'content--blog_post': contentSchema },
      paragraph_types: { 'paragraph--photo_card': paraTarget },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [contentSchema, paraTarget],
    }

    const errors = validateCrossReferences(registry)

    const invalidTarget = errors.filter((e) => e.code === 'INVALID_REF_TARGET')
    expect(invalidTarget).toHaveLength(1)
    expect(invalidTarget[0]?.message).toContain('paragraph--photo_card')
    expect(invalidTarget[0]?.message).toContain('not a content-type or taxonomy-type')
  })
})

// ─── validateCrossReferences — CIRCULAR_REFERENCE ────────────────────────────

describe('validateCrossReferences — CIRCULAR_REFERENCE', () => {
  it('emits CIRCULAR_REFERENCE for a direct self-reference (A → A)', () => {
    const a = makeParagraphTypeWithParagraphRefs('paragraph--a', ['paragraph--a'], 'a.json')

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'paragraph--a': a },
      content_types: {},
      paragraph_types: { 'paragraph--a': a },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [a],
    }

    const errors = validateCrossReferences(registry)
    const circular = errors.filter((e) => e.code === 'CIRCULAR_REFERENCE')

    expect(circular).toHaveLength(1)
    expect(circular[0]?.message).toContain('paragraph--a')
    expect(circular[0]?.code).toBe('CIRCULAR_REFERENCE')
  })

  it('emits CIRCULAR_REFERENCE for a two-node cycle (A → B → A)', () => {
    const a = makeParagraphTypeWithParagraphRefs('paragraph--a', ['paragraph--b'], 'a.json')
    const b = makeParagraphTypeWithParagraphRefs('paragraph--b', ['paragraph--a'], 'b.json')

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'paragraph--a': a, 'paragraph--b': b },
      content_types: {},
      paragraph_types: { 'paragraph--a': a, 'paragraph--b': b },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [a, b],
    }

    const errors = validateCrossReferences(registry)
    const circular = errors.filter((e) => e.code === 'CIRCULAR_REFERENCE')

    expect(circular).toHaveLength(1)
    expect(circular[0]?.message).toContain('paragraph--a')
    expect(circular[0]?.message).toContain('paragraph--b')
    expect(circular[0]?.message).toMatch(/→/)
  })

  it('emits CIRCULAR_REFERENCE for a three-node cycle (A → B → C → A)', () => {
    const a = makeParagraphTypeWithParagraphRefs('paragraph--a', ['paragraph--b'], 'a.json')
    const b = makeParagraphTypeWithParagraphRefs('paragraph--b', ['paragraph--c'], 'b.json')
    const c = makeParagraphTypeWithParagraphRefs('paragraph--c', ['paragraph--a'], 'c.json')

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'paragraph--a': a, 'paragraph--b': b, 'paragraph--c': c },
      content_types: {},
      paragraph_types: { 'paragraph--a': a, 'paragraph--b': b, 'paragraph--c': c },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [a, b, c],
    }

    const errors = validateCrossReferences(registry)
    const circular = errors.filter((e) => e.code === 'CIRCULAR_REFERENCE')

    expect(circular).toHaveLength(1)
    expect(circular[0]?.message).toContain('paragraph--a')
    expect(circular[0]?.message).toContain('paragraph--b')
    expect(circular[0]?.message).toContain('paragraph--c')
  })

  it('emits no CIRCULAR_REFERENCE for a valid linear chain (A → B, no cycle)', () => {
    const a = makeParagraphTypeWithParagraphRefs('paragraph--a', ['paragraph--b'], 'a.json')
    const b = makeParagraphTypeWithParagraphRefs('paragraph--b', [], 'b.json')

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'paragraph--a': a, 'paragraph--b': b },
      content_types: {},
      paragraph_types: { 'paragraph--a': a, 'paragraph--b': b },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [a, b],
    }

    const errors = validateCrossReferences(registry)
    expect(errors.filter((e) => e.code === 'CIRCULAR_REFERENCE')).toHaveLength(0)
  })

  it('does not follow edges to unknown paragraph refs when detecting cycles', () => {
    // A refs B (unknown) and C. C refs A. Should only detect A → C → A.
    const a = makeParagraphTypeWithParagraphRefs('paragraph--a', ['paragraph--ghost', 'paragraph--c'], 'a.json')
    const c = makeParagraphTypeWithParagraphRefs('paragraph--c', ['paragraph--a'], 'c.json')

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'paragraph--a': a, 'paragraph--c': c },
      content_types: {},
      paragraph_types: { 'paragraph--a': a, 'paragraph--c': c },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [a, c],
    }

    const errors = validateCrossReferences(registry)
    const circular = errors.filter((e) => e.code === 'CIRCULAR_REFERENCE')
    expect(circular).toHaveLength(1) // only A → C → A
    expect(circular[0]?.message).toContain('paragraph--a')
    expect(circular[0]?.message).toContain('paragraph--c')
  })
})

// ─── validateCrossReferences — MAX_SIZE_EXCEEDS_GLOBAL_LIMIT ─────────────────

describe('validateCrossReferences — MAX_SIZE_EXCEEDS_GLOBAL_LIMIT', () => {
  it('emits MAX_SIZE_EXCEEDS_GLOBAL_LIMIT when a media field exceeds the global limit', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'hero', label: 'Hero', type: 'image', max_size: '10MB', required: false },
                ],
              },
            },
          ],
        },
        'content-type',
        'content--article.json'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const globalLimit = 4 * 1024 * 1024 // 4 MB
    const errors = validateCrossReferences(registry, globalLimit)

    const exceeded = errors.filter((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')
    expect(exceeded).toHaveLength(1)
    expect(exceeded[0]?.message).toContain('hero')
    expect(exceeded[0]?.file).toBe('content--article.json')
    expect(exceeded[0]?.path).toBe('fields[0].max_size')
  })

  it('emits no MAX_SIZE_EXCEEDS_GLOBAL_LIMIT when all max_size values are within the limit', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'hero', label: 'Hero', type: 'image', max_size: '2MB', required: false },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const globalLimit = 4 * 1024 * 1024 // 4 MB

    const errors = validateCrossReferences(registry, globalLimit)
    expect(errors.filter((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')).toHaveLength(0)
  })

  it('skips MAX_SIZE_EXCEEDS_GLOBAL_LIMIT check when globalMaxFileSize is not provided', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'hero', label: 'Hero', type: 'image', max_size: '100MB', required: false },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    // No globalMaxFileSize provided — check should be skipped
    const errors = validateCrossReferences(registry)
    expect(errors.filter((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')).toHaveLength(0)
  })

  it('checks video and file fields in addition to image', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'clip', label: 'Clip', type: 'video', max_size: '50MB', required: false },
                  { name: 'brochure', label: 'Brochure', type: 'file', max_size: '20MB', required: false },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const globalLimit = 4 * 1024 * 1024 // 4 MB

    const errors = validateCrossReferences(registry, globalLimit)
    const exceeded = errors.filter((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')

    expect(exceeded).toHaveLength(2) // both clip and brochure exceed the limit
    const names = exceeded.map((e) => e.message)
    expect(names.some((m) => m.includes('clip'))).toBe(true)
    expect(names.some((m) => m.includes('brochure'))).toBe(true)
  })

  it('emits no error for media fields without max_size set', () => {
    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
          name: 'content--article',
          label: 'Article',
          type: 'content-type',
          default_base_path: 'blog',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'primary_tab',
                label: 'Primary',
                fields: [
                  { name: 'hero', label: 'Hero', type: 'image', required: false }, // no max_size
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry([content], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry, 1024) // very small limit

    expect(errors.filter((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')).toHaveLength(0)
  })
})

// ─── validateCrossReferences — clean registry ─────────────────────────────────

describe('validateCrossReferences — no errors on a fully valid registry', () => {
  it('returns an empty error array for a well-formed registry', () => {
    const para = okSchema<ParsedParagraphType>(makeParagraphType('paragraph--photo_card'))
    const tax = okSchema(makeTaxonomyType('taxonomy--daily_post'))
    const enumSchema = okSchema<ParsedEnumType>(makeEnumType('enum--status', ['draft', 'published']))

    const content = okSchema<ParsedContentType>(
      parseSchema(
        {
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
                  { name: 'hero', label: 'Hero', type: 'image', max_size: '2MB', required: false },
                  { name: 'cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--photo_card', rel: 'one-to-many', required: false },
                  { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--daily_post', rel: 'one-to-one', required: false },
                  { name: 'status', label: 'Status', type: 'enum', ref: 'enum--status', required: true },
                ],
              },
            },
          ],
        },
        'content-type'
      )
    )

    const registry = buildSchemaRegistry(
      [content, para, tax as ParsedContentType, enumSchema],
      EMPTY_ROUTES,
      EMPTY_ROLES
    )
    const globalLimit = 4 * 1024 * 1024

    expect(validateCrossReferences(registry, globalLimit)).toHaveLength(0)
  })
})

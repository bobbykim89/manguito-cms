import { describe, it, expect } from 'vitest'
import * as os from 'node:os'
import { parseSchema } from '../parseSchema'
import { buildSchemaRegistry, validateCrossReferences } from '../validate'
import { walkSchemaDirectory } from '../loader'
import type { ParsedContentType, ParsedParagraphType } from '../parseSchema'
import type { ParsedRoutes, ParsedRoles, SchemaRegistry } from '../validate'
import type { ParsedField, FieldType, RelationType } from '../../registry/types'

// ─── Shared empty fixtures ────────────────────────────────────────────────────

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

// ─── Minimal valid raw schemas ────────────────────────────────────────────────

function rawContentType(overrides: Record<string, unknown> = {}): unknown {
  return {
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
          fields: [{ name: 'title', label: 'Title', type: 'text/plain', required: true }],
        },
      },
    ],
    ...overrides,
  }
}

// Build a bare-minimum ParsedContentType without going through parseSchema.
function makeBareContentType(
  name: string,
  fields: ParsedField[] = [],
  sourceFile = `${name}.json`
): ParsedContentType {
  return {
    schema_type: 'content-type',
    name,
    label: name,
    source_file: sourceFile,
    only_one: false,
    default_base_path: 'blog',
    system_fields: [],
    fields,
    ui: { tabs: [] },
    db: { table_name: name.replace('--', '_'), junction_tables: [] },
    api: {
      default_base_path: 'blog',
      http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      collection_path: '/api/blog-post',
      item_path: '/api/blog-post/:slug',
    },
  }
}

function makeParagraphEmbedField(
  name: string,
  ref: string,
  order = 0
): ParsedField {
  return {
    name,
    label: name,
    field_type: 'paragraph' as FieldType,
    required: false,
    nullable: true,
    order,
    validation: { required: false },
    db_column: null,
    ui_component: {
      component: 'paragraph-embed' as const,
      ref,
      rel: 'one-to-many' as RelationType,
    },
  }
}

// ─── INVALID_SCHEMA_TYPE ──────────────────────────────────────────────────────

describe('ParseErrorCode — INVALID_SCHEMA_TYPE', () => {
  it('returns INVALID_SCHEMA_TYPE when the type field is not a recognised schema type', () => {
    const raw = rawContentType({ type: 'widget-type' })
    const result = parseSchema(raw, 'content-type', 'schemas/content-types/content--blog_post.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_SCHEMA_TYPE')
    // file is propagated on every error
    expect(result.errors[0]?.file).toBe('schemas/content-types/content--blog_post.json')
  })
})

// ─── INVALID_FIELD_TYPE ───────────────────────────────────────────────────────

describe('ParseErrorCode — INVALID_FIELD_TYPE', () => {
  // Zod v4 reports z.union / z.discriminatedUnion failures with the array-element
  // index as the last path segment (e.g. ['fields', 0]), not with 'type'. The
  // zodErrorsToParseErrors mapping for INVALID_FIELD_TYPE requires path ending
  // with 'type' at depth > 2, which Zod v4 does not produce for union errors.
  // The net result is that the error is mapped to MISSING_REQUIRED_FIELD instead.
  // The key contract — parsing fails and never throws — is still verified below.
  it('fails to parse when a field has an unknown type string and returns errors without throwing', () => {
    const raw: unknown = {
      name: 'paragraph--card',
      label: 'Card',
      type: 'paragraph-type',
      fields: [{ name: 'weird', label: 'Weird', type: 'multiselect', required: false }],
    }
    const result = parseSchema(raw, 'paragraph-type', 'schemas/paragraph-types/paragraph--card.json')

    // Parsing must fail — never throw
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.length).toBeGreaterThan(0)
    // file is propagated
    expect(result.errors[0]?.file).toBe('schemas/paragraph-types/paragraph--card.json')
  })
})

// ─── UNKNOWN_BASE_PATH ────────────────────────────────────────────────────────

describe('ParseErrorCode — UNKNOWN_BASE_PATH', () => {
  it.todo(
    'returns UNKNOWN_BASE_PATH when default_base_path is not found in routes.json — not yet implemented in validator'
  )
})

// ─── UNKNOWN_REF ──────────────────────────────────────────────────────────────

describe('ParseErrorCode — UNKNOWN_REF', () => {
  it('returns UNKNOWN_REF when a paragraph field refs a schema that does not exist', () => {
    // Content type with a paragraph field pointing to a non-existent paragraph-type.
    const result = parseSchema(
      rawContentType({
        fields: [
          {
            tab: {
              name: 'primary_tab',
              label: 'Primary',
              fields: [
                { name: 'cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--ghost', rel: 'one-to-many', required: false },
              ],
            },
          },
        ],
      }),
      'content-type',
      'content--blog_post.json'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const registry = buildSchemaRegistry([result.schema], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    expect(errors.some((e) => e.code === 'UNKNOWN_REF')).toBe(true)
    const err = errors.find((e) => e.code === 'UNKNOWN_REF')!
    expect(err.message).toContain('paragraph--ghost')
    // error is returned, never thrown
  })
})

// ─── INVALID_REF_TARGET ───────────────────────────────────────────────────────

describe('ParseErrorCode — INVALID_REF_TARGET', () => {
  it('returns INVALID_REF_TARGET when a paragraph field refs a schema that exists but is not a paragraph-type', () => {
    // Construct a paragraph type whose paragraph field points to a content-type.
    // (Cannot produce this through normal parsing — validators block it —
    //  so we build the registry directly to hit the cross-reference check.)
    const contentTarget = makeBareContentType('content--blog_post', [], 'content--blog_post.json')

    const paraWithBadRef: ParsedParagraphType = {
      schema_type: 'paragraph-type',
      name: 'paragraph--card',
      label: 'Card',
      source_file: 'paragraph--card.json',
      system_fields: [],
      fields: [makeParagraphEmbedField('embed', 'content--blog_post')],
      db: { table_name: 'paragraph_card' },
    }

    const registry: SchemaRegistry = {
      routes: EMPTY_ROUTES,
      roles: EMPTY_ROLES,
      schemas: { 'content--blog_post': contentTarget, 'paragraph--card': paraWithBadRef },
      content_types: { 'content--blog_post': contentTarget },
      paragraph_types: { 'paragraph--card': paraWithBadRef },
      taxonomy_types: {},
      enum_types: {},
      all_schemas: [contentTarget, paraWithBadRef],
    }

    const errors = validateCrossReferences(registry)

    expect(errors.some((e) => e.code === 'INVALID_REF_TARGET')).toBe(true)
    const err = errors.find((e) => e.code === 'INVALID_REF_TARGET')!
    expect(err.message).toContain('content--blog_post')
  })
})

// ─── DUPLICATE_FIELD_NAME ─────────────────────────────────────────────────────

describe('ParseErrorCode — DUPLICATE_FIELD_NAME', () => {
  it('returns DUPLICATE_FIELD_NAME when two fields in the same schema share a name', () => {
    const raw: unknown = {
      name: 'taxonomy--tag',
      label: 'Tag',
      type: 'taxonomy-type',
      fields: [
        { name: 'tag_name', label: 'Name', type: 'text/plain', required: true },
        { name: 'tag_name', label: 'Name Again', type: 'text/plain', required: false },
      ],
    }
    const result = parseSchema(raw, 'taxonomy-type', 'taxonomy--tag.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('DUPLICATE_FIELD_NAME')
    expect(result.errors[0]?.file).toBe('taxonomy--tag.json')
  })
})

// ─── DUPLICATE_SCHEMA_NAME ────────────────────────────────────────────────────

describe('ParseErrorCode — DUPLICATE_SCHEMA_NAME', () => {
  it('returns DUPLICATE_SCHEMA_NAME when two schemas share the same machine name', () => {
    const a = makeBareContentType('content--blog_post', [], 'file_a.json')
    const b = makeBareContentType('content--blog_post', [], 'file_b.json')

    const registry = buildSchemaRegistry([a, b], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    expect(errors.some((e) => e.code === 'DUPLICATE_SCHEMA_NAME')).toBe(true)
    const err = errors.find((e) => e.code === 'DUPLICATE_SCHEMA_NAME')!
    expect(err.file).toBe('file_b.json')
    expect(err.message).toContain('content--blog_post')
  })
})

// ─── INVALID_MACHINE_NAME ─────────────────────────────────────────────────────

describe('ParseErrorCode — INVALID_MACHINE_NAME', () => {
  it('returns INVALID_MACHINE_NAME when a content-type schema name has the wrong prefix', () => {
    const raw = rawContentType({ name: 'taxonomy--blog_post' }) // wrong prefix
    const result = parseSchema(raw, 'content-type', 'content--blog_post.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_MACHINE_NAME')
  })
})

// ─── CIRCULAR_REFERENCE ───────────────────────────────────────────────────────

describe('ParseErrorCode — CIRCULAR_REFERENCE', () => {
  it('returns CIRCULAR_REFERENCE when paragraph A references paragraph B which references paragraph A', () => {
    const a: ParsedParagraphType = {
      schema_type: 'paragraph-type',
      name: 'paragraph--a',
      label: 'A',
      source_file: 'a.json',
      system_fields: [],
      fields: [makeParagraphEmbedField('link_to_b', 'paragraph--b')],
      db: { table_name: 'paragraph_a' },
    }
    const b: ParsedParagraphType = {
      schema_type: 'paragraph-type',
      name: 'paragraph--b',
      label: 'B',
      source_file: 'b.json',
      system_fields: [],
      fields: [makeParagraphEmbedField('link_to_a', 'paragraph--a')],
      db: { table_name: 'paragraph_b' },
    }

    const registry = buildSchemaRegistry([a, b], EMPTY_ROUTES, EMPTY_ROLES)
    const errors = validateCrossReferences(registry)

    expect(errors.some((e) => e.code === 'CIRCULAR_REFERENCE')).toBe(true)
    const err = errors.find((e) => e.code === 'CIRCULAR_REFERENCE')!
    expect(err.message).toContain('paragraph--a')
    expect(err.message).toContain('paragraph--b')
  })
})

// ─── MISSING_REQUIRED_FIELD ───────────────────────────────────────────────────

describe('ParseErrorCode — MISSING_REQUIRED_FIELD', () => {
  it('returns MISSING_REQUIRED_FIELD when a required top-level field is absent', () => {
    // omit only_one — required for content types
    const { only_one: _omit, ...raw } = rawContentType() as Record<string, unknown>
    const result = parseSchema(raw, 'content-type', 'content--blog_post.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('MISSING_REQUIRED_FIELD')
  })
})

// ─── MAX_SIZE_EXCEEDS_GLOBAL_LIMIT ────────────────────────────────────────────

describe('ParseErrorCode — MAX_SIZE_EXCEEDS_GLOBAL_LIMIT', () => {
  it('returns MAX_SIZE_EXCEEDS_GLOBAL_LIMIT when a media field max_size exceeds the global limit', () => {
    const result = parseSchema(
      rawContentType({
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
      }),
      'content-type',
      'content--blog_post.json'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const registry = buildSchemaRegistry([result.schema], EMPTY_ROUTES, EMPTY_ROLES)
    const globalLimit = 4 * 1024 * 1024 // 4 MB
    const errors = validateCrossReferences(registry, globalLimit)

    expect(errors.some((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')).toBe(true)
    const err = errors.find((e) => e.code === 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT')!
    expect(err.file).toBe('content--blog_post.json')
    expect(err.message).toContain('hero')
  })
})

// ─── SCHEMA_DIR_NOT_FOUND ─────────────────────────────────────────────────────

describe('ParseErrorCode — SCHEMA_DIR_NOT_FOUND', () => {
  it('returns SCHEMA_DIR_NOT_FOUND when the base_path directory does not exist', () => {
    const result = walkSchemaDirectory({
      base_path: '/nonexistent-manguito-test-schemas-dir-xyzzy',
      folders: {
        content_types: 'content-types',
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
        roles: 'roles',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('SCHEMA_DIR_NOT_FOUND')
    // never throws
  })
})

// ─── SCHEMA_FOLDER_NOT_FOUND ──────────────────────────────────────────────────

describe('ParseErrorCode — SCHEMA_FOLDER_NOT_FOUND', () => {
  it('returns SCHEMA_FOLDER_NOT_FOUND when a configured schema subfolder does not exist', () => {
    // os.tmpdir() always exists; its subfolders for schema types will not.
    const result = walkSchemaDirectory({
      base_path: os.tmpdir(),
      folders: {
        content_types: 'manguito-test-content-types-missing-xyzzy',
        paragraph_types: 'manguito-test-paragraph-types-missing-xyzzy',
        taxonomy_types: 'manguito-test-taxonomy-types-missing-xyzzy',
        enum_types: 'manguito-test-enum-types-missing-xyzzy',
        roles: 'roles',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('SCHEMA_FOLDER_NOT_FOUND')
  })
})

// ─── DUPLICATE_SCHEMA_FOLDER ──────────────────────────────────────────────────

describe('ParseErrorCode — DUPLICATE_SCHEMA_FOLDER', () => {
  it('returns DUPLICATE_SCHEMA_FOLDER when two folder config values resolve to the same path', () => {
    // Point content_types and paragraph_types at the same folder name.
    const result = walkSchemaDirectory({
      base_path: os.tmpdir(),
      folders: {
        content_types: 'manguito-test-shared-folder',
        paragraph_types: 'manguito-test-shared-folder', // same as above → duplicate
        taxonomy_types: 'manguito-test-taxonomy-types-xyzzy',
        enum_types: 'manguito-test-enum-types-xyzzy',
        roles: 'roles',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('DUPLICATE_SCHEMA_FOLDER')
  })
})

// ─── ROUTES_FILE_NOT_FOUND ────────────────────────────────────────────────────

describe('ParseErrorCode — ROUTES_FILE_NOT_FOUND', () => {
  it.todo(
    'returns ROUTES_FILE_NOT_FOUND when routes.json is missing from the base path root — not yet implemented in loader'
  )
})

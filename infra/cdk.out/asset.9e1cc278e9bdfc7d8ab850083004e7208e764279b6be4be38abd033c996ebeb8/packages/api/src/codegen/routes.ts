// generateRoutes() — pure function that returns a Hono route group from parsed schema
import type {
  SchemaRegistry,
  ParsedField,
  ParsedContentType,
  ParsedTaxonomyType,
  ParsedParagraphType,
} from '@bobbykim/manguito-cms-core'

// ─── Name helpers ─────────────────────────────────────────────────────────────

function getSegment(machineName: string): string {
  const idx = machineName.indexOf('--')
  return idx !== -1 ? machineName.slice(idx + 2) : machineName
}

function toPascalCase(snakeOrKebab: string): string {
  return snakeOrKebab
    .split(/[_-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

function schemaVar(machineName: string): string {
  return toPascalCase(getSegment(machineName)) + 'Schema'
}

function routeVar(prefix: string, machineName: string, suffix: string): string {
  return `${prefix}${toPascalCase(getSegment(machineName))}${suffix}Route`
}

// Convert Hono :param notation to OpenAPI {param} notation
function openApiPath(honoPath: string): string {
  return honoPath.replace(/:([^/]+)/g, '{$1}')
}

// ─── Field → Zod type string ──────────────────────────────────────────────────

export function fieldToZodSchema(field: ParsedField, registry?: SchemaRegistry): string {
  const { field_type, validation } = field

  switch (field_type) {
    case 'text/plain': {
      let s = 'z.string()'
      if (validation.limit !== undefined) s += `.max(${validation.limit})`
      if (validation.pattern !== undefined) s += `.regex(new RegExp(${JSON.stringify(validation.pattern)}))`
      return s
    }

    case 'text/rich':
      return 'z.string()'

    case 'integer': {
      let s = 'z.number().int()'
      if (validation.min !== undefined) s += `.min(${validation.min})`
      if (validation.max !== undefined) s += `.max(${validation.max})`
      return s
    }

    case 'float': {
      let s = 'z.number()'
      if (validation.min !== undefined) s += `.min(${validation.min})`
      if (validation.max !== undefined) s += `.max(${validation.max})`
      return s
    }

    case 'boolean':
      return 'z.boolean()'

    case 'date':
      return 'z.string().datetime()'

    case 'image': {
      const fields = [
        'id: z.string().uuid()',
        'url: z.string().url()',
        'mime_type: z.string()',
        'alt: z.string().optional()',
        'file_size: z.number().int()',
        'width: z.number().int().optional()',
        'height: z.number().int().optional()',
      ]
      return `z.object({ ${fields.join(', ')} })`
    }

    case 'video': {
      const fields = [
        'id: z.string().uuid()',
        'url: z.string().url()',
        'mime_type: z.string()',
        'alt: z.string().optional()',
        'file_size: z.number().int()',
        'width: z.number().int().optional()',
        'height: z.number().int().optional()',
        'duration: z.number().optional()',
      ]
      return `z.object({ ${fields.join(', ')} })`
    }

    case 'file': {
      const fields = [
        'id: z.string().uuid()',
        'url: z.string().url()',
        'mime_type: z.string()',
        'alt: z.string().optional()',
        'file_size: z.number().int()',
      ]
      return `z.object({ ${fields.join(', ')} })`
    }

    case 'enum': {
      const values = validation.allowed_values ?? []
      if (values.length === 0) return 'z.string()'
      const quoted = values.map((v) => JSON.stringify(v)).join(', ')
      return `z.enum([${quoted}])`
    }

    case 'paragraph': {
      const ui = field.ui_component
      if (ui.component !== 'paragraph-embed') return 'z.unknown()'
      const paragraphType = registry?.paragraph_types[ui.ref]
      if (!paragraphType) return 'z.unknown()'
      const inner = generateParagraphObjectSchema(paragraphType, registry)
      return ui.rel === 'one-to-many' ? `z.array(${inner})` : inner
    }

    case 'reference': {
      const ui = field.ui_component
      if (ui.component !== 'typeahead-select') return 'z.string().uuid()'
      return ui.rel === 'one-to-many' ? 'z.array(z.string().uuid())' : 'z.string().uuid()'
    }

    default:
      return 'z.unknown()'
  }
}

// Generates inline z.object({...}) for a paragraph type — used recursively inside fieldToZodSchema
function generateParagraphObjectSchema(
  paragraph: ParsedParagraphType,
  registry?: SchemaRegistry
): string {
  const entries = paragraph.fields.map((f) => {
    const zodType = fieldToZodSchema(f, registry)
    return `${f.name}: ${f.required ? zodType : `${zodType}.optional()`}`
  })
  if (entries.length === 0) return 'z.object({})'
  return `z.object({ ${entries.join(', ')} })`
}

// ─── Schema declaration generators ───────────────────────────────────────────

function systemFieldEntries(schema: ParsedContentType | ParsedTaxonomyType): string[] {
  const entries: string[] = ['id: z.string().uuid()']
  if (schema.schema_type === 'content-type' && !schema.only_one) {
    entries.push('slug: z.string()')
  }
  entries.push('published: z.boolean()')
  entries.push('created_at: z.string().datetime()')
  entries.push('updated_at: z.string().datetime()')
  return entries
}

function schemaFieldEntries(
  fields: ParsedField[],
  registry?: SchemaRegistry
): string[] {
  return fields.map((f) => {
    const zodType = fieldToZodSchema(f, registry)
    return `  ${f.name}: ${f.required ? zodType : `${zodType}.optional()`}`
  })
}

export function generateContentSchema(
  schema: ParsedContentType | ParsedTaxonomyType,
  registry?: SchemaRegistry
): string {
  const name = schemaVar(schema.name)
  const sysEntries = systemFieldEntries(schema).map((e) => `  ${e}`)
  const fieldEntries = schemaFieldEntries(schema.fields, registry)
  const allEntries = [...sysEntries, ...fieldEntries]
  return `const ${name} = z.object({\n${allEntries.join(',\n')},\n})`
}

// Internal: paragraph schema const declaration (not exported but emitted into generated file)
function generateParagraphSchemaDecl(
  paragraph: ParsedParagraphType,
  registry?: SchemaRegistry
): string {
  const name = schemaVar(paragraph.name)
  const inner = generateParagraphObjectSchema(paragraph, registry)
  return `const ${name} = ${inner}`
}

// ─── Shared schemas block ─────────────────────────────────────────────────────

const SHARED_SCHEMAS_BLOCK = `const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

function listResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: z.array(dataSchema),
    meta: z.object({
      total: z.number().int(),
      page: z.number().int(),
      per_page: z.number().int(),
      total_pages: z.number().int(),
      has_next: z.boolean(),
      has_prev: z.boolean(),
    }),
  })
}

function itemResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  })
}`

// ─── Query param schema strings ───────────────────────────────────────────────

const PUBLIC_LIST_QUERY = `z.object({
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(10),
    include: z.string().optional().describe('Comma-separated relation field names to expand'),
    sort_by: z.enum(['title', 'created_at', 'updated_at']).optional().default('created_at'),
    sort_order: z.enum(['asc', 'desc']).optional().default('asc'),
  })`

const ADMIN_LIST_QUERY = `z.object({
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(10),
    include: z.string().optional().describe('Comma-separated relation field names to expand'),
    sort_by: z.enum(['title', 'created_at', 'updated_at']).optional().default('created_at'),
    sort_order: z.enum(['asc', 'desc']).optional().default('asc'),
    published: z.enum(['true', 'false']).optional().describe('Filter by published state'),
  })`

const SLUG_PARAMS = `z.object({ slug: z.string() })`
const ID_PARAMS = `z.object({ id: z.string().uuid() })`
const INCLUDE_QUERY = `z.object({ include: z.string().optional().describe('Comma-separated relation field names to expand') })`

// ─── Content route generators ─────────────────────────────────────────────────

function generateContentRoutes(contentType: ParsedContentType): string {
  const sVar = schemaVar(contentType.name)
  const label = contentType.label
  const tag = label
  const lines: string[] = []

  if (!contentType.only_one) {
    const collPath = contentType.api.collection_path!
    const itemPath = contentType.api.item_path

    // Public — GET list
    lines.push(
      `export const ${routeVar('get', contentType.name, 'List')} = createRoute({
  method: 'get',
  path: '${collPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${PUBLIC_LIST_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listResponseSchema(${sVar}) } },
      description: 'List of ${label}',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid query parameters',
    },
  },
})`
    )

    // Public — GET single by slug
    lines.push(
      `export const ${routeVar('get', contentType.name, '')} = createRoute({
  method: 'get',
  path: '${openApiPath(itemPath)}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${SLUG_PARAMS},
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
    )

    // Admin — GET list
    const adminCollPath = '/admin' + collPath
    const adminItemPath = adminCollPath + '/{id}'
    lines.push(
      `export const ${routeVar('adminGet', contentType.name, 'List')} = createRoute({
  method: 'get',
  path: '${adminCollPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${ADMIN_LIST_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listResponseSchema(${sVar}) } },
      description: 'List of ${label}',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid query parameters',
    },
  },
})`
    )

    // Admin — GET single by id
    lines.push(
      `export const ${routeVar('adminGet', contentType.name, '')} = createRoute({
  method: 'get',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
    )

    // Admin — POST
    lines.push(
      `export const ${routeVar('adminCreate', contentType.name, '')} = createRoute({
  method: 'post',
  path: '${adminCollPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    body: {
      content: { 'application/json': { schema: ${sVar} } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} created',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
    )

    // Admin — PATCH
    lines.push(
      `export const ${routeVar('adminUpdate', contentType.name, '')} = createRoute({
  method: 'patch',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    body: {
      content: { 'application/json': { schema: ${sVar}.partial().extend({ published: z.boolean().optional() }) } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
    )

    // Admin — DELETE
    lines.push(
      `export const ${routeVar('adminDelete', contentType.name, '')} = createRoute({
  method: 'delete',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
      description: '${label} deleted',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
    )
  } else {
    // only_one: true — no list, no slug, fixed paths
    const itemPath = contentType.api.item_path
    const adminItemBase = '/admin' + itemPath
    const adminPatchPath = '/admin/api/' + contentType.default_base_path + '/{id}'

    // Public — GET singleton
    lines.push(
      `export const ${routeVar('get', contentType.name, '')} = createRoute({
  method: 'get',
  path: '${itemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
    )

    // Admin — GET singleton
    lines.push(
      `export const ${routeVar('adminGet', contentType.name, '')} = createRoute({
  method: 'get',
  path: '${adminItemBase}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
    )

    // Admin — POST (create singleton)
    const adminPostPath = '/admin/api/' + contentType.default_base_path
    lines.push(
      `export const ${routeVar('adminCreate', contentType.name, '')} = createRoute({
  method: 'post',
  path: '${adminPostPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    body: {
      content: { 'application/json': { schema: ${sVar} } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} created',
    },
    409: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Singleton already exists',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
    )

    // Admin — PATCH
    lines.push(
      `export const ${routeVar('adminUpdate', contentType.name, '')} = createRoute({
  method: 'patch',
  path: '${adminPatchPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    body: {
      content: { 'application/json': { schema: ${sVar}.partial().extend({ published: z.boolean().optional() }) } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
    )
  }

  return lines.join('\n\n')
}

// ─── Taxonomy route generators ────────────────────────────────────────────────

function generateTaxonomyRoutes(taxonomyType: ParsedTaxonomyType): string {
  const sVar = schemaVar(taxonomyType.name)
  const label = taxonomyType.label
  const tag = label
  const collPath = taxonomyType.api.collection_path
  const itemPath = taxonomyType.api.item_path
  const adminCollPath = '/admin' + collPath
  const adminItemPath = '/admin' + openApiPath(itemPath)
  const lines: string[] = []

  // Public — GET list
  lines.push(
    `export const ${routeVar('get', taxonomyType.name, 'List')} = createRoute({
  method: 'get',
  path: '${collPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${PUBLIC_LIST_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listResponseSchema(${sVar}) } },
      description: 'List of ${label}',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid query parameters',
    },
  },
})`
  )

  // Public — GET single by id
  lines.push(
    `export const ${routeVar('get', taxonomyType.name, '')} = createRoute({
  method: 'get',
  path: '${openApiPath(itemPath)}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
  )

  // Admin — GET list
  lines.push(
    `export const ${routeVar('adminGet', taxonomyType.name, 'List')} = createRoute({
  method: 'get',
  path: '${adminCollPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    query: ${ADMIN_LIST_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listResponseSchema(${sVar}) } },
      description: 'List of ${label}',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid query parameters',
    },
  },
})`
  )

  // Admin — GET single by id
  lines.push(
    `export const ${routeVar('adminGet', taxonomyType.name, '')} = createRoute({
  method: 'get',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    query: ${INCLUDE_QUERY},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label}',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
  )

  // Admin — POST
  lines.push(
    `export const ${routeVar('adminCreate', taxonomyType.name, '')} = createRoute({
  method: 'post',
  path: '${adminCollPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    body: {
      content: { 'application/json': { schema: ${sVar} } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} created',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
  )

  // Admin — PATCH
  lines.push(
    `export const ${routeVar('adminUpdate', taxonomyType.name, '')} = createRoute({
  method: 'patch',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
    body: {
      content: { 'application/json': { schema: ${sVar}.partial().extend({ published: z.boolean().optional() }) } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(${sVar}) } },
      description: '${label} updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
    422: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Validation error',
    },
  },
})`
  )

  // Admin — DELETE
  lines.push(
    `export const ${routeVar('adminDelete', taxonomyType.name, '')} = createRoute({
  method: 'delete',
  path: '${adminItemPath}',
  tags: [${JSON.stringify(tag)}],
  request: {
    params: ${ID_PARAMS},
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
      description: '${label} deleted',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: '${label} not found',
    },
  },
})`
  )

  return lines.join('\n\n')
}

// ─── generateRoutes ───────────────────────────────────────────────────────────

export function generateRoutes(registry: SchemaRegistry): string {
  const parts: string[] = []

  parts.push('// Auto-generated by generateRoutes() — do not hand-edit')
  parts.push("import { createRoute, z } from '@hono/zod-openapi'")
  parts.push('')
  parts.push('// ─── Shared schemas ──────────────────────────────────────────────────────────')
  parts.push('')
  parts.push(SHARED_SCHEMAS_BLOCK)
  parts.push('')

  const paragraphEntries = Object.entries(registry.paragraph_types)
  if (paragraphEntries.length > 0) {
    parts.push('// ─── Paragraph schemas ───────────────────────────────────────────────────────')
    parts.push('')
    for (const [, paragraphType] of paragraphEntries) {
      parts.push(generateParagraphSchemaDecl(paragraphType, registry))
    }
    parts.push('')
  }

  const contentEntries = Object.entries(registry.content_types)
  if (contentEntries.length > 0) {
    parts.push('// ─── Content type schemas ────────────────────────────────────────────────────')
    parts.push('')
    for (const [, contentType] of contentEntries) {
      parts.push(generateContentSchema(contentType, registry))
      parts.push('')
    }
  }

  const taxonomyEntries = Object.entries(registry.taxonomy_types)
  if (taxonomyEntries.length > 0) {
    parts.push('// ─── Taxonomy type schemas ───────────────────────────────────────────────────')
    parts.push('')
    for (const [, taxonomyType] of taxonomyEntries) {
      parts.push(generateContentSchema(taxonomyType, registry))
      parts.push('')
    }
  }

  if (contentEntries.length > 0) {
    parts.push('// ─── Content routes ─────────────────────────────────────────────────────────')
    parts.push('')
    for (const [, contentType] of contentEntries) {
      parts.push(generateContentRoutes(contentType))
      parts.push('')
    }
  }

  if (taxonomyEntries.length > 0) {
    parts.push('// ─── Taxonomy routes ────────────────────────────────────────────────────────')
    parts.push('')
    for (const [, taxonomyType] of taxonomyEntries) {
      parts.push(generateTaxonomyRoutes(taxonomyType))
      parts.push('')
    }
  }

  return parts.join('\n')
}

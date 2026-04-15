import type { ZodError } from 'zod'
import type { ParseError } from './loader'
import type { SchemaType } from './loader'
import {
  ContentTypeRawSchema,
  ParagraphTypeRawSchema,
  TaxonomyTypeRawSchema,
  EnumTypeRawSchema,
} from './validators'
import type { RawField } from './validators'
import type {
  DbColumn,
  FieldType,
  FieldValidation,
  ParsedField,
  SystemField,
  UiComponent,
} from '../registry/types'

// ─── Output types ─────────────────────────────────────────────────────────────

export type ParsedSchemaBase = {
  schema_type: SchemaType
  name: string
  label: string
  source_file: string
}

export type UiTab = {
  name: string
  label: string
  fields: string[] // ordered field names — no duplication of full field objects
}

export type UiMeta = {
  tabs: UiTab[]
}

export type JunctionTable = {
  table_name: string  // "junction_content_blog_post_blog_related"
  left_column: string // "left_id"
  right_column: string // "right_id"
  right_table: string // "content_blog_post"
  order_column: boolean
}

export type ContentDbMeta = {
  table_name: string
  junction_tables: JunctionTable[]
}

export type ParagraphDbMeta = {
  table_name: string
}

export type TaxonomyDbMeta = {
  table_name: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ContentApiMeta = {
  default_base_path: string
  http_methods: HttpMethod[]
  collection_path?: string // only_one: false only
  item_path: string
}

export type TaxonomyApiMeta = {
  collection_path: string
  item_path: string
}

export type ParsedContentType = ParsedSchemaBase & {
  schema_type: 'content-type'
  only_one: boolean
  default_base_path: string
  system_fields: SystemField[]
  fields: ParsedField[]
  ui: UiMeta
  db: ContentDbMeta
  api: ContentApiMeta
}

export type ParsedParagraphType = ParsedSchemaBase & {
  schema_type: 'paragraph-type'
  system_fields: SystemField[]
  fields: ParsedField[]
  db: ParagraphDbMeta
}

export type ParsedTaxonomyType = ParsedSchemaBase & {
  schema_type: 'taxonomy-type'
  system_fields: SystemField[]
  fields: ParsedField[]
  db: TaxonomyDbMeta
  api: TaxonomyApiMeta
}

export type ParsedEnumType = ParsedSchemaBase & {
  schema_type: 'enum-type'
  values: string[]
}

export type ParsedSchema =
  | ParsedContentType
  | ParsedParagraphType
  | ParsedTaxonomyType
  | ParsedEnumType

export type ParseResult =
  | { ok: true; schema: ParsedSchema }
  | { ok: false; errors: ParseError[] }

// ─── System fields (verbatim from phase-02-parser-output.md) ─────────────────

const CONTENT_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, default: 'gen_random_uuid()', nullable: false },
  { name: 'slug', db_type: 'varchar', nullable: false },
  { name: 'base_path_id', db_type: 'uuid', nullable: false },
  { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const PARAGRAPH_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, default: 'gen_random_uuid()', nullable: false },
  { name: 'parent_id', db_type: 'uuid', nullable: false },
  { name: 'parent_type', db_type: 'varchar', nullable: false },
  { name: 'parent_field', db_type: 'varchar', nullable: false },
  { name: 'order', db_type: 'integer', default: '0', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

const TAXONOMY_SYSTEM_FIELDS: SystemField[] = [
  { name: 'id', db_type: 'uuid', primary_key: true, default: 'gen_random_uuid()', nullable: false },
  { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
  { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
  { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
]

// ─── Mime type constants (specific types for API validation) ──────────────────

// Distinct from UiComponent.accepted_mime_types which uses wildcards (image/*).
// FieldValidation.allowed_mime_types uses specific types for server-side validation.
const MEDIA_ALLOWED_MIME: Record<'image' | 'video' | 'file', string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  file: ['application/pdf'],
}

// UI component uses wildcards for the HTML <input accept> attribute.
const MEDIA_UI_MIME: Record<'image' | 'video' | 'file', string[]> = {
  image: ['image/*'],
  video: ['video/*'],
  file: ['application/pdf'],
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// "content--blog_post" → "content_blog_post"
function machineNameToTableName(machineName: string): string {
  return machineName.replace('--', '_')
}

// "blog_post" → "blog-post"
function nameSegmentToKebab(segment: string): string {
  return segment.replace(/_/g, '-')
}

// "content--blog_post" → "blog_post"
function getNameSegment(machineName: string): string {
  const idx = machineName.indexOf('--')
  return idx === -1 ? machineName : machineName.slice(idx + 2)
}

// "2MB" → 2097152, "512KB" → 524288
function parseMaxSize(str: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i.exec(str)
  if (!m) return 0
  const value = parseFloat(m[1]!)
  switch (m[2]!.toUpperCase()) {
    case 'B':  return Math.round(value)
    case 'KB': return Math.round(value * 1_024)
    case 'MB': return Math.round(value * 1_048_576)
    case 'GB': return Math.round(value * 1_073_741_824)
    default:   return 0
  }
}

// Zod path array → "fields[0].name"
// Zod v4 types issue.path as PropertyKey[] — symbols can't appear in practice.
function zodPathToString(path: PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => {
    const s = typeof seg === 'symbol' ? String(seg) : seg
    return typeof s === 'number' ? `${acc}[${s}]` : acc ? `${acc}.${s}` : s
  }, '')
}

// Map Zod validation issues to ParseError[], choosing the most relevant code.
function zodErrorsToParseErrors(
  error: ZodError,
  sourceFile: string
): ParseError[] {
  return error.issues.map((issue) => {
    const pathStr = zodPathToString(issue.path)
    const lastSeg = issue.path[issue.path.length - 1]

    let code: ParseError['code'] = 'MISSING_REQUIRED_FIELD'
    if (lastSeg === 'name') code = 'INVALID_MACHINE_NAME'
    else if (lastSeg === 'type' && issue.path.length <= 2) code = 'INVALID_SCHEMA_TYPE'
    else if (lastSeg === 'type') code = 'INVALID_FIELD_TYPE'

    return {
      file: sourceFile,
      code,
      message: issue.message,
      ...(pathStr ? { path: pathStr } : {}),
    }
  })
}

// Detect and report duplicate field names, returning a set of errors.
function checkDuplicateFieldNames(
  fields: RawField[],
  sourceFile: string,
  schemaName: string
): ParseError[] {
  const seen = new Set<string>()
  const errors: ParseError[] = []
  for (const f of fields) {
    if (seen.has(f.name)) {
      errors.push({
        file: sourceFile,
        code: 'DUPLICATE_FIELD_NAME',
        message: `Duplicate field name "${f.name}" in schema "${schemaName}"`,
      })
    }
    seen.add(f.name)
  }
  return errors
}

// ─── ParsedField construction ─────────────────────────────────────────────────

type FieldResult =
  | { ok: true; value: ParsedField }
  | { ok: false; errors: ParseError[] }

function buildParsedField(
  rawField: RawField,
  order: number,
  sourceFile: string,
  ownerTableName: string
): FieldResult {
  const fieldType = rawField.type as FieldType
  const { name, label, required } = rawField
  const nullable = !required

  let validation: FieldValidation
  let db_column: DbColumn | null
  let ui_component: UiComponent

  switch (rawField.type) {
    // ── Primitives ──────────────────────────────────────────────────────────

    case 'text/plain': {
      validation = {
        required,
        ...(rawField.limit !== undefined && { limit: rawField.limit }),
        ...(rawField.pattern !== undefined && { pattern: rawField.pattern }),
      }
      db_column = { column_name: name, column_type: 'varchar', nullable }
      ui_component = { component: 'text-input' }
      break
    }

    case 'text/rich': {
      validation = { required }
      db_column = { column_name: name, column_type: 'text', nullable }
      ui_component = { component: 'rich-text-editor' }
      break
    }

    case 'integer': {
      validation = {
        required,
        ...(rawField.min !== undefined && { min: rawField.min }),
        ...(rawField.max !== undefined && { max: rawField.max }),
      }
      db_column = { column_name: name, column_type: 'integer', nullable }
      ui_component = { component: 'number-input', step: 1 }
      break
    }

    case 'float': {
      validation = {
        required,
        ...(rawField.min !== undefined && { min: rawField.min }),
        ...(rawField.max !== undefined && { max: rawField.max }),
      }
      db_column = { column_name: name, column_type: 'decimal', nullable }
      ui_component = { component: 'number-input', step: 0.01 }
      break
    }

    case 'boolean': {
      validation = { required }
      // Boolean columns are always NOT NULL — false is the natural empty value.
      db_column = { column_name: name, column_type: 'boolean', nullable: false }
      ui_component = { component: 'checkbox' }
      break
    }

    case 'date': {
      validation = { required }
      db_column = { column_name: name, column_type: 'timestamp', nullable }
      ui_component = { component: 'date-picker' }
      break
    }

    // ── Media ───────────────────────────────────────────────────────────────

    case 'image':
    case 'video':
    case 'file': {
      const mediaType = rawField.type
      const maxSizeBytes = rawField.max_size ? parseMaxSize(rawField.max_size) : undefined
      validation = {
        required,
        ...(maxSizeBytes !== undefined && { max_size: maxSizeBytes }),
        allowed_mime_types: MEDIA_ALLOWED_MIME[mediaType],
      }
      db_column = {
        column_name: name,
        column_type: 'uuid',
        nullable,
        foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
      }
      ui_component = {
        component: 'file-upload',
        accepted_mime_types: MEDIA_UI_MIME[mediaType],
      }
      break
    }

    // ── Enum ────────────────────────────────────────────────────────────────

    case 'enum': {
      // Inline enum: values are already present on the field.
      // Ref enum: values must be resolved externally when the full registry is
      // available. For now, allowed_values is empty and check_constraint is empty.
      // The registry builder is responsible for populating these for ref enums.
      const allowedValues = rawField.values ?? []
      validation = { required, allowed_values: allowedValues }
      db_column = {
        column_name: name,
        column_type: 'varchar',
        nullable,
        check_constraint: allowedValues,
      }
      ui_component = { component: 'select', options: allowedValues }
      break
    }

    // ── Paragraph ───────────────────────────────────────────────────────────

    case 'paragraph': {
      // No column on the owning table — the association is stored via system
      // fields on the paragraph table (parent_id, parent_type, parent_field, order).
      validation = {
        required,
        ...(rawField.max !== undefined && { max_items: rawField.max }),
      }
      db_column = null
      ui_component = {
        component: 'paragraph-embed',
        ref: rawField.ref,
        rel: rawField.rel,
        ...(rawField.max !== undefined && { max: rawField.max }),
      }
      break
    }

    // ── Reference ───────────────────────────────────────────────────────────

    case 'reference': {
      const rel = rawField.rel
      const targetTableName = machineNameToTableName(rawField.target)

      validation = {
        required,
        ...(rawField.max !== undefined && { max_items: rawField.max }),
      }

      if (rel === 'many-to-many') {
        // No FK column — junction table owns the association.
        // table name: "junction_<owner>_<fieldName>"
        db_column = {
          column_name: '',
          column_type: 'uuid',
          nullable,
          junction: {
            table_name: `junction_${ownerTableName}_${name}`,
            left_column: 'left_id',
            right_column: 'right_id',
            right_table: targetTableName,
            order_column: false,
          },
        }
      } else {
        // FK column on the owning table. SET NULL on delete (references are independent).
        db_column = {
          column_name: name,
          column_type: 'uuid',
          nullable,
          foreign_key: { table: targetTableName, column: 'id', on_delete: 'SET NULL' },
        }
      }

      ui_component = {
        component: 'typeahead-select',
        ref: rawField.target,
        rel: rawField.rel,
      }
      break
    }

    default: {
      return {
        ok: false,
        errors: [{
          file: sourceFile,
          code: 'INVALID_FIELD_TYPE',
          message: `Unknown field type: ${String((rawField as { type: unknown }).type)}`,
        }],
      }
    }
  }

  return {
    ok: true,
    value: { name, label, field_type: fieldType, required, nullable, order, validation, db_column, ui_component },
  }
}

// Build ParsedField[] from a flat raw field list, accumulating errors.
function buildFields(
  rawFields: RawField[],
  sourceFile: string,
  ownerTableName: string
): { fields: ParsedField[]; errors: ParseError[] } {
  const fields: ParsedField[] = []
  const errors: ParseError[] = []

  for (let i = 0; i < rawFields.length; i++) {
    const result = buildParsedField(rawFields[i]!, i, sourceFile, ownerTableName)
    if (result.ok) {
      fields.push(result.value)
    } else {
      errors.push(...result.errors)
    }
  }

  return { fields, errors }
}

// ─── Per-schema-type parsers ──────────────────────────────────────────────────

function parseContentType(raw: unknown, sourceFile: string): ParseResult {
  const result = ContentTypeRawSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, errors: zodErrorsToParseErrors(result.error, sourceFile) }
  }
  const v = result.data

  // ── Strip tabs: collect flat fields + build UiMeta simultaneously ──────────

  const flatRawFields: RawField[] = []
  const tabs: UiTab[] = []

  for (const tabWrapper of v.fields) {
    const tab = tabWrapper.tab
    const tabFieldNames: string[] = []

    for (const f of tab.fields) {
      flatRawFields.push(f)
      tabFieldNames.push(f.name)
    }

    tabs.push({ name: tab.name, label: tab.label, fields: tabFieldNames })
  }

  // ── Duplicate field name check ─────────────────────────────────────────────

  const dupErrors = checkDuplicateFieldNames(flatRawFields, sourceFile, v.name)
  if (dupErrors.length > 0) return { ok: false, errors: dupErrors }

  // ── Build parsed fields ────────────────────────────────────────────────────

  const tableName = machineNameToTableName(v.name)
  const { fields, errors } = buildFields(flatRawFields, sourceFile, tableName)
  if (errors.length > 0) return { ok: false, errors }

  // ── Collect junction tables from many-to-many reference fields ─────────────

  const junctionTables: JunctionTable[] = []
  for (const field of fields) {
    if (field.field_type === 'reference' && field.db_column?.junction) {
      const j = field.db_column.junction
      junctionTables.push({
        table_name: j.table_name,
        left_column: j.left_column,
        right_column: j.right_column,
        right_table: j.right_table,
        order_column: j.order_column,
      })
    }
  }

  // ── ContentApiMeta ─────────────────────────────────────────────────────────

  const nameKebab = nameSegmentToKebab(getNameSegment(v.name))

  const api: ContentApiMeta = v.only_one
    ? {
        default_base_path: v.default_base_path,
        http_methods: ['GET', 'PUT', 'PATCH'],
        item_path: `/api/${v.default_base_path}/${nameKebab}`,
      }
    : {
        default_base_path: v.default_base_path,
        http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        collection_path: `/api/${nameKebab}`,
        item_path: `/api/${nameKebab}/:slug`,
      }

  const schema: ParsedContentType = {
    schema_type: 'content-type',
    name: v.name,
    label: v.label,
    source_file: sourceFile,
    only_one: v.only_one,
    default_base_path: v.default_base_path,
    system_fields: CONTENT_SYSTEM_FIELDS,
    fields,
    ui: { tabs },
    db: { table_name: tableName, junction_tables: junctionTables },
    api,
  }

  return { ok: true, schema }
}

function parseParagraphType(raw: unknown, sourceFile: string): ParseResult {
  const result = ParagraphTypeRawSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, errors: zodErrorsToParseErrors(result.error, sourceFile) }
  }
  const v = result.data

  const dupErrors = checkDuplicateFieldNames(v.fields, sourceFile, v.name)
  if (dupErrors.length > 0) return { ok: false, errors: dupErrors }

  const tableName = machineNameToTableName(v.name)
  const { fields, errors } = buildFields(v.fields, sourceFile, tableName)
  if (errors.length > 0) return { ok: false, errors }

  const schema: ParsedParagraphType = {
    schema_type: 'paragraph-type',
    name: v.name,
    label: v.label,
    source_file: sourceFile,
    system_fields: PARAGRAPH_SYSTEM_FIELDS,
    fields,
    db: { table_name: tableName },
  }

  return { ok: true, schema }
}

function parseTaxonomyType(raw: unknown, sourceFile: string): ParseResult {
  const result = TaxonomyTypeRawSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, errors: zodErrorsToParseErrors(result.error, sourceFile) }
  }
  const v = result.data

  const dupErrors = checkDuplicateFieldNames(v.fields, sourceFile, v.name)
  if (dupErrors.length > 0) return { ok: false, errors: dupErrors }

  const tableName = machineNameToTableName(v.name)
  const { fields, errors } = buildFields(v.fields, sourceFile, tableName)
  if (errors.length > 0) return { ok: false, errors }

  // Taxonomy API paths always live under /api/taxonomy/<name-in-kebab>
  const nameKebab = nameSegmentToKebab(getNameSegment(v.name))
  const basePath = `/api/taxonomy/${nameKebab}`

  const schema: ParsedTaxonomyType = {
    schema_type: 'taxonomy-type',
    name: v.name,
    label: v.label,
    source_file: sourceFile,
    system_fields: TAXONOMY_SYSTEM_FIELDS,
    fields,
    db: { table_name: tableName },
    api: {
      collection_path: basePath,
      item_path: `${basePath}/:id`,
    },
  }

  return { ok: true, schema }
}

function parseEnumType(raw: unknown, sourceFile: string): ParseResult {
  const result = EnumTypeRawSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, errors: zodErrorsToParseErrors(result.error, sourceFile) }
  }
  const v = result.data

  const schema: ParsedEnumType = {
    schema_type: 'enum-type',
    name: v.name,
    label: v.label,
    source_file: sourceFile,
    values: v.values,
  }

  return { ok: true, schema }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Parses a raw schema object (from JSON or YAML) into the corresponding
 * Parsed* type. Returns a ParseResult — never throws for expected failures.
 *
 * sourceFile is optional but should be supplied for accurate error reporting.
 */
export function parseSchema(
  raw: unknown,
  schemaType: SchemaType,
  sourceFile = ''
): ParseResult {
  switch (schemaType) {
    case 'content-type':   return parseContentType(raw, sourceFile)
    case 'paragraph-type': return parseParagraphType(raw, sourceFile)
    case 'taxonomy-type':  return parseTaxonomyType(raw, sourceFile)
    case 'enum-type':      return parseEnumType(raw, sourceFile)
  }
}

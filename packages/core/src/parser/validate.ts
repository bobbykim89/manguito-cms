import type { ParseError } from './loader'
import type {
  ParsedSchema,
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedEnumType,
} from './parseSchema'
import type { ParsedField } from '../registry/types'

// ─── Parsed Routes ────────────────────────────────────────────────────────────

export type ParsedBasePath = {
  name: string
  path: string
}

export type ParsedRoutes = {
  base_paths: ParsedBasePath[]
}

// ─── Parsed Roles ─────────────────────────────────────────────────────────────

export type ParsedRole = {
  name: string
  label: string
  hierarchy_level: number
  permissions: string[]
}

export type ParsedRoles = {
  roles: ParsedRole[]
  valid_permissions: string[]
}

// ─── SchemaRegistry ───────────────────────────────────────────────────────────

export type SchemaRegistry = {
  routes: ParsedRoutes
  roles: ParsedRoles
  /** All schemas keyed by machine name. When two schemas share a name, last-write-wins. */
  schemas: Record<string, ParsedSchema>
  content_types: Record<string, ParsedContentType>
  paragraph_types: Record<string, ParsedParagraphType>
  taxonomy_types: Record<string, ParsedTaxonomyType>
  enum_types: Record<string, ParsedEnumType>
  /**
   * All schemas in the original input order, preserving duplicates.
   * Used by validateCrossReferences to detect DUPLICATE_SCHEMA_NAME errors —
   * the keyed maps above deduplicate by name and would hide them.
   */
  all_schemas: readonly ParsedSchema[]
}

// ─── buildSchemaRegistry ──────────────────────────────────────────────────────

/**
 * Assembles the final SchemaRegistry from all individually parsed schemas,
 * routes, and roles.
 *
 * When two schemas share the same machine name, last-write-wins in the keyed
 * maps. The all_schemas array preserves all entries (including duplicates) so
 * that validateCrossReferences can detect DUPLICATE_SCHEMA_NAME errors.
 *
 * Also resolves enum refs: any enum field that uses `ref` (rather than inline
 * `values`) has its allowed_values, check_constraint, and select options
 * populated from the matching enum-type schema. Fields whose enum ref does not
 * exist in the registry are left empty — validateCrossReferences will report
 * UNKNOWN_REF for them.
 */
export function buildSchemaRegistry(
  parsedSchemas: ParsedSchema[],
  parsedRoutes: ParsedRoutes,
  parsedRoles: ParsedRoles
): SchemaRegistry {
  const schemas: Record<string, ParsedSchema> = {}
  const content_types: Record<string, ParsedContentType> = {}
  const paragraph_types: Record<string, ParsedParagraphType> = {}
  const taxonomy_types: Record<string, ParsedTaxonomyType> = {}
  const enum_types: Record<string, ParsedEnumType> = {}

  // First pass: populate all keyed maps.
  for (const schema of parsedSchemas) {
    schemas[schema.name] = schema

    switch (schema.schema_type) {
      case 'content-type':
        content_types[schema.name] = schema as ParsedContentType
        break
      case 'paragraph-type':
        paragraph_types[schema.name] = schema as ParsedParagraphType
        break
      case 'taxonomy-type':
        taxonomy_types[schema.name] = schema as ParsedTaxonomyType
        break
      case 'enum-type':
        enum_types[schema.name] = schema as ParsedEnumType
        break
    }
  }

  // Second pass: resolve enum refs.
  // Fields with type "enum" and a stored enum_ref have their allowed_values,
  // check_constraint, and options populated from the referenced enum-type.
  for (const schema of Object.values(schemas)) {
    if (schema.schema_type === 'enum-type') continue

    for (const field of schema.fields) {
      if (field.field_type !== 'enum') continue

      const ui = field.ui_component as {
        component: 'select'
        options: string[]
        enum_ref?: string
      }

      if (ui.enum_ref === undefined) continue // inline enum — already populated

      const enumSchema = enum_types[ui.enum_ref]
      if (enumSchema === undefined) continue // UNKNOWN_REF — validateCrossReferences reports this

      const values = enumSchema.values
      field.validation.allowed_values = values
      if (field.db_column !== null) {
        field.db_column.check_constraint = values
      }
      ui.options = values
    }
  }

  return {
    routes: parsedRoutes,
    roles: parsedRoles,
    schemas,
    content_types,
    paragraph_types,
    taxonomy_types,
    enum_types,
    all_schemas: parsedSchemas,
  }
}

// ─── validateCrossReferences ──────────────────────────────────────────────────

/**
 * Validates cross-schema references after all schemas have been individually
 * parsed and assembled into a registry. Returns all cross-reference errors.
 *
 * Error codes covered:
 * - DUPLICATE_SCHEMA_NAME     — two schema files share the same machine name
 * - UNKNOWN_REF               — ref or target points to a non-existent schema
 * - INVALID_REF_TARGET        — ref points to a schema of the wrong type
 * - CIRCULAR_REFERENCE        — paragraph A refs paragraph B which refs paragraph A
 * - MAX_SIZE_EXCEEDS_GLOBAL_LIMIT — field max_size exceeds the global limit
 *
 * @param registry         The assembled SchemaRegistry (from buildSchemaRegistry).
 * @param globalMaxFileSize Global max file size in bytes from api.media.max_file_size.
 *   When provided, MAX_SIZE_EXCEEDS_GLOBAL_LIMIT is checked for all media fields.
 */
export function validateCrossReferences(
  registry: SchemaRegistry,
  globalMaxFileSize?: number
): ParseError[] {
  const errors: ParseError[] = []

  errors.push(...checkDuplicateSchemaNames(registry.all_schemas))
  errors.push(...checkFieldRefs(registry))
  errors.push(...checkCircularParagraphRefs(registry))

  if (globalMaxFileSize !== undefined) {
    errors.push(...checkMaxSizeLimit(registry, globalMaxFileSize))
  }

  return errors
}

// ─── DUPLICATE_SCHEMA_NAME ────────────────────────────────────────────────────

function checkDuplicateSchemaNames(allSchemas: readonly ParsedSchema[]): ParseError[] {
  const errors: ParseError[] = []
  const seen = new Map<string, string>() // name → source_file of first occurrence

  for (const schema of allSchemas) {
    const firstFile = seen.get(schema.name)
    if (firstFile !== undefined) {
      errors.push({
        file: schema.source_file,
        code: 'DUPLICATE_SCHEMA_NAME',
        message: `Duplicate schema name "${schema.name}": already defined in "${firstFile}"`,
      })
    } else {
      seen.set(schema.name, schema.source_file)
    }
  }

  return errors
}

// ─── UNKNOWN_REF / INVALID_REF_TARGET ────────────────────────────────────────

// Narrow ui_component shapes for the three relational field types.
type ParagraphEmbedUi = { component: 'paragraph-embed'; ref: string; rel: string; max?: number }
type TypeaheadSelectUi = { component: 'typeahead-select'; ref: string; rel: string }
type SelectUi = { component: 'select'; options: string[]; enum_ref?: string }

function checkFieldRefs(registry: SchemaRegistry): ParseError[] {
  const errors: ParseError[] = []

  for (const schema of Object.values(registry.schemas)) {
    if (schema.schema_type === 'enum-type') continue

    for (const field of schema.fields) {
      errors.push(...checkSingleFieldRef(field, schema.source_file, registry))
    }
  }

  return errors
}

function checkSingleFieldRef(
  field: ParsedField,
  sourceFile: string,
  registry: SchemaRegistry
): ParseError[] {
  const errors: ParseError[] = []
  const fieldPath = (prop: string): string => `fields[${field.order}].${prop}`

  switch (field.field_type) {
    case 'paragraph': {
      const ref = (field.ui_component as ParagraphEmbedUi).ref

      if (ref in registry.paragraph_types) break // valid

      errors.push({
        file: sourceFile,
        code: ref in registry.schemas ? 'INVALID_REF_TARGET' : 'UNKNOWN_REF',
        message:
          ref in registry.schemas
            ? `Field "${field.name}": paragraph ref "${ref}" exists but is not a paragraph-type`
            : `Field "${field.name}": paragraph ref "${ref}" does not exist`,
        path: fieldPath('ref'),
      })
      break
    }

    case 'reference': {
      // typeahead-select stores the original `target` as ui.ref.
      const target = (field.ui_component as TypeaheadSelectUi).ref

      if (target in registry.content_types || target in registry.taxonomy_types) break // valid

      errors.push({
        file: sourceFile,
        code: target in registry.schemas ? 'INVALID_REF_TARGET' : 'UNKNOWN_REF',
        message:
          target in registry.schemas
            ? `Field "${field.name}": reference target "${target}" exists but is not a content-type or taxonomy-type`
            : `Field "${field.name}": reference target "${target}" does not exist`,
        path: fieldPath('target'),
      })
      break
    }

    case 'enum': {
      const enumRef = (field.ui_component as SelectUi).enum_ref
      if (enumRef === undefined) break // inline enum — no ref to validate

      if (enumRef in registry.enum_types) break // valid

      errors.push({
        file: sourceFile,
        code: enumRef in registry.schemas ? 'INVALID_REF_TARGET' : 'UNKNOWN_REF',
        message:
          enumRef in registry.schemas
            ? `Field "${field.name}": enum ref "${enumRef}" exists but is not an enum-type`
            : `Field "${field.name}": enum ref "${enumRef}" does not exist`,
        path: fieldPath('ref'),
      })
      break
    }
  }

  return errors
}

// ─── CIRCULAR_REFERENCE ───────────────────────────────────────────────────────

/**
 * Detects cycles in the paragraph-to-paragraph reference graph using iterative
 * DFS with an explicit call stack to avoid recursion depth limits.
 *
 * Only edges to paragraph types that exist in the registry are traversed —
 * missing refs are reported as UNKNOWN_REF by checkFieldRefs, not here.
 */
function checkCircularParagraphRefs(registry: SchemaRegistry): ParseError[] {
  const errors: ParseError[] = []

  // Build adjacency list: paragraph machine name → paragraph machine names it refs.
  const adjList = new Map<string, string[]>()

  for (const [name, para] of Object.entries(registry.paragraph_types)) {
    const refs: string[] = []
    for (const field of para.fields) {
      if (field.field_type !== 'paragraph') continue
      const ref = (field.ui_component as ParagraphEmbedUi).ref
      // Only follow edges that exist — unknown refs handled by checkFieldRefs.
      if (ref in registry.paragraph_types) {
        refs.push(ref)
      }
    }
    adjList.set(name, refs)
  }

  // Standard DFS cycle detection:
  //   visited  — fully explored nodes (no cycles reachable from them)
  //   inStack  — nodes currently on the active DFS path
  //   stack    — ordered active DFS path for cycle description
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const stack: string[] = []

  function dfs(node: string): void {
    if (inStack.has(node)) {
      // node is already on the current path → cycle found.
      const cycleStart = stack.indexOf(node)
      const cyclePath = stack.slice(cycleStart)
      const cycleStr = [...cyclePath, node].join(' → ')

      // Attribute the error to the schema that introduced the back-edge.
      const lastNode = stack[stack.length - 1]!
      const sourceFile = registry.paragraph_types[lastNode]?.source_file ?? ''

      errors.push({
        file: sourceFile,
        code: 'CIRCULAR_REFERENCE',
        message: `Circular paragraph reference detected: ${cycleStr}`,
      })
      return
    }

    if (visited.has(node)) return // already fully explored — no cycle from here

    visited.add(node)
    inStack.add(node)
    stack.push(node)

    for (const neighbor of adjList.get(node) ?? []) {
      dfs(neighbor)
    }

    stack.pop()
    inStack.delete(node)
  }

  for (const name of adjList.keys()) {
    dfs(name)
  }

  return errors
}

// ─── MAX_SIZE_EXCEEDS_GLOBAL_LIMIT ────────────────────────────────────────────

function checkMaxSizeLimit(
  registry: SchemaRegistry,
  globalMaxFileSize: number
): ParseError[] {
  const errors: ParseError[] = []

  for (const schema of Object.values(registry.schemas)) {
    if (schema.schema_type === 'enum-type') continue

    for (const field of schema.fields) {
      if (
        field.field_type !== 'image' &&
        field.field_type !== 'video' &&
        field.field_type !== 'file'
      ) {
        continue
      }

      const fieldMaxSize = field.validation.max_size
      if (fieldMaxSize === undefined || fieldMaxSize <= globalMaxFileSize) continue

      errors.push({
        file: schema.source_file,
        code: 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT',
        message:
          `Field "${field.name}": max_size ${fieldMaxSize} bytes exceeds ` +
          `global limit of ${globalMaxFileSize} bytes`,
        path: `fields[${field.order}].max_size`,
      })
    }
  }

  return errors
}

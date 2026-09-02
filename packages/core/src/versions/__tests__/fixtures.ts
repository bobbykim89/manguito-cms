import { parseSchema } from '../../parser/parseSchema'
import { buildSchemaRegistry } from '../../parser/validate'
import type { ParsedSchema } from '../../parser/parseSchema'
import type { ParsedRoutes, ParsedRoles, SchemaRegistry } from '../../parser/validate'
import type { PendingChanges, VersionHistory } from '../types'

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

export const EMPTY_HISTORY: VersionHistory = { renames: [], drops: [], fallbacks: {} }
export const EMPTY_PENDING: PendingChanges = { renames: [], drops: [], fallbacks: {} }

export type FieldSpec = {
  name: string
  type?: string
  required?: boolean
  ref?: string
  rel?: string
  // ─── Version declarations, passed straight through to the raw field ───────
  // Divergence between a field's name and its column is now DECLARED, so a
  // fixture states it the same way a schema author would. Nothing is
  // hand-forged onto a ParsedField: it still goes through parseSchema.
  column?: string
  removed?: boolean
  fallback?: unknown
}

/**
 * Builds the raw field object parseSchema expects, from a FieldSpec.
 * A `type: 'paragraph'` spec goes through the paragraph field shape (ref/rel)
 * so its db_column comes back genuinely null, by construction — never hand-forced.
 */
function toRawField(f: FieldSpec) {
  const required = f.required ?? false
  const declarations = {
    ...(f.column !== undefined && { column: f.column }),
    ...(f.removed !== undefined && { removed: f.removed }),
    ...(f.fallback !== undefined && { fallback: f.fallback }),
  }
  if (f.type === 'paragraph') {
    return {
      name: f.name,
      label: f.name,
      type: 'paragraph',
      ref: f.ref,
      rel: f.rel ?? 'one-to-many',
      required,
      ...declarations,
    }
  }
  return {
    name: f.name,
    label: f.name,
    type: f.type ?? 'text/plain',
    required,
    ...declarations,
  }
}

/**
 * A content type whose fields are plain text unless `type` says otherwise.
 * Goes through parseSchema, so every field gets a real db_column with
 * column_name === name — the pre-divergence state. Divergence is never
 * hand-written: a snapshot uses the OLD label, a rename is declared, and the
 * fold derives the column.
 *
 * ContentTypeRawSchema requires fields wrapped in tabs (>=1 tab) — the parser
 * flattens them back out, but the raw input must go through a tab wrapper.
 */
export function makeContentType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'x',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: fields.map(toRawField),
          },
        },
      ],
    },
    'content-type',
    `schemas/content-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

/** Same, as a taxonomy type — Task 3's union must treat both maps identically. */
export function makeTaxonomyType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'taxonomy-type',
      fields: fields.map(toRawField),
    },
    'taxonomy-type',
    `schemas/taxonomy-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

/**
 * Same, as a paragraph type — flat fields, no tabs. Needed to exercise the
 * retention boundary: paragraph types are the one kind the union registry
 * passes through untouched.
 */
export function makeParagraphType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'paragraph-type',
      fields: fields.map(toRawField),
    },
    'paragraph-type',
    `schemas/paragraph-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

export function makeRegistry(schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, EMPTY_ROUTES, EMPTY_ROLES)
}

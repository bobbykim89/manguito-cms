import { GraphQLError } from 'graphql'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import type { GraphQLContext } from './context.js'
import { translateFilters } from './filters.js'
import { isColumnBacked, type FieldKeyMap } from '../field-keys.js'

type Row = Record<string, unknown>

function codeError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } })
}

function isPublished(item: Row | null): boolean {
  return !!item && item['published'] === true
}

/**
 * A GraphQL field's value on a content row. The GraphQL field NAME comes from
 * the field's label (see naming.ts), but the value lives under its storage
 * column, which differs once a field has been renamed.
 *
 * `fallback` is the value a version declares for a column that stopped being
 * written: rows created since the removal hold null there. Substituted on
 * null/undefined ONLY — never on '' or 0 — matching projectRow's rule, so the
 * REST and GraphQL surfaces cannot disagree about the same version.
 */
export function resolveFieldValue(
  field: ParsedField,
  row: Record<string, unknown>,
  fallback?: unknown
): unknown {
  const key = isColumnBacked(field) ? field.db_column.column_name : field.name
  const value = row[key]
  if ((value === null || value === undefined) && fallback !== undefined) return fallback
  return value ?? null
}

export function scalarFieldResolver(field: ParsedField, fallback?: unknown) {
  return (parent: Row): unknown => resolveFieldValue(field, parent, fallback)
}

export function relationFieldResolver(typeName: string, schemaFieldName: string) {
  return (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> =>
    ctx.loaders.load(typeName, schemaFieldName, parent)
}

/**
 * A media field, in both key spaces the programmatic record straddles.
 *
 * `name` is the field's REGISTRY name — the only key `ctx.loaders.load` can
 * look a field up by, and therefore the key the resolved object lands on.
 * `exposedAs` is the label the version being served uses, which is where
 * `ctx.get()` will look for it. They differ exactly when this version renames
 * the field, and that is the whole reason both are needed.
 */
export type MediaFieldKey = { name: string; exposedAs: string }

export function programmaticFieldResolver(
  typeName: string,
  schemaFieldName: string,
  mediaFields: readonly MediaFieldKey[] = [],
  fieldKeys?: FieldKeyMap
) {
  return async (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> => {
    let p = ctx.programmaticMemo.get(parent)
    if (!p) {
      p = resolveProgrammaticRow(typeName, parent, ctx, mediaFields, fieldKeys)
      ctx.programmaticMemo.set(parent, p)
    }
    return (await p)[schemaFieldName]
  }
}

// A programmatic resolver reads its record through `ctx.get()`, so that record
// must look the same on both public surfaces. REST resolves media fields to full
// objects before running resolvers; GraphQL reads through repositories that
// resolve nothing, so without this `ctx.get('hero').url` would work over REST and
// silently fall back to null over GraphQL.
//
// Media is resolved into a COPY, never the row itself: the dataloaders write
// their results back into the row they are handed, and the real row must keep the
// raw id so a query that also selects the media field still resolves. Handing an
// already-resolved object back to the loader is exactly what broke media here in
// the first place. Copies still batch — one media query per request, not per row.
//
// `ctx.get(fieldName)` takes the schema field name (the LABEL), so the record is
// projected to labels before the resolver runs — the same order REST uses (see
// "Response projection order" in routes/content.ts). GraphQL has no route-level
// projection to double up with: every other field resolves per field by column
// (resolveFieldValue), so this copy is the only mapped row, and it is mapped
// strictly after the media loaders have run.
//
// The loaders write onto a field's REGISTRY name, but `toLabels` speaks the
// served version's labels, and a version that renames a media field agrees with
// neither: createFieldKeyMapFromProjection un-drops only a projected COLUMN or
// LABEL, so the registry name of a renamed field stays in the drop-set and
// `remap` deletes the resolved object outright (and the raw FK column is
// already gone — resolveRelationField deletes it whenever the field's name
// differs from its column). Re-attaching each resolved value under this
// version's own label AFTER the remap is what closes that gap. Done by explicit
// assignment rather than by letting `remap` carry the key, because the raw
// column and the resolved object can map onto the same label and key order must
// not decide which one wins: the resolved object always does.
async function resolveProgrammaticRow(
  typeName: string,
  parent: Row,
  ctx: GraphQLContext,
  mediaFields: readonly MediaFieldKey[],
  fieldKeys?: FieldKeyMap
): Promise<Record<string, unknown>> {
  const toLabels = (row: Row): Row => (fieldKeys ? fieldKeys.toLabels(row) : row)

  if (mediaFields.length === 0) return ctx.resolver.resolveItem(typeName, toLabels(parent))

  const enriched: Row = { ...parent }
  await Promise.all(mediaFields.map((m) => ctx.loaders.load(typeName, m.name, enriched)))
  return ctx.resolver.resolveItem(typeName, relabelMedia(toLabels(enriched), enriched, mediaFields))
}

/**
 * `record` (already label-keyed) with each resolved media value restored under
 * the label this version exposes it as. Writes only into `record` — either the
 * fresh object `remap` just returned, or, with no FieldKeyMap, the `enriched`
 * copy itself. Never the caller's row, which must keep its raw FK ids.
 *
 * A field the loaders never wrote is skipped rather than written as undefined —
 * `resolveRelationField` returns early when no row needs FK resolution, and a
 * present-but-undefined key is not the same record shape REST produces.
 */
function relabelMedia(record: Row, enriched: Row, mediaFields: readonly MediaFieldKey[]): Row {
  for (const { name, exposedAs } of mediaFields) {
    if (!(name in enriched)) continue
    record[exposedAs] = enriched[name]
  }
  return record
}

type CollectionArgs = {
  page?: number
  perPage?: number
  /**
   * The sort enum's internal value (filters.ts `SORTABLE`), which mixes two key
   * spaces: `created_at` / `updated_at` are system COLUMNS, but `title` is a
   * schema field's LABEL. It must be mapped before it reaches the repository.
   */
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  filter?: Record<string, unknown>
}

export function collectionResolver(
  typeName: string,
  nameMap: { toSchema(g: string): string },
  fieldKeys?: FieldKeyMap
) {
  return async (_root: unknown, args: CollectionArgs, ctx: GraphQLContext) => {
    const page = args.page ?? 1
    const perPage = args.perPage ?? 10
    if (!Number.isInteger(page) || page < 1) {
      throw codeError('INVALID_PAGINATION', 'page must be ≥ 1')
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw codeError('INVALID_PAGINATION', 'perPage must be between 1 and 100')
    }
    const repo = ctx.repos[typeName]!
    // `ORDER BY` takes a storage column, never a label. `columnFor` resolves a
    // schema field's label to its column; a system column (`created_at`,
    // `updated_at`) is not a label at all, so it has no entry and falls
    // through unchanged. Identity today, since every label equals its column.
    const sortBy = args.sortBy ?? 'created_at'
    const sortColumn = fieldKeys?.columnFor(sortBy) ?? sortBy
    const result = await repo.findMany({
      published_only: true,
      page,
      per_page: perPage,
      sort_by: sortColumn as 'title' | 'created_at' | 'updated_at',
      sort_order: args.sortOrder ?? 'asc',
      filters: translateFilters(args.filter, nameMap, fieldKeys?.columnFor),
    })
    return { data: result.data as Row[], meta: result.meta }
  }
}

export function singleBySlugResolver(typeName: string) {
  return async (_root: unknown, args: { slug: string }, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const item = (await repo.findBySlug(args.slug)) as Row | null
    return isPublished(item) ? item : null
  }
}

export function singletonResolver(typeName: string) {
  return async (_root: unknown, _args: unknown, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const result = await repo.findMany({ published_only: true, page: 1, per_page: 1 })
    return (result.data[0] as Row | undefined) ?? null
  }
}

export function taxonomySingleResolver(typeName: string) {
  return async (_root: unknown, args: { id: string }, ctx: GraphQLContext): Promise<Row | null> => {
    const repo = ctx.repos[typeName]!
    const item = (await repo.findOne(args.id)) as Row | null
    return isPublished(item) ? item : null
  }
}

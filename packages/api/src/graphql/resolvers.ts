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
 */
export function resolveFieldValue(field: ParsedField, row: Record<string, unknown>): unknown {
  const key = isColumnBacked(field) ? field.db_column.column_name : field.name
  return row[key] ?? null
}

export function scalarFieldResolver(field: ParsedField) {
  return (parent: Row): unknown => resolveFieldValue(field, parent)
}

export function relationFieldResolver(typeName: string, schemaFieldName: string) {
  return (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> =>
    ctx.loaders.load(typeName, schemaFieldName, parent)
}

export function programmaticFieldResolver(
  typeName: string,
  schemaFieldName: string,
  mediaFieldNames: readonly string[] = [],
  fieldKeys?: FieldKeyMap
) {
  return async (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> => {
    let p = ctx.programmaticMemo.get(parent)
    if (!p) {
      p = resolveProgrammaticRow(typeName, parent, ctx, mediaFieldNames, fieldKeys)
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
async function resolveProgrammaticRow(
  typeName: string,
  parent: Row,
  ctx: GraphQLContext,
  mediaFieldNames: readonly string[],
  fieldKeys?: FieldKeyMap
): Promise<Record<string, unknown>> {
  const toLabels = (row: Row): Row => (fieldKeys ? fieldKeys.toLabels(row) : row)

  if (mediaFieldNames.length === 0) return ctx.resolver.resolveItem(typeName, toLabels(parent))

  const enriched: Row = { ...parent }
  await Promise.all(mediaFieldNames.map((name) => ctx.loaders.load(typeName, name, enriched)))
  return ctx.resolver.resolveItem(typeName, toLabels(enriched))
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

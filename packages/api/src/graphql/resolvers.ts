import { GraphQLError } from 'graphql'
import type { GraphQLContext } from './context.js'
import { translateFilters } from './filters.js'

type Row = Record<string, unknown>

function codeError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } })
}

function isPublished(item: Row | null): boolean {
  return !!item && item['published'] === true
}

export function scalarFieldResolver(schemaName: string) {
  return (parent: Row): unknown => parent[schemaName]
}

export function relationFieldResolver(typeName: string, schemaFieldName: string) {
  return (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> =>
    ctx.loaders.load(typeName, schemaFieldName, parent)
}

export function programmaticFieldResolver(typeName: string, schemaFieldName: string) {
  return async (parent: Row, _args: unknown, ctx: GraphQLContext): Promise<unknown> => {
    let p = ctx.programmaticMemo.get(parent)
    if (!p) {
      p = ctx.resolver.resolveItem(typeName, parent)
      ctx.programmaticMemo.set(parent, p)
    }
    return (await p)[schemaFieldName]
  }
}

type CollectionArgs = {
  page?: number
  perPage?: number
  sortBy?: string // already the snake_case column (enum internal value)
  sortOrder?: 'asc' | 'desc'
  filter?: Record<string, unknown>
}

export function collectionResolver(
  typeName: string,
  nameMap: { toSchema(g: string): string }
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
    const result = await repo.findMany({
      published_only: true,
      page,
      per_page: perPage,
      sort_by: (args.sortBy ?? 'created_at') as 'title' | 'created_at' | 'updated_at',
      sort_order: args.sortOrder ?? 'asc',
      filters: translateFilters(args.filter, nameMap),
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

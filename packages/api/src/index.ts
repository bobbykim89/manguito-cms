import type {
  APIAdapter,
  ResolvedRateLimitConfig,
  GraphQLModuleConfig,
  ResolvedGraphQLConfig,
} from '@bobbykim/manguito-cms-core'

export { createCmsApp } from './app.js'
export type { CreateCmsAppOptions } from './app.js'

export { createServer } from './server/node.js'
export type { NodeServerOptions } from './server/node.js'

export { createProgrammaticResolver, validateResolverBindings, resolverKey } from './programmatic/resolve.js'
export type { ResolverMap, ProgrammaticResolver } from './programmatic/resolve.js'

// ─── User-facing config factory ───────────────────────────────────────────────

export type APIAdapterOptions = {
  prefix?: string
  media?: {
    max_file_size?: number
  }
  rateLimit?: ResolvedRateLimitConfig
  graphql?: GraphQLModuleConfig
}

function resolveGraphQL(cfg: GraphQLModuleConfig): ResolvedGraphQLConfig {
  const devDefault = process.env['NODE_ENV'] !== 'production'
  return {
    enabled: cfg.enabled ?? false,
    maxDepth: cfg.maxDepth ?? 8,
    maxComplexity: cfg.maxComplexity ?? 1000,
    graphiql: cfg.graphiql ?? devDefault,
    introspection: cfg.introspection ?? cfg.graphiql ?? devDefault,
  }
}

export function createAPIAdapter(options: APIAdapterOptions = {}): APIAdapter {
  const prefix = options.prefix ?? '/api'
  const media = options.media?.max_file_size !== undefined
    ? { max_file_size: options.media.max_file_size }
    : undefined

  return {
    prefix,
    ...(media !== undefined && { media }),
    ...(options.rateLimit !== undefined && { rateLimit: options.rateLimit }),
    ...(options.graphql !== undefined && { graphql: resolveGraphQL(options.graphql) }),
  }
}

import { createYoga } from 'graphql-yoga'
import type { Handler } from 'hono'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { GraphQLContext } from './context.js'
import { buildGraphQLSchema } from './schema.js'
import { createRelationLoaders } from './dataloaders.js'
import { buildArmorPlugin, introspectionPlugin } from './security.js'

export type ResolvedGraphQLOptions = {
  enabled: boolean
  maxDepth: number
  maxComplexity: number
  graphiql: boolean
  introspection: boolean
}

export function createGraphQLHandler(
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<unknown>>,
  resolver: ProgrammaticResolver,
  db: DrizzlePostgresInstance,
  options: ResolvedGraphQLOptions
): Handler {
  const schema = buildGraphQLSchema(registry)
  const { plugins } = buildArmorPlugin({
    maxDepth: options.maxDepth,
    maxComplexity: options.maxComplexity,
  })

  const yoga = createYoga<Record<string, never>, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: options.graphiql,
    landingPage: false,
    // buildArmorPlugin's return type is `unknown[]` (see security.ts) since Armor's
    // plugin shapes aren't part of its public typings; Yoga's `plugins` option only
    // accepts its own `Plugin` type, so the cast bridges the two.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: [...(plugins as any[]), introspectionPlugin(options.introspection)],
    context: (): GraphQLContext => ({
      db,
      registry,
      repos,
      resolver,
      loaders: createRelationLoaders(db, registry),
      programmaticMemo: new WeakMap(),
    }),
  })

  return (c) => yoga.fetch(c.req.raw, {})
}

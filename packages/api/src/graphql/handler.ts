import { createYoga, maskError } from 'graphql-yoga'
import type { Handler } from 'hono'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { FieldKeyMap } from '../field-keys.js'
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

// Yoga decides whether an error is safe to show a client with
// `error instanceof GraphQLError`. That check is realm-sensitive: GraphQL Armor
// is CJS and throws a GraphQLError built from graphql's CJS entry, while Yoga is
// ESM and compares against the class from graphql's ESM entry. Same version, two
// classes — so `instanceof` fails and a depth/complexity rejection, which is the
// client's own query being too large, was masked as
// `INTERNAL_SERVER_ERROR: Unexpected error.` and logged server-side as a fault.
//
// Identify by name instead (what envelop's own masking does), walking the
// originalError chain the same way. A GraphQLError with no originalError was
// constructed deliberately by a validation rule or by us and carries no internals;
// anything else — a resolver throwing, a driver error — still goes to Yoga's
// masking untouched, dev-mode originalError detail included.
function isClientSafeGraphQLError(error: unknown): boolean {
  let current = error as { name?: string; originalError?: unknown } | null | undefined
  while (current != null && typeof current === 'object' && current.name === 'GraphQLError') {
    if (current.originalError == null) return true
    current = current.originalError as typeof current
  }
  return false
}

export function createGraphQLHandler(
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<unknown>>,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  resolver: ProgrammaticResolver,
  db: DrizzlePostgresInstance,
  options: ResolvedGraphQLOptions
): Handler {
  const schema = buildGraphQLSchema(registry, fieldKeyMaps)
  const { plugins } = buildArmorPlugin({
    maxDepth: options.maxDepth,
    maxComplexity: options.maxComplexity,
  })

  const yoga = createYoga<Record<string, never>, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: options.graphiql,
    landingPage: false,
    maskedErrors: {
      maskError: (error, message, isDev) =>
        isClientSafeGraphQLError(error) ? (error as Error) : maskError(error, message, isDev),
    },
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

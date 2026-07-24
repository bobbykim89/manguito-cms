import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { ProgrammaticResolver } from '../programmatic/resolve.js'
import type { RelationLoaders } from './dataloaders.js'

export interface GraphQLContext {
  db: DrizzlePostgresInstance
  registry: SchemaRegistry
  repos: Record<string, ContentRepository<unknown>>
  resolver: ProgrammaticResolver
  loaders: RelationLoaders
  // Per-request memo: a parent row → its resolveItem() promise (all programmatic
  // fields computed once per parent, only when the first is selected).
  programmaticMemo: WeakMap<object, Promise<Record<string, unknown>>>
}

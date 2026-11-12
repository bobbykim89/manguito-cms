import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

// The app under test, built from api's source so integration tests never read
// a stale dist.
export function createTestApp(schema: SchemaRegistry, db: DrizzlePostgresInstance) {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: schema,
    db,
  })
  return app
}

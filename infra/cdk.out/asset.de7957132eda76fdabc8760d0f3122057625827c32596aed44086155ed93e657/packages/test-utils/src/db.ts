import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { sql } from 'drizzle-orm'

export async function getTestDb(): Promise<DrizzlePostgresInstance> {
  const url = process.env['DB_URL']
  if (!url) {
    throw new Error(
      'DB_URL is not set. Add it to .env.test before running integration tests.',
    )
  }
  const adapter = createPostgresAdapter({ url })
  await adapter.connect()
  return adapter.getDb()
}

export async function teardownTestData(
  db: DrizzlePostgresInstance,
  tableName: string,
  id: string,
): Promise<void> {
  await db.execute(
    sql`DELETE FROM ${sql.raw(`"${tableName}"`)} WHERE id = ${id}`,
  )
}

import { createPostgresAdapter, seedSystemTables, type DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { sql } from 'drizzle-orm'
import { testParsedSchema, testRoleUsers } from './fixtures.js'

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

// Seeds the system tables, then the role users in testRoleUsers. Idempotent:
// any prior row occupying a fixture's id or email is cleared before the insert.
// An `ON CONFLICT (email)` upsert alone can't absorb a primary-key collision, so
// an orphaned row left at a fixture id by an interrupted run would otherwise
// fail the seed on a re-run against a persistent DB. Suites that truncate
// roles/users call this again in beforeAll to restore the globalSetup seed.
export async function seedRoleUsers(db: DrizzlePostgresInstance): Promise<void> {
  await seedSystemTables(db, testParsedSchema)
  for (const user of testRoleUsers) {
    const hash = await hashPassword(user.password)
    await db.execute(sql`DELETE FROM users WHERE id = ${user.id} OR email = ${user.email}`)
    await db.execute(
      sql`INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
          SELECT ${user.id}, ${user.email}, ${hash}, r.id, ${user.token_version}, ${user.must_change_password}
          FROM roles r WHERE r.name = ${user.role}`,
    )
  }
}

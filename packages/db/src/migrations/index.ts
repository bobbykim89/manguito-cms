import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import type { MigrationResult, MigrationStatus } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance, MigrationRunnerOptions } from '../types'

export async function runDevMigration(configPath: string): Promise<void> {
  execSync(`drizzle-kit push --config=${configPath}`, { stdio: 'inherit' })
}

export async function generateMigration(
  configPath: string,
  migrationsFolder: string,
): Promise<string[]> {
  let beforeFiles: string[] = []
  try {
    const entries = await fs.readdir(migrationsFolder)
    beforeFiles = entries.filter((f) => f.endsWith('.sql'))
  } catch {
    // folder doesn't exist yet — no prior migrations
  }

  execSync(`drizzle-kit generate --config=${configPath}`, { stdio: 'inherit' })

  let afterFiles: string[] = []
  try {
    const entries = await fs.readdir(migrationsFolder)
    afterFiles = entries.filter((f) => f.endsWith('.sql'))
  } catch {
    // folder still doesn't exist after generate — nothing created
  }

  const beforeSet = new Set(beforeFiles)
  return afterFiles.filter((f) => !beforeSet.has(f))
}

export async function applyMigrations(
  configPath: string,
  db: DrizzlePostgresInstance,
  options: MigrationRunnerOptions,
): Promise<MigrationResult> {
  execSync(`drizzle-kit migrate --config=${configPath}`, { stdio: 'inherit' })

  const status = await getMigrationStatus(db, options)
  return {
    applied: status.applied.length,
    skipped: 0,
  }
}

export async function getMigrationStatus(
  db: DrizzlePostgresInstance,
  options: MigrationRunnerOptions,
): Promise<MigrationStatus> {
  const { migrationsTable, migrationsFolder } = options

  let applied: string[] = []
  try {
    const result = await db.execute(
      sql.raw(
        `SELECT migration_name FROM "${migrationsTable}" ORDER BY created_at`,
      ),
    )
    applied = result.rows.map((r) => (r as { migration_name: string }).migration_name)
  } catch {
    // table doesn't exist yet — no migrations applied
  }

  let allFiles: string[] = []
  try {
    const entries = await fs.readdir(migrationsFolder)
    allFiles = entries.filter((f) => f.endsWith('.sql')).sort()
  } catch {
    // folder doesn't exist yet — no migrations generated
  }

  const appliedSet = new Set(applied)
  const pending = allFiles.filter((f) => !appliedSet.has(f))

  return { applied, pending }
}

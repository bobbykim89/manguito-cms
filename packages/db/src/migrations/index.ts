import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import type { MigrationResult, MigrationStatus } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance, MigrationRunnerOptions } from '../types'

export async function runDevMigration(configPath: string): Promise<void> {
  execSync(`drizzle-kit push --config=${configPath}`, { stdio: 'inherit', cwd: path.dirname(configPath) })
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

  execSync(`drizzle-kit generate --config=${configPath}`, { stdio: 'inherit', cwd: path.dirname(configPath) })

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
  execSync(`drizzle-kit migrate --config=${configPath}`, { stdio: 'inherit', cwd: path.dirname(configPath) })

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

  // drizzle-kit tracks migrations by content hash and a bigint timestamp.
  // The journal maps filenames (via tag + .sql) to the `when` timestamp value
  // that drizzle-kit inserts into the tracking table's `created_at` column.
  type JournalEntry = { when: number; tag: string }
  let journalEntries: JournalEntry[] = []
  try {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
    const raw = await fs.readFile(journalPath, 'utf-8')
    const journal = JSON.parse(raw) as { entries: JournalEntry[] }
    journalEntries = journal.entries
  } catch {
    return { applied: [], pending: [] }
  }

  const appliedWhenSet = new Set<number>()
  try {
    const result = await db.execute(
      sql.raw(`SELECT created_at FROM "${migrationsTable}"`),
    )
    for (const row of result.rows) {
      appliedWhenSet.add(Number((row as { created_at: string | number }).created_at))
    }
  } catch {
    // table doesn't exist yet — no migrations applied
  }

  const applied: string[] = []
  const pending: string[] = []
  for (const entry of journalEntries) {
    const filename = `${entry.tag}.sql`
    if (appliedWhenSet.has(entry.when)) {
      applied.push(filename)
    } else {
      pending.push(filename)
    }
  }

  return { applied, pending }
}

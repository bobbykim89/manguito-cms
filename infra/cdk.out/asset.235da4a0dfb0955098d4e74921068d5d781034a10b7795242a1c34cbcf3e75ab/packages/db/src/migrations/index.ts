import { execSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
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
  const { migrationsTable, migrationsFolder } = options

  // Pre-create the tracking table without a serial/sequence column so that
  // drizzle-kit finds it already exists and skips its own CREATE TABLE.
  // This prevents an orphaned sequence from appearing in the DB, which
  // drizzle-kit push would otherwise try to drop (non-fatally, but noisily).
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${migrationsTable}" (hash text NOT NULL, created_at bigint)`,
    ),
  )

  // Reconcile migrations that are pending in the tracking table but already
  // applied in the DB — the typical result of running `manguito dev` (which
  // uses drizzle-kit push and never writes to the tracking table) before
  // `manguito migrate`.  For each pending migration, check whether the first
  // table it creates already exists in Postgres.  If it does, seed the
  // tracking record so drizzle-kit migrate treats it as applied.
  const statusBefore = await getMigrationStatus(db, options)
  if (statusBefore.pending.length > 0) {
    type JournalEntry = { when: number; tag: string }
    let journalEntries: JournalEntry[] = []
    try {
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
      const raw = await fs.readFile(journalPath, 'utf-8')
      journalEntries = (JSON.parse(raw) as { entries: JournalEntry[] }).entries
    } catch { /* no journal — skip reconciliation */ }

    for (const pendingFile of statusBefore.pending) {
      const sqlPath = path.join(migrationsFolder, pendingFile)
      let sqlContent: string
      try {
        sqlContent = await fs.readFile(sqlPath, 'utf-8')
      } catch { continue }

      // Extract the first table name from the migration SQL.
      const tableMatch = sqlContent.match(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/)
      if (!tableMatch) continue
      const tableName = tableMatch[1]

      const checkResult = await db.execute(
        sql.raw(`SELECT to_regclass('"${tableName}"') AS t`),
      )
      const tableExists = (checkResult.rows[0] as { t: string | null } | undefined)?.t !== null

      if (!tableExists) continue

      // Table already exists — seed the tracking record.
      const entry = journalEntries.find((e) => `${e.tag}.sql` === pendingFile)
      if (!entry) continue
      const hash = crypto.createHash('sha256').update(sqlContent).digest('hex')
      await db.execute(
        sql.raw(
          `INSERT INTO "${migrationsTable}" (hash, created_at) ` +
          `SELECT '${hash}', ${entry.when} ` +
          `WHERE NOT EXISTS (SELECT 1 FROM "${migrationsTable}" WHERE created_at = ${entry.when})`,
        ),
      )
    }
  }

  // After reconciliation, re-check status. If all pending migrations are now
  // marked applied (by the reconciliation above), skip drizzle-kit migrate —
  // there is nothing for it to do and it would fail on "relation already exists".
  const statusAfter = await getMigrationStatus(db, options)
  if (statusAfter.pending.length === 0) {
    return { applied: statusAfter.applied.length, skipped: 0 }
  }

  const result = spawnSync(
    'drizzle-kit',
    ['migrate', `--config=${configPath}`],
    { cwd: path.dirname(configPath), encoding: 'utf8' },
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    const raw = result.stderr?.trim() || result.stdout?.trim() || ''
    const detail = raw || `drizzle-kit exited with status ${String(result.status)}`
    // "already exists" means the migrations folder was regenerated while the DB
    // already has the schema.  Tell the user how to recover rather than dumping
    // the raw spinner output.
    if (raw.includes('already exists')) {
      throw new Error(
        'Migration failed: a table that already exists was included in the migration.\n' +
        'This usually means the migrations folder was deleted and regenerated.\n' +
        'Fix: insert the pending migration\'s timestamp into the tracking table so\n' +
        'drizzle-kit treats it as already applied, then re-run `manguito migrate`.\n' +
        `Raw drizzle-kit output:\n${raw}`
      )
    }
    throw new Error(detail)
  }

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

// manguito createsuperuser — create initial admin user
import type { Command } from 'commander'
import { sql } from '@bobbykim/manguito-cms-db'
import type { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { hashPassword } from '@bobbykim/manguito-cms-core'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { connectDb } from '../utils/db.js'
import { printGuidedError, printSuccess } from '../utils/error.js'
import { createPromptAdapter, type PromptAdapter } from '../utils/prompt.js'

type PostgresAdapter = ReturnType<typeof createPostgresAdapter>

type CreatesuperuserOptions = {
  env?: string
}

type CreatesuperuserDeps = {
  db: PostgresAdapter
  prompt: PromptAdapter
}

export function registerCreateSuperuser(program: Command): void {
  program
    .command('createsuperuser')
    .description('Create the initial admin user')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: CreatesuperuserOptions) => {
      loadEnvFile(options.env)
      const config = await resolveConfig(process.cwd())
      const db = await connectDb(config)
      await runCreateSuperuser(options, { db, prompt: createPromptAdapter() })
    })
}

export async function runCreateSuperuser(
  _options: CreatesuperuserOptions,
  deps: CreatesuperuserDeps,
): Promise<void> {
  const { db, prompt } = deps

  // 1. DB reachable
  if (!db.isConnected()) {
    printGuidedError(
      'Cannot connect to the database.',
      'Check your DB_URL and ensure the database is running.',
    )
    process.exit(1)
  }

  // 2. users table exists
  const usersTableExists = await db.tableExists('users')
  if (!usersTableExists) {
    printGuidedError(
      'Database tables do not exist yet.',
      'Run `manguito migrate` first to set up the database, then try again.',
    )
    process.exit(1)
  }

  // 3. Roles seeded
  const rolesCountResult = await db.getDb().execute(sql`SELECT COUNT(*)::int AS count FROM roles`)
  const rolesRow = rolesCountResult.rows[0]
  const rolesCount =
    rolesRow !== undefined ? Number((rolesRow as { count: string | number }).count) : 0
  if (rolesCount === 0) {
    printGuidedError(
      'No roles found in the database.',
      'Run `manguito migrate` to seed system roles, then try again.',
    )
    process.exit(1)
  }

  process.stdout.write('\nCreating superuser. Press Ctrl+C to cancel.\n\n')

  // Email loop
  let email: string
  while (true) {
    email = await prompt.input('Admin email:')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      process.stderr.write('✖ Invalid email format. Please enter a valid email address.\n')
      continue
    }

    const existingResult = await db.getDb().execute(
      sql`SELECT 1 FROM users WHERE email = ${email} LIMIT 1`,
    )
    if (existingResult.rows.length > 0) {
      process.stderr.write(
        '✖ A user with that email already exists. Please use a different email.\n',
      )
      continue
    }

    break
  }

  // Password loop
  let passwordHash: string
  while (true) {
    const pw = await prompt.password('Admin password:')

    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      process.stderr.write(
        '✖ Password must be at least 8 characters and contain at least one letter and one number.\n',
      )
      continue
    }

    const confirm = await prompt.password('Confirm password:')
    if (pw !== confirm) {
      process.stderr.write('✖ Passwords do not match.\n')
      continue
    }

    passwordHash = await hashPassword(pw)
    break
  }

  // Role lookup — highest hierarchy (lowest hierarchy_level value)
  const roleResult = await db.getDb().execute(
    sql`SELECT id, name FROM roles ORDER BY hierarchy_level ASC LIMIT 1`,
  )
  const roleRow = roleResult.rows[0]
  if (roleRow === undefined) {
    printGuidedError(
      'No roles found in the database.',
      'Run `manguito migrate` to seed system roles, then try again.',
    )
    process.exit(1)
  }
  const roleId = (roleRow as { id: string; name: string }).id

  // Insert user
  const userId = crypto.randomUUID()
  await db.getDb().execute(sql`
    INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
    VALUES (${userId}, ${email}, ${passwordHash}, ${roleId}, 0, false)
  `)

  process.stdout.write('\n')
  printSuccess(`Admin account created: ${email}`)
  process.stdout.write('  You can now log in at /admin with the credentials above.\n')
}

// manguito users:promote / users:demote — manage user roles
import type { Command } from 'commander'
import { sql } from '@bobbykim/manguito-cms-db'
import type { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { connectDb } from '../utils/db.js'
import { printGuidedError, printWarning, printSuccess } from '../utils/error.js'
import { createPromptAdapter, type PromptAdapter } from '../utils/prompt.js'

type PostgresAdapter = ReturnType<typeof createPostgresAdapter>

type UsersOptions = {
  email?: string
  env?: string
}

type UsersDemoteOptions = {
  email?: string
  role?: string
  env?: string
}

type UsersDeps = {
  db: PostgresAdapter
  prompt: PromptAdapter
}

export function registerUsers(program: Command): void {
  program
    .command('users:promote')
    .description('Promote a user to admin')
    .option('--env <path>', 'path to .env file to load')
    .option('--email <email>', 'email address of the user to promote')
    .action(async (options: UsersOptions) => {
      loadEnvFile(options.env)
      const config = await resolveConfig(process.cwd())
      const db = await connectDb(config)
      await runUsersPromote(options, { db, prompt: createPromptAdapter() })
    })

  program
    .command('users:demote')
    .description('Demote an admin to a lower role')
    .option('--env <path>', 'path to .env file to load')
    .option('--email <email>', 'email address of the user to demote')
    .option('--role <role>', 'role name to demote to')
    .action(async (options: UsersDemoteOptions) => {
      loadEnvFile(options.env)
      const config = await resolveConfig(process.cwd())
      const db = await connectDb(config)
      await runUsersDemote(options, { db, prompt: createPromptAdapter() })
    })
}

async function checkPreconditions(db: PostgresAdapter): Promise<boolean> {
  if (!db.isConnected()) {
    printGuidedError(
      'Cannot connect to the database.',
      'Check your DB_URL and ensure the database is running.',
    )
    return false
  }

  const usersTableExists = await db.tableExists('users')
  if (!usersTableExists) {
    printGuidedError(
      'Users table not found.',
      'Run `manguito migrate` to initialise the database, then try again.',
    )
    return false
  }

  return true
}

export async function runUsersPromote(
  options: UsersOptions,
  deps: UsersDeps,
): Promise<void> {
  const { db, prompt } = deps

  if (!(await checkPreconditions(db))) {
    process.exit(1)
  }

  // Resolve email
  const email = options.email ?? (await prompt.input('User email:'))

  // Lookup user
  const userResult = await db.getDb().execute(
    sql`SELECT id, role_id FROM users WHERE email = ${email} LIMIT 1`,
  )
  if (userResult.rows.length === 0) {
    printGuidedError(`No user found with email "${email}".`)
    process.exit(1)
  }
  const user = userResult.rows[0] as { id: string; role_id: string }

  // Lookup highest-hierarchy role
  const topRoleResult = await db.getDb().execute(
    sql`SELECT id, name FROM roles ORDER BY hierarchy_level ASC LIMIT 1`,
  )
  const topRoleRow = topRoleResult.rows[0] as { id: string; name: string } | undefined
  if (topRoleRow === undefined) {
    printGuidedError(
      'No roles found in the database.',
      'Run `manguito migrate` to seed system roles, then try again.',
    )
    process.exit(1)
  }

  // Guard: already at highest role
  if (user.role_id === topRoleRow.id) {
    printWarning(`${email} is already an ${topRoleRow.name}. No changes made.`)
    return
  }

  // Promote
  await db.getDb().execute(
    sql`UPDATE users SET role_id = ${topRoleRow.id} WHERE id = ${user.id}`,
  )
  printSuccess(`${email} promoted to ${topRoleRow.name}.`)
}

export async function runUsersDemote(
  options: UsersDemoteOptions,
  deps: UsersDeps,
): Promise<void> {
  const { db, prompt } = deps

  if (!(await checkPreconditions(db))) {
    process.exit(1)
  }

  // Resolve email
  const email = options.email ?? (await prompt.input('User email:'))

  // Lookup user
  const userResult = await db.getDb().execute(
    sql`SELECT id, role_id FROM users WHERE email = ${email} LIMIT 1`,
  )
  if (userResult.rows.length === 0) {
    printGuidedError(`No user found with email "${email}".`)
    process.exit(1)
  }
  const user = userResult.rows[0] as { id: string; role_id: string }

  // Lookup highest-hierarchy role
  const topRoleResult = await db.getDb().execute(
    sql`SELECT id, name FROM roles ORDER BY hierarchy_level ASC LIMIT 1`,
  )
  const topRoleRow = topRoleResult.rows[0] as { id: string; name: string } | undefined
  if (topRoleRow === undefined) {
    printGuidedError(
      'No roles found in the database.',
      'Run `manguito migrate` to seed system roles, then try again.',
    )
    process.exit(1)
  }

  // All roles except the highest-hierarchy one (valid demotion targets)
  const demoteRolesResult = await db.getDb().execute(
    sql`SELECT id, name FROM roles WHERE id != ${topRoleRow.id} ORDER BY hierarchy_level ASC`,
  )
  const demoteRoles = demoteRolesResult.rows as Array<{ id: string; name: string }>

  // Resolve target role — flag or interactive select
  let targetRole: { id: string; name: string }
  if (options.role !== undefined) {
    const found = demoteRoles.find((r) => r.name === options.role)
    if (found === undefined) {
      printGuidedError(
        `Role "${options.role}" is not a valid demotion target.`,
        `Valid roles: ${demoteRoles.map((r) => r.name).join(', ')}`,
      )
      process.exit(1)
    }
    targetRole = found
  } else {
    const chosen = await prompt.select(
      'Demote to role:',
      demoteRoles.map((r) => r.name),
    )
    const found = demoteRoles.find((r) => r.name === chosen)!
    targetRole = found
  }

  // Guard: target role same as current role
  if (targetRole.id === user.role_id) {
    const currentRoleResult = await db.getDb().execute(
      sql`SELECT name FROM roles WHERE id = ${user.role_id} LIMIT 1`,
    )
    const currentRoleName =
      (currentRoleResult.rows[0] as { name: string } | undefined)?.name ?? targetRole.name
    printWarning(
      `${email} is already assigned the "${currentRoleName}" role. No changes made.`,
    )
    return
  }

  // Last-admin guard: if user holds highest role and is the only one
  if (user.role_id === topRoleRow.id) {
    const adminCountResult = await db.getDb().execute(
      sql`SELECT COUNT(*)::int AS count FROM users WHERE role_id = ${topRoleRow.id}`,
    )
    const adminRow = adminCountResult.rows[0] as { count: string | number } | undefined
    const adminCount = adminRow !== undefined ? Number(adminRow.count) : 0
    if (adminCount === 1) {
      printGuidedError(
        `Cannot demote ${email} — they are the only admin in the system.`,
        'Promote another user to admin first, then try again.',
      )
      process.exit(1)
    }
  }

  // Demote
  await db.getDb().execute(
    sql`UPDATE users SET role_id = ${targetRole.id} WHERE id = ${user.id}`,
  )
  printSuccess(`${email} demoted to ${targetRole.name}.`)
}

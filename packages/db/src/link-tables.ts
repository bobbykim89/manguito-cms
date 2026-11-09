import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from './types'

// Postgres keeps the first 63 bytes of an identifier. Generated names are
// ASCII, so bytes are characters.
const MAX_IDENTIFIER = 63
const SUFFIX = '_unique'

export function linkUniqueName(tableName: string): string {
  const plain = `${tableName}${SUFFIX}`
  if (plain.length <= MAX_IDENTIFIER) return plain
  const hash = createHash('sha256').update(tableName).digest('hex').slice(0, 8)
  // 47 + "_" + 8 + "_unique" (7) = 63
  return `${tableName.slice(0, 47)}_${hash}${SUFFIX}`
}

export function linkDedupeSql(
  table: string,
  left: string,
  right: string,
  hasOrder: boolean,
): string {
  const order = hasOrder
    ? '(a."order", a.ctid) > (b."order", b.ctid)'
    : 'a.ctid > b.ctid'
  return `DELETE FROM "${table}" a USING "${table}" b WHERE a."${left}" = b."${left}" AND a."${right}" = b."${right}" AND ${order}`
}

const ADD_LINK_UNIQUE =
  /ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" UNIQUE\("left_id","right_id"\);/g

// Rewrites each `ALTER TABLE … ADD CONSTRAINT … UNIQUE("left_id","right_id");`
// that drizzle-kit generated into a DO block: it removes repeated pairs, then
// adds the constraint, and does nothing when the constraint already exists.
// Link tables always carry an order column, so the dedupe keeps the lowest one.
export function addLinkDedupe(sql: string): string {
  return sql.replace(ADD_LINK_UNIQUE, (statement, table: string, name: string) =>
    [
      '-- Removes only repeated (left, right) pairs, keeping the lowest order, before adding the constraint.',
      'DO $$ BEGIN',
      `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"${table}"'::regclass AND conname = '${name}') THEN`,
      `LOCK TABLE "${table}" IN SHARE ROW EXCLUSIVE MODE;`,
      `${linkDedupeSql(table, 'left_id', 'right_id', true)};`,
      statement,
      'END IF;',
      'END $$;',
    ].join('\n'),
  )
}

// Adds each link table's unique (left, right) constraint, under the name
// codegen gives it, and returns one entry per table it changed. `drizzle-kit
// push` stops at a "truncate the table?" prompt when it must add a unique
// constraint to a table with rows, so dev runs this first: with the constraint
// already in place, push has nothing to plan.
export async function ensureLinkConstraints(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
): Promise<Array<{ table: string; removed: number }>> {
  const owners = [
    ...Object.values(registry.content_types),
    ...Object.values(registry.taxonomy_types),
  ]
  const added: Array<{ table: string; removed: number }> = []

  for (const owner of owners) {
    for (const jt of owner.db.junction_tables) {
      const table = jt.table_name
      const name = linkUniqueName(table)

      const exists = await db.execute(
        sql`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS found`,
      )
      if (!(exists.rows[0] as { found: boolean }).found) continue

      const constrained = await db.execute(
        sql`SELECT 1 FROM pg_constraint WHERE conrelid = ${`"${table}"`}::regclass AND conname = ${name}`,
      )
      if (constrained.rows.length > 0) continue

      // A project from before #75 has no order column; keep any row then.
      const orderColumn = await db.execute(
        sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'order'`,
      )
      const deleted = await db.execute(
        sql.raw(
          `${linkDedupeSql(table, jt.left_column, jt.right_column, orderColumn.rows.length > 0)} RETURNING 1`,
        ),
      )
      await db.execute(
        sql.raw(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" UNIQUE("${jt.left_column}", "${jt.right_column}")`,
        ),
      )
      added.push({ table, removed: deleted.rows.length })
    }
  }
  return added
}

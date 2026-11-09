import { createHash } from 'node:crypto'

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
      `${linkDedupeSql(table, 'left_id', 'right_id', true)};`,
      statement,
      'END IF;',
      'END $$;',
    ].join('\n'),
  )
}

import type {
  ParseError,
  ParsedContentType,
  ParsedField,
  ParsedParagraphType,
  ParsedTaxonomyType,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import { createHash } from 'node:crypto'
import { linkUniqueName } from './link-tables'

// Postgres keeps the first 63 bytes of an identifier and drops the rest
// without an error. Generated names are ASCII, so bytes are characters.
const LIMIT = 63
const stored = (name: string): string => name.slice(0, LIMIT)

// The tables codegen's SYSTEM_TABLES_SECTION emits, and the unique constraints
// drizzle names for their `.unique()` columns (`<table>_<column>_unique`).
const SYSTEM_TABLES = ['media', 'base_paths', 'roles', 'users']
const SYSTEM_UNIQUES = [
  { name: 'base_paths_name_unique', table: 'base_paths' },
  { name: 'base_paths_path_unique', table: 'base_paths' },
  { name: 'roles_name_unique', table: 'roles' },
  { name: 'roles_hierarchy_level_unique', table: 'roles' },
  { name: 'users_email_unique', table: 'users' },
]

// drizzle's default foreign-key name (`foreign-keys.js`): the table, its
// columns, the target table and the target columns, joined by `_`, then `_fk`.
export function foreignKeyName(table: string, column: string, targetTable: string, targetColumn: string): string {
  return `${table}_${column}_${targetTable}_${targetColumn}_fk`
}

// The name codegen gives a foreign key. Postgres keeps 63 characters of a
// longer name and drizzle-kit compares the full one with the stored one, so
// push would re-plan the key on every run. A longer default name becomes its
// first 51 characters, `_`, 8 hex characters of the whole name's hash and
// `_fk`: 63 characters, distinct per key, and stored as given.
export function codegenForeignKeyName(table: string, column: string, targetTable: string, targetColumn: string): string {
  const name = foreignKeyName(table, column, targetTable, targetColumn)
  if (name.length <= LIMIT) return name
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8)
  return `${name.slice(0, LIMIT - '_'.length - hash.length - '_fk'.length)}_${hash}_fk`
}

// The name `generateTableDef` gives an enum column's check constraint.
export function checkConstraintName(column: string): string {
  return `${column}_check`
}

// The name Postgres gives a primary key declared without one: `<table>_pkey`,
// with the table part cut so the whole fits in 63 characters.
function primaryKeyName(table: string): string {
  const name = `${table}_pkey`
  return name.length <= LIMIT ? name : `${table.slice(0, LIMIT - '_pkey'.length)}_pkey`
}

type Owner = ParsedContentType | ParsedTaxonomyType | ParsedParagraphType

// Copied from `rawFieldPath` in packages/core/src/parser/validate.ts; keep the two in step.
// Where a field sits in its raw schema file: inside a tab for a content type.
function rawFieldPath(owner: Owner, field: ParsedField): string {
  if (owner.schema_type !== 'content-type') return `fields[${field.order}].name`
  const t = owner.ui.tabs.findIndex((tab) => tab.fields.includes(field.name))
  const i = t < 0 ? -1 : owner.ui.tabs[t]!.fields.indexOf(field.name)
  return t < 0 ? `fields[${field.order}].name` : `fields[${t}].tab.fields[${i}].name`
}

// The column a field's constraints are named after, when a `column`
// declaration keeps it apart from the field name.
function declaredColumn(field: ParsedField): string | undefined {
  const column = field.db_column?.column_name
  return column !== undefined && column !== field.name ? column : undefined
}

// `field "a"`, with the column when a `column` declaration keeps it apart.
function describeField(field: ParsedField): string {
  const column = declaredColumn(field)
  return column !== undefined ? `field "${field.name}" (column "${column}")` : `field "${field.name}"`
}

// What to change so the field's constraint names change: the field name, or
// the declared column, since renaming the field leaves a declared column as is.
function renameOf(field: ParsedField): string {
  const column = declaredColumn(field)
  return column !== undefined ? `change the column "${column}" of field "${field.name}"` : `rename field "${field.name}"`
}

function shortenOf(field: ParsedField, room: number): string {
  const column = declaredColumn(field)
  return column !== undefined
    ? `shorten the column "${column}" of field "${field.name}" to at most ${room} characters`
    : `shorten field "${field.name}" to at most ${room} characters`
}

type TableConstraint = { name: string; kind: 'foreign key' | 'check'; field: ParsedField }

// The constraints `generateTableDef` emits for a type's own table: a foreign
// key per reference or media column (named by `codegenForeignKeyName`, so a
// long one is hashed), a `<column>_check` per enum column.
function typeTableConstraints(owner: Owner): TableConstraint[] {
  const table = owner.db.table_name
  const names: TableConstraint[] = []
  for (const field of owner.fields) {
    const col = field.db_column
    if (field.field_type === 'paragraph' || col === null || col.junction) continue
    if (col.foreign_key) {
      const fk = col.foreign_key
      names.push({ name: codegenForeignKeyName(table, col.column_name, fk.table, fk.column), kind: 'foreign key', field })
    }
    if ((col.check_constraint?.length ?? 0) > 0) {
      names.push({ name: checkConstraintName(col.column_name), kind: 'check', field })
    }
  }
  return names
}

function typeTableMessage(owner: Owner, a: TableConstraint, b: TableConstraint): string {
  const clash =
    `Postgres keeps only the first ${LIMIT} characters of a name, which are the same, so the ` +
    `migration would fail with "constraint already exists".`
  if (a.kind === 'foreign key' && b.kind === 'foreign key') {
    // Only reachable by a hash coincidence: a hashed name agreeing with another
    // foreign key's name in all 63 characters. No fixture can produce it on purpose.
    return (
      `The ${describeField(a.field)} and the ${describeField(b.field)} of "${owner.name}" get foreign keys ` +
      `"${a.name}" and "${b.name}". ${clash} To fix it, ${renameOf(a.field)} or ${renameOf(b.field)}.`
    )
  }
  if (a.kind === 'check' && b.kind === 'check') {
    const room = LIMIT - '_check'.length
    return (
      `The ${describeField(a.field)} and the ${describeField(b.field)} of "${owner.name}" get check constraints ` +
      `"${a.name}" and "${b.name}". ${clash} To fix it, ${renameOf(a.field)} or ` +
      `${renameOf(b.field)} so that the two differ within their first ${room} characters.`
    )
  }
  // A foreign key and a check. A foreign key name is at most 63 characters and
  // ends in `_fk`; a check name of at most 62 characters ends in `_check`, so
  // only a check cut to 63 characters can match one.
  const check = a.kind === 'check' ? a : b
  const room = LIMIT - 1 - '_check'.length
  return (
    `The ${a.kind} "${a.name}" of the ${describeField(a.field)} and the ${b.kind} "${b.name}" of the ` +
    `${describeField(b.field)}, both on "${owner.name}", are the same in their first ${LIMIT} characters. ${clash} ` +
    `To fix it, ${shortenOf(check.field, room)}.`
  )
}

function checkTypeTable(owner: Owner): ParseError[] {
  const errors: ParseError[] = []
  const first = new Map<string, TableConstraint>()
  for (const constraint of typeTableConstraints(owner)) {
    const earlier = first.get(stored(constraint.name))
    if (!earlier) {
      first.set(stored(constraint.name), constraint)
      continue
    }
    errors.push({
      file: owner.source_file,
      code: 'CONSTRAINT_NAME_COLLISION',
      message: typeTableMessage(owner, earlier, constraint),
      path: rawFieldPath(owner, constraint.field),
    })
  }
  return errors
}

type Link = { owner: ParsedContentType | ParsedTaxonomyType; field: ParsedField; table: string; unique: string }

// The constraints `generateJunctionTables` emits for one link table: a
// foreign key to each side (named by `codegenForeignKeyName`) and the
// `linkUniqueName` unique. Reported once.
function checkLinkTable(link: Link, left: string, right: string, rightTable: string): ParseError | null {
  const { owner, field, table } = link
  const leftFk = codegenForeignKeyName(table, left, owner.db.table_name, 'id')
  const rightFk = codegenForeignKeyName(table, right, rightTable, 'id')
  const names = [leftFk, rightFk, link.unique]
  const collides = names.some((n, i) => names.some((m, j) => i < j && stored(n) === stored(m)))
  if (!collides) return null

  const base = { file: owner.source_file, code: 'CONSTRAINT_NAME_COLLISION' as const, path: rawFieldPath(owner, field) }
  const truncated = `Postgres keeps only the first ${LIMIT} characters of a name`
  // Only reachable by a hash coincidence: two of the three names, long ones hashed,
  // agreeing in all 63 characters. No fixture can produce it on purpose.
  return {
    ...base,
    message:
      `The link table of field "${field.name}" of "${owner.name}", "${table}", gets constraints ${names.map((n) => `"${n}"`).join(', ')}, ` +
      `two of which are the same in their first ${LIMIT} characters. ${truncated}, so the migration would fail with ` +
      `"constraint already exists". To fix it, rename field "${field.name}" of type "${owner.name}".`,
  }
}

type Taken = { name: string; what: string }

// Names in Postgres's relation namespace that a link table's unique
// constraint (backed by an index) must not take: every table, every other
// unique constraint, and every primary key. Tables are never compared with
// each other here (core's TABLE_NAME_COLLISION does that), and primary keys
// are not compared with each other: Postgres numbers its own choice instead.
function takenNames(registry: SchemaRegistry, links: Link[]): Taken[] {
  const taken: Taken[] = []
  for (const table of SYSTEM_TABLES) {
    taken.push({ name: table, what: `system table "${table}"` })
    taken.push({ name: primaryKeyName(table), what: `the primary key of system table "${table}"` })
  }
  for (const u of SYSTEM_UNIQUES) taken.push({ name: u.name, what: `a unique constraint of system table "${u.table}"` })
  const types = [
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
    ...Object.values(registry.content_types),
  ]
  for (const t of types) {
    taken.push({ name: t.db.table_name, what: `the table of type "${t.name}"` })
    taken.push({ name: primaryKeyName(t.db.table_name), what: `the primary key of type "${t.name}"` })
  }
  // Link tables have no primary key.
  for (const l of links) taken.push({ name: l.table, what: `the link table of field "${l.field.name}" of "${l.owner.name}"` })
  return taken
}

function checkLinkUniques(registry: SchemaRegistry, links: Link[]): ParseError[] {
  const first = new Map<string, Taken>()
  for (const t of takenNames(registry, links)) {
    if (!first.has(stored(t.name))) first.set(stored(t.name), t)
  }
  const errors: ParseError[] = []
  for (const link of links) {
    const key = stored(link.unique)
    const earlier = first.get(key)
    if (!earlier) {
      first.set(key, { name: link.unique, what: `the unique constraint of the link table of field "${link.field.name}" of "${link.owner.name}"` })
      continue
    }
    const same =
      earlier.name === link.unique
        ? `which is also the name of ${earlier.what}`
        : `which is the same as ${earlier.what}, "${earlier.name}", in its first ${LIMIT} characters. Postgres keeps only the first ${LIMIT} characters of a name`
    errors.push({
      file: link.owner.source_file,
      code: 'CONSTRAINT_NAME_COLLISION',
      message:
        `The link table of field "${link.field.name}" of "${link.owner.name}" gets unique constraint "${link.unique}", ` +
        `${same}. A unique constraint shares its name with its index, and indexes share one namespace with tables, so the ` +
        `migration would fail with "relation already exists". Rename field "${link.field.name}" of type "${link.owner.name}".`,
      path: rawFieldPath(link.owner, link.field),
    })
  }
  return errors
}

/**
 * Finds constraint names that db codegen would emit and Postgres would treat
 * as one, because they agree in the first 63 characters it keeps. Such a
 * schema fails in its migration with "constraint already exists" or "relation
 * already exists"; this reports it before, naming the rename that clears it.
 *
 * Within each table: foreign keys, `<column>_check` constraints, and a link
 * table's two foreign keys and unique constraint. Across the schema: each link
 * table's unique constraint against every table, unique and primary-key name.
 */
export function findConstraintNameCollisions(registry: SchemaRegistry): ParseError[] {
  const errors: ParseError[] = []
  const typeTables: Owner[] = [
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
    ...Object.values(registry.content_types),
  ]
  for (const owner of typeTables) errors.push(...checkTypeTable(owner))

  // Content and taxonomy types own link tables; paragraph types get none.
  const links: Link[] = []
  for (const owner of [...Object.values(registry.content_types), ...Object.values(registry.taxonomy_types)]) {
    for (const jt of owner.db.junction_tables) {
      const field = owner.fields.find((f) => f.db_column?.junction?.table_name === jt.table_name)
      if (!field) continue
      const link = { owner, field, table: jt.table_name, unique: linkUniqueName(jt.table_name) }
      links.push(link)
      const error = checkLinkTable(link, jt.left_column, jt.right_column, jt.right_table)
      if (error) errors.push(error)
    }
  }
  errors.push(...checkLinkUniques(registry, links))
  return errors
}

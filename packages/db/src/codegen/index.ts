import type {
  DbColumnType,
  ParsedField,
  ParsedParagraphType,
  SchemaRegistry,
  SystemField,
} from '@bobbykim/manguito-cms-core'

// ─── File Header ──────────────────────────────────────────────────────────────

function generateFileHeader(): string {
  return (
    "import * as s from 'drizzle-orm/pg-core'\n" +
    "import { sql } from 'drizzle-orm'"
  )
}

// ─── System Tables ────────────────────────────────────────────────────────────

const SYSTEM_TABLES_SECTION = `// ─── System Tables ──────────────────────────────────────────────────────────
export const media = s.pgTable('media', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  url: s.varchar('url', { length: 2048 }).notNull(),
  mime_type: s.varchar('mime_type', { length: 255 }).notNull(),
  alt: s.varchar('alt', { length: 255 }),
  file_size: s.integer('file_size').notNull(),
  width: s.integer('width'),
  height: s.integer('height'),
  duration: s.integer('duration'),
  reference_count: s.integer('reference_count').notNull().default(0),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const base_paths = s.pgTable('base_paths', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  path: s.varchar('path', { length: 1024 }).notNull().unique(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const roles = s.pgTable('roles', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  label: s.varchar('label', { length: 255 }).notNull(),
  is_system: s.boolean('is_system').notNull().default(false),
  hierarchy_level: s.integer('hierarchy_level').notNull().unique(),
  permissions: s.text('permissions').array().notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const users = s.pgTable('users', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  email: s.varchar('email', { length: 255 }).notNull().unique(),
  password_hash: s.varchar('password_hash', { length: 255 }).notNull(),
  role_id: s.uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  token_version: s.integer('token_version').notNull().default(0),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})`

// ─── Column Generators ────────────────────────────────────────────────────────

export function generateSystemFieldColumn(field: SystemField): string {
  const { name, db_type, primary_key, default: defaultVal, nullable } = field
  const col = buildSystemBase(name, db_type, primary_key, defaultVal)
  return primary_key || nullable ? col : col + '.notNull()'
}

function buildSystemBase(
  name: string,
  db_type: SystemField['db_type'],
  primary_key: boolean | undefined,
  defaultVal: string | undefined,
): string {
  switch (db_type) {
    case 'uuid':
      return primary_key
        ? `s.uuid('${name}').primaryKey().defaultRandom()`
        : `s.uuid('${name}')`
    case 'varchar':
      return `s.varchar('${name}')`
    case 'boolean': {
      const suffix =
        defaultVal === 'false'
          ? '.default(false)'
          : defaultVal === 'true'
            ? '.default(true)'
            : ''
      return `s.boolean('${name}')${suffix}`
    }
    case 'timestamp':
      return defaultVal === 'now()'
        ? `s.timestamp('${name}').defaultNow()`
        : `s.timestamp('${name}')`
    case 'integer':
      return defaultVal !== undefined
        ? `s.integer('${name}').default(${Number(defaultVal)})`
        : `s.integer('${name}')`
  }
}

function mapOnDelete(
  on_delete: 'CASCADE' | 'SET NULL' | 'RESTRICT',
): string {
  if (on_delete === 'CASCADE') return 'cascade'
  if (on_delete === 'SET NULL') return 'set null'
  return 'restrict'
}

export function generateFieldColumn(field: ParsedField): string | null {
  if (field.field_type === 'paragraph' || field.db_column === null) return null

  const col = field.db_column
  if (col.junction) return null

  const n = col.column_name
  const isEnum =
    col.check_constraint !== undefined && col.check_constraint.length > 0

  let expr = buildFieldBase(n, col.column_type, isEnum, field.validation.limit)

  if (!col.nullable) expr += '.notNull()'

  if (col.foreign_key) {
    const onDelete = mapOnDelete(col.foreign_key.on_delete)
    expr += `.references(() => ${col.foreign_key.table}.${col.foreign_key.column}, { onDelete: '${onDelete}' })`
  }

  return expr
}

function buildFieldBase(
  name: string,
  column_type: DbColumnType,
  isEnum: boolean,
  limit: number | undefined,
): string {
  switch (column_type) {
    case 'varchar':
      return isEnum
        ? `s.varchar('${name}')`
        : `s.varchar('${name}', { length: ${limit ?? 255} })`
    case 'text':
      return `s.text('${name}')`
    case 'integer':
      return `s.integer('${name}')`
    case 'decimal':
      return `s.decimal('${name}', { precision: 10, scale: 4 })`
    case 'boolean':
      return `s.boolean('${name}')`
    case 'timestamp':
      return `s.timestamp('${name}')`
    case 'uuid':
      return `s.uuid('${name}')`
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tableNameToVarName(tableName: string): string {
  return tableName.replace(/-/g, '_')
}

function generateTableDef(
  tableName: string,
  varName: string,
  systemFields: SystemField[],
  fields: ParsedField[],
): string {
  const colLines: string[] = []

  for (const f of systemFields) {
    colLines.push(`${f.name}: ${generateSystemFieldColumn(f)},`)
  }

  for (const f of fields) {
    const colExpr = generateFieldColumn(f)
    if (colExpr === null) continue
    colLines.push(`${f.db_column!.column_name}: ${colExpr},`)
  }

  const enumFields = fields.filter(
    (f) => (f.db_column?.check_constraint?.length ?? 0) > 0,
  )

  if (enumFields.length === 0) {
    const colBlock = colLines.map((l) => `  ${l}`).join('\n')
    return `export const ${varName} = s.pgTable('${tableName}', {\n${colBlock}\n})`
  }

  const colBlock = colLines.map((l) => `    ${l}`).join('\n')
  const constraints = enumFields
    .map((f) => {
      const col = f.db_column!
      const values = col.check_constraint!.map((v) => `'${v}'`).join(', ')
      const cname = `${col.column_name}_check`
      return [
        `    ${cname}: s.check(`,
        `      '${cname}',`,
        `      sql\`\${table.${col.column_name}} IN (${values})\``,
        `    ),`,
      ].join('\n')
    })
    .join('\n')

  return [
    `export const ${varName} = s.pgTable(`,
    `  '${tableName}',`,
    `  {`,
    colBlock,
    `  },`,
    `  (table) => ({`,
    constraints,
    `  })`,
    `)`,
  ].join('\n')
}

// ─── Paragraph Topological Sort ───────────────────────────────────────────────

export function orderParagraphTypes(
  paragraphs: Record<string, ParsedParagraphType>,
): ParsedParagraphType[] {
  const sorted: ParsedParagraphType[] = []
  const visited = new Set<string>()

  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    const paragraph = paragraphs[name]
    if (!paragraph) return
    for (const field of paragraph.fields) {
      if (field.field_type === 'paragraph') {
        const ref = (field.ui_component as { ref: string }).ref
        visit(ref)
      }
    }
    sorted.push(paragraph)
  }

  for (const name of Object.keys(paragraphs)) visit(name)
  return sorted
}

// ─── Junction Table Generation ────────────────────────────────────────────────

function generateJunctionTables(registry: SchemaRegistry): string {
  const tables: string[] = []

  for (const ct of Object.values(registry.content_types)) {
    const leftVar = tableNameToVarName(ct.db.table_name)

    for (const jt of ct.db.junction_tables) {
      const varName = tableNameToVarName(jt.table_name)
      const rightVar = tableNameToVarName(jt.right_table)

      const orderLine = jt.order_column
        ? `    order: s.integer('order').notNull().default(0),`
        : null

      const def = [
        `export const ${varName} = s.pgTable(`,
        `  '${jt.table_name}',`,
        `  {`,
        `    ${jt.left_column}: s.uuid('${jt.left_column}')`,
        `      .notNull()`,
        `      .references(() => ${leftVar}.id, { onDelete: 'cascade' }),`,
        `    ${jt.right_column}: s.uuid('${jt.right_column}')`,
        `      .notNull()`,
        `      .references(() => ${rightVar}.id, { onDelete: 'cascade' }),`,
        ...(orderLine ? [orderLine] : []),
        `  }`,
        `)`,
      ].join('\n')

      tables.push(def)
    }
  }

  if (tables.length === 0) return ''

  return (
    '// ─── Junction Tables ─────────────────────────────────────────────────────────\n' +
    tables.join('\n\n')
  )
}

// ─── generateSchemaFile ───────────────────────────────────────────────────────

export function generateSchemaFile(registry: SchemaRegistry): string {
  const sections: string[] = [generateFileHeader(), SYSTEM_TABLES_SECTION]

  const taxonomyTypes = Object.values(registry.taxonomy_types)
  if (taxonomyTypes.length > 0) {
    const header =
      '// ─── Taxonomy Types ──────────────────────────────────────────────────────────'
    const defs = taxonomyTypes.map((t) =>
      generateTableDef(
        t.db.table_name,
        tableNameToVarName(t.db.table_name),
        t.system_fields,
        t.fields,
      ),
    )
    sections.push(header + '\n' + defs.join('\n\n'))
  }

  const paragraphTypes = orderParagraphTypes(registry.paragraph_types)
  if (paragraphTypes.length > 0) {
    const header =
      '// ─── Paragraph Types ─────────────────────────────────────────────────────────'
    const defs = paragraphTypes.map((p) =>
      generateTableDef(
        p.db.table_name,
        tableNameToVarName(p.db.table_name),
        p.system_fields,
        p.fields,
      ),
    )
    sections.push(header + '\n' + defs.join('\n\n'))
  }

  const contentTypes = Object.values(registry.content_types)
  if (contentTypes.length > 0) {
    const header =
      '// ─── Content Types ───────────────────────────────────────────────────────────'
    const defs = contentTypes.map((c) =>
      generateTableDef(
        c.db.table_name,
        tableNameToVarName(c.db.table_name),
        c.system_fields,
        c.fields,
      ),
    )
    sections.push(header + '\n' + defs.join('\n\n'))
  }

  const junctionSection = generateJunctionTables(registry)
  if (junctionSection) sections.push(junctionSection)

  return sections.join('\n\n')
}

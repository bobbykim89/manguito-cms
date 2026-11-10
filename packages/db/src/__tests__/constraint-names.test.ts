import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { getTableConfig, pgTable, uuid } from 'drizzle-orm/pg-core'
import {
  buildSchemaRegistry,
  loadSchemaFile,
  parseRoles,
  parseRoutes,
  parseSchema,
  walkSchemaDirectory,
} from '@bobbykim/manguito-cms-core'
import type { ParseError, ParsedSchema, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { codegenForeignKeyName, findConstraintNameCollisions, foreignKeyName } from '../constraint-names'

type RawField = Record<string, unknown>

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function taxonomy(name: string, fields: RawField[]): ParsedSchema {
  return parseOrThrow({ name, label: name, type: 'taxonomy-type', fields }, 'taxonomy-type', `schemas/taxonomy-types/${name}.json`)
}

function content(name: string, fields: RawField[]): ParsedSchema {
  return parseOrThrow(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'posts',
      only_one: false,
      fields: [{ tab: { name: 'main', label: 'Main', fields } }],
    },
    'content-type',
    `schemas/content-types/${name}.json`,
  )
}

const m2m = (name: string, target = 'taxonomy--tag'): RawField => ({ name, label: name, type: 'reference', target, rel: 'many-to-many', required: false })
const ref = (name: string, target = 'taxonomy--tag'): RawField => ({ name, label: name, type: 'reference', target, rel: 'one-to-one', required: false })
const enumField = (name: string): RawField => ({ name, label: name, type: 'enum', values: ['a', 'b'], required: false })

const TITLE: RawField = { name: 'name', label: 'Name', type: 'text/plain', required: false }
const TAG = taxonomy('taxonomy--tag', [TITLE])

function registryOf(...schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, { base_paths: [] }, { roles: [], valid_permissions: [] })
}

const collisions = (registry: SchemaRegistry): ParseError[] =>
  findConstraintNameCollisions(registry).filter((e) => e.code === 'CONSTRAINT_NAME_COLLISION')

// The length the message's fix names: "at most N characters" or "within their first N characters".
const suggested = (error: ParseError): number => {
  const match = /(?:at most|within their first) (\d+) characters/.exec(error.message)
  if (!match) throw new Error(`no suggested length in: ${error.message}`)
  return Number(match[1])
}

describe('foreignKeyName', () => {
  it('names a foreign key the way drizzle does', () => {
    // MUTATION: drop the target column from the name (`<table>_<column>_<target>_fk`).
    // drizzle joins all four parts, so the comparison fails.
    const target = pgTable('taxonomy_a_long_target_table_name_for_the_pin', { id: uuid('id').primaryKey() })
    const owner = pgTable('content_a_long_owner_table_name_for_the_pin', {
      id: uuid('id').primaryKey(),
      a_very_long_reference_column_name: uuid('a_very_long_reference_column_name').references(() => target.id),
    })
    const drizzleName = getTableConfig(owner).foreignKeys[0]!.getName()
    expect(drizzleName.length).toBeGreaterThan(63)
    expect(
      foreignKeyName(
        'content_a_long_owner_table_name_for_the_pin',
        'a_very_long_reference_column_name',
        'taxonomy_a_long_target_table_name_for_the_pin',
        'id',
      ),
    ).toBe(drizzleName)
  })
})

describe('codegenForeignKeyName', () => {
  // A default name of exactly `length` characters: the column pads it out.
  const ofLength = (length: number, column = 'c'): [string, string, string, string] => {
    const table = 'content_owner_table'
    const target = 'taxonomy_target_table'
    const fixed = foreignKeyName(table, column, target, 'id').length
    return [table, column.padEnd(column.length + length - fixed, 'x'), target, 'id']
  }

  it('keeps drizzle\'s name when it is exactly 63 characters', () => {
    // MUTATION: hash at `>= 63`. A 63-character name is kept by Postgres whole,
    // so it must stay as drizzle names it.
    const args = ofLength(63)
    expect(foreignKeyName(...args)).toHaveLength(63)
    expect(codegenForeignKeyName(...args)).toBe(foreignKeyName(...args))
  })

  it('hashes a 64-character name to 63 characters', () => {
    // MUTATION: keep a 52-character prefix. The name then no longer matches
    // `^.{51}_[0-9a-f]{8}_fk$` and is 64 characters long.
    const args = ofLength(64)
    const def = foreignKeyName(...args)
    expect(def).toHaveLength(64)
    const name = codegenForeignKeyName(...args)
    expect(name).toHaveLength(63)
    expect(name.startsWith(def.slice(0, 51) + '_')).toBe(true)
    expect(name.endsWith('_fk')).toBe(true)
    expect(name).toMatch(/^.{51}_[0-9a-f]{8}_fk$/)
  })

  it('gives different names to two foreign keys that share their first 51 characters', () => {
    // MUTATION: hash only the table name. Both keys then get the same hash
    // and the same 51-character prefix, so their names are equal.
    const table = 'junction_content_a_long_link_table_name_for_the_pin'
    const left = codegenForeignKeyName(table, 'left_id', 'content_owner', 'id')
    const right = codegenForeignKeyName(table, 'right_id', 'content_owner', 'id')
    expect(foreignKeyName(table, 'left_id', 'content_owner', 'id').slice(0, 51)).toBe(
      foreignKeyName(table, 'right_id', 'content_owner', 'id').slice(0, 51),
    )
    expect(left).not.toBe(right)
  })
})

describe('findConstraintNameCollisions — a link table’s two foreign keys (K1)', () => {
  // `junction_taxonomy_tag_` is 22 characters, so a 40-character field gives a
  // 62-character link table. Its foreign keys `<link table>_left_id_…` and
  // `<link table>_right_id_…` agree in their first 63 characters, but codegen
  // hashes each name past 63 characters, so they are stored apart.
  const prefix = 'junction_taxonomy_tag_'.length
  const withList = (field: string) =>
    registryOf(taxonomy('taxonomy--tag', [TITLE, m2m(field)]))

  it('passes a 62-character link table, whose foreign keys codegen hashes apart', () => {
    // MUTATION: `checkLinkTable` still compares `stored(foreignKeyName(...))`.
    // The two default names agree in their first 63 characters, so the schema is refused.
    const field = 'f'.repeat(62 - prefix)
    expect(`junction_taxonomy_tag_${field}`).toHaveLength(62)
    expect(collisions(withList(field))).toEqual([])
  })

  it('passes a type whose link-table prefix alone is 62 characters', () => {
    // MUTATION: `checkLinkTable` still compares `stored(foreignKeyName(...))`.
    // The prefix `junction_taxonomy_<43 b's>_` leaves the two default names
    // agreeing in their first 63 characters.
    const longType = (n: number) => `taxonomy--${'b'.repeat(n)}`
    expect(collisions(registryOf(TAG, taxonomy(longType(43), [m2m('x')])))).toEqual([])
  })
})

describe('findConstraintNameCollisions — two foreign keys of one table (K2)', () => {
  // content_post is 12 characters, so foreign keys `content_post_<column>_…`
  // keep 62 − 12 = 50 characters of the column.
  const one = `${'a'.repeat(50)}_one`
  const two = `${'a'.repeat(50)}_two`

  it('passes two reference columns whose default foreign-key names share their first 63 characters', () => {
    // MUTATION: `typeTableConstraints` still uses `foreignKeyName`. The two
    // default names agree in their first 63 characters, so the schema is refused.
    expect(collisions(registryOf(TAG, content('content--post', [ref(one), ref(two)])))).toEqual([])
  })

  it('passes two reference columns on a table whose name leaves no room for a column', () => {
    // MUTATION: `typeTableConstraints` still uses `foreignKeyName`.
    // content_<54 p's> is 62 characters, so both default names keep only the table.
    const type = `content--${'p'.repeat(54)}`
    expect(collisions(registryOf(TAG, content(type, [ref('r_one'), ref('r_two')])))).toEqual([])
  })
})

describe('findConstraintNameCollisions — two check constraints of one table (K3)', () => {
  // `<column>_check` keeps 57 characters of the column. Columns already differ
  // within 63 (DUPLICATE_COLUMN), so two checks collide when one column is the
  // other's `<column>_check`.
  const one = 'e'.repeat(57)
  const two = `${'e'.repeat(57)}_check`

  it('refuses two enum columns whose check names share the characters Postgres keeps', () => {
    // MUTATION: compare full names. `<57 e's>_check` and `<57 e's>_check_check`
    // differ after character 63, so nothing would be reported.
    const errors = collisions(registryOf(content('content--post', [enumField(one), enumField(two)])))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`"${one}_check"`)
    expect(errors[0]!.message).toContain(`rename field "${one}" or rename field "${two}" so that the two differ within their first 57 characters.`)
  })

  it('is cleared by the rename the message suggests', () => {
    // MUTATION: suggest 63 − 1 = 62, the room a column has before Postgres
    // truncates it, instead of 63 − "_check".length = 57.
    const [error] = collisions(registryOf(content('content--post', [enumField(one), enumField(two)])))
    const n = suggested(error!)
    expect(n).toBe(57)
    const renamed = `${'e'.repeat(n - 1)}f_check`
    expect(collisions(registryOf(content('content--post', [enumField(one), enumField(renamed)])))).toEqual([])
  })
})

describe('findConstraintNameCollisions — a link unique name against a schema-wide name (K5)', () => {
  // The link table of `tags` is junction_taxonomy_tag_tags; its unique
  // constraint junction_taxonomy_tag_tags_unique is the link table of `tags_unique`.
  it('refuses a link unique constraint named like another table', () => {
    // MUTATION: compare link unique names only within their own table. The
    // clash with the other link table would then go unreported.
    const errors = collisions(registryOf(taxonomy('taxonomy--tag', [m2m('tags'), m2m('tags_unique')])))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ file: 'schemas/taxonomy-types/taxonomy--tag.json', path: 'fields[0].name' })
    expect(errors[0]!.message).toContain('"junction_taxonomy_tag_tags_unique"')
    expect(errors[0]!.message).toContain('Rename field "tags" of type "taxonomy--tag".')
  })

  it('is cleared by renaming the field', () => {
    // MUTATION: compare link unique names with the `_unique` suffix dropped.
    // Each link table then clashes with its own unique name, and the renamed
    // schema is still refused.
    expect(collisions(registryOf(taxonomy('taxonomy--tag', [m2m('labels'), m2m('tags_unique')])))).toEqual([])
  })

  it('refuses a link unique constraint named like a system table’s unique constraint', () => {
    // MUTATION: leave the system unique names out of the schema-wide names.
    // Nothing else here is called users_email_unique.
    // Parsed link tables always start with `junction_`, so the fixture renames
    // the link table in the registry to reach a system name.
    const registry = registryOf(taxonomy('taxonomy--tag', [m2m('tags')]))
    const owner = registry.taxonomy_types['taxonomy--tag']!
    owner.db.junction_tables[0]!.table_name = 'users_email'
    owner.fields[0]!.db_column!.junction!.table_name = 'users_email'
    const errors = collisions(registry)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('"users_email_unique"')
  })
})

describe('findConstraintNameCollisions — names in more than one kind of constraint', () => {
  // A foreign key name of exactly 63 characters is kept whole. On content_post,
  // a 31-character reference column gives one. An enum column named that name
  // plus `_x` has a `<column>_check` that Postgres cuts to the same 63 characters;
  // the columns differ at character 64, so core's DUPLICATE_COLUMN lets both through.
  const fk = 'x'.repeat(31)
  const check = `${foreignKeyName('content_post', fk, 'taxonomy_tag', 'id')}_x`

  it('reports a foreign key and a check constraint that share their first 63 characters', () => {
    // MUTATION: compare names only within one kind. The foreign key and the
    // check both begin with the same 63 characters.
    expect(foreignKeyName('content_post', fk, 'taxonomy_tag', 'id')).toHaveLength(63)
    const errors = collisions(registryOf(TAG, content('content--post', [ref(fk), enumField(check)])))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`"${foreignKeyName('content_post', fk, 'taxonomy_tag', 'id')}"`)
    expect(errors[0]!.message).toContain(`"${check}_check"`)
    expect(errors[0]!.message).toContain(`field "${fk}"`)
    expect(errors[0]!.message).toContain(`field "${check}"`)
  })

  it('suggests a length for the enum field, and shortening it to that clears the collision', () => {
    // MUTATION: suggest 57 (63 − "_check".length) instead of 56. Only the
    // "at most 56 characters" assertion catches it; the clearing check below
    // passes for 57 too, since a 57-character name still differs at character 63.
    const errors = collisions(registryOf(TAG, content('content--post', [ref(fk), enumField(check)])))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`shorten field "${check}" to at most 56 characters`)
    const shortened = check.slice(0, suggested(errors[0]!))
    expect(collisions(registryOf(TAG, content('content--post', [ref(fk), enumField(shortened)])))).toEqual([])
  })
})

describe('findConstraintNameCollisions — foreign keys of one table with one name', () => {
  // drizzle joins table, column, target table and target column with `_`, so
  // `ref_taxonomy` -> `taxonomy_tag` and `ref` -> `taxonomy_taxonomy_tag` agree.
  const OTHER = taxonomy('taxonomy--taxonomy_tag', [TITLE])
  const post = (fields: RawField[]) => registryOf(TAG, OTHER, content('content--post', fields))
  const pair = (prefix: string) => [ref(`${prefix}ref_taxonomy`), ref(`${prefix}ref`, 'taxonomy--taxonomy_tag')]

  it('reports a short identical pair, naming both fields', () => {
    // MUTATION: make checkTypeTable skip foreign-key pairs (or compare only a
    // foreign key with a check). The two identical names would then pass.
    const errors = collisions(post(pair('')))
    expect(foreignKeyName('content_post', 'ref_taxonomy', 'taxonomy_tag', 'id')).toBe(
      foreignKeyName('content_post', 'ref', 'taxonomy_taxonomy_tag', 'id'),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('"content_post_ref_taxonomy_taxonomy_tag_id_fk"')
    expect(errors[0]!.message).toContain('field "ref_taxonomy"')
    expect(errors[0]!.message).toContain('field "ref"')
    expect(errors[0]!.message).toContain('hash coincidence')
  })

  it('reports a long identical pair, whose hashed names agree too', () => {
    // MUTATION: skip foreign-key pairs in checkTypeTable; the two long names,
    // hashed from one default name, would then go unreported.
    const prefix = `${'a'.repeat(40)}_`
    const [a, b] = pair(prefix) as [RawField, RawField]
    expect(foreignKeyName('content_post', a.name as string, 'taxonomy_tag', 'id').length).toBeGreaterThan(63)
    const errors = collisions(post([a, b]))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`"${codegenForeignKeyName('content_post', a.name as string, 'taxonomy_tag', 'id')}"`)
    expect(errors[0]!.message).toContain(`field "${a.name}"`)
    expect(errors[0]!.message).toContain(`field "${b.name}"`)
  })

  it('is cleared by renaming one field, as the message suggests', () => {
    // MUTATION: suggest a rename that keeps the joined name, e.g. renaming the
    // field but leaving its column fixed; the collision would survive the rename.
    const errors = collisions(post(pair('')))
    expect(errors[0]!.message).toContain('rename field "ref"')
    expect(collisions(post([ref('ref_taxonomy'), ref('ref_two', 'taxonomy--taxonomy_tag')]))).toEqual([])
  })

  it('suggests changing the declared column, and changing it clears the collision', () => {
    // MUTATION: make renameOf suggest renaming the field when a `column`
    // declaration keeps it apart; renaming then leaves the column, and the
    // collision, in place.
    const declared = { ...ref('other', 'taxonomy--taxonomy_tag'), column: 'ref' }
    const errors = collisions(post([ref('ref_taxonomy'), declared]))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('change the column "ref" of field "other"')
    expect(errors[0]!.message).not.toContain('rename field "other"')
    expect(collisions(post([ref('ref_taxonomy'), { ...declared, column: 'ref_two' }]))).toEqual([])
    // Renaming the field alone does not clear it.
    expect(collisions(post([ref('ref_taxonomy'), { ...declared, name: 'other_two' }]))).toHaveLength(1)
  })
})

describe('findConstraintNameCollisions — schemas that work today', () => {
  it('passes two type tables whose primary-key names agree', () => {
    // MUTATION: compare primary-key names with each other. Both are
    // `<first 58 characters>_pkey` here, which Postgres resolves by numbering.
    const long = 'a'.repeat(50)
    const errors = collisions(registryOf(content(`content--${long}_one`, [TITLE]), content(`content--${long}_two`, [TITLE])))
    expect(`content_${long}_one`.slice(0, 58)).toBe(`content_${long}_two`.slice(0, 58))
    expect(errors).toEqual([])
  })

  it('passes the sandbox schema', () => {
    // MUTATION: compare the first 40 characters instead of 63. The sandbox's
    // link table junction_content_blog_post_blog_related has 71- and
    // 72-character foreign keys that differ at character 41, so it would be refused.
    const base = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'sandbox', 'schemas')
    const walk = walkSchemaDirectory({
      base_path: base,
      folders: { content_types: 'content-types', paragraph_types: 'paragraph-types', taxonomy_types: 'taxonomy-types', enum_types: 'enum-types' },
    })
    if (!walk.ok) throw new Error(JSON.stringify(walk.errors))
    const schemas = walk.value.map((f) => {
      const r = parseSchema(f.raw, f.schema_type, f.path)
      if (!r.ok) throw new Error(JSON.stringify(r.errors))
      return r.schema
    })
    const rolesFile = loadSchemaFile(path.join(base, 'roles.json'))
    const routesFile = loadSchemaFile(path.join(base, 'routes.json'))
    if (!rolesFile.ok || !routesFile.ok) throw new Error('sandbox roles or routes did not load')
    const roles = parseRoles(rolesFile.value, 'roles.json')
    const routes = parseRoutes(routesFile.value, 'routes.json')
    if (!roles.ok || !routes.ok) throw new Error('sandbox roles or routes did not parse')
    const registry = buildSchemaRegistry(schemas, routes.value, roles.value)
    expect(Object.keys(registry.content_types).length).toBeGreaterThan(0)
    expect(findConstraintNameCollisions(registry)).toEqual([])
  })
})

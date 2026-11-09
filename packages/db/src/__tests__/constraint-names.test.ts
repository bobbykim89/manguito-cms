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
import { findConstraintNameCollisions, foreignKeyName } from '../constraint-names'

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

describe('findConstraintNameCollisions — a link table’s two foreign keys (K1)', () => {
  // `junction_taxonomy_tag_` is 22 characters, so a 40-character field gives a
  // 62-character link table. Its foreign keys `<link table>_left_id_…` and
  // `<link table>_right_id_…` then differ only at character 64.
  const prefix = 'junction_taxonomy_tag_'.length
  const withList = (field: string) =>
    registryOf(taxonomy('taxonomy--tag', [TITLE, m2m(field)]))

  it('refuses a 62-character link table and names the field length that fits', () => {
    // MUTATION: compare full names instead of their first 63 characters. The two
    // foreign keys differ at character 64, so nothing would be reported.
    const field = 'f'.repeat(62 - prefix)
    expect(`junction_taxonomy_tag_${field}`).toHaveLength(62)
    const errors = collisions(withList(field))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ file: 'schemas/taxonomy-types/taxonomy--tag.json', path: 'fields[1].name' })
    expect(errors[0]!.message).toContain(`field "${field}" of "taxonomy--tag"`)
    expect(errors[0]!.message).toContain('Postgres keeps only the first 63 characters of a name')
    expect(errors[0]!.message).toContain(`shorten field "${field}" to at most ${61 - prefix} characters, or the name of type "taxonomy--tag"`)
  })

  it('is cleared by shortening the field to the length the message names', () => {
    // MUTATION: suggest one character more (62 − prefix). A field of that length
    // gives a 62-character link table again, and the error stays.
    const [error] = collisions(withList('f'.repeat(62 - prefix)))
    const fixed = 'f'.repeat(suggested(error!))
    expect(collisions(withList(fixed))).toEqual([])
    expect(`junction_taxonomy_tag_${fixed}`).toHaveLength(61)
  })

  it('names only the type when the link-table prefix leaves no room for the field', () => {
    // MUTATION: always suggest shortening the field. Here the prefix
    // `junction_taxonomy_<43 b's>_` alone is 62 characters, so no field fits.
    const longType = (n: number) => `taxonomy--${'b'.repeat(n)}`
    const registry = (n: number) => registryOf(TAG, taxonomy(longType(n), [m2m('x')]))
    const errors = collisions(registry(43))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`shorten the name of type "${longType(43)}": its link table names already have 62 characters before the field name`)
    expect(collisions(registry(30))).toEqual([])
  })
})

describe('findConstraintNameCollisions — two foreign keys of one table (K2)', () => {
  // content_post is 12 characters, so foreign keys `content_post_<column>_…`
  // keep 62 − 12 = 50 characters of the column.
  const one = `${'a'.repeat(50)}_one`
  const two = `${'a'.repeat(50)}_two`

  it('refuses two reference columns that share the characters Postgres keeps', () => {
    // MUTATION: compare full names. The two foreign keys differ after character
    // 63, so nothing would be reported.
    const errors = collisions(registryOf(TAG, content('content--post', [ref(one), ref(two)])))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ file: 'schemas/content-types/content--post.json', path: 'fields[0].tab.fields[1].name' })
    expect(errors[0]!.message).toContain(`"${foreignKeyName('content_post', one, 'taxonomy_tag', 'id')}"`)
    expect(errors[0]!.message).toContain('Postgres keeps only the first 63 characters of a name')
    expect(errors[0]!.message).toContain(
      `rename field "${one}" or "${two}" so that the two differ within their first 50 characters, or shorten the name of type "content--post"`,
    )
  })

  it('is cleared by a rename that differs at the last character the message allows', () => {
    // MUTATION: suggest one character more (63 − table length). A rename that
    // differs only at that character still collides, since Postgres drops it.
    const [error] = collisions(registryOf(TAG, content('content--post', [ref(one), ref(two)])))
    const n = suggested(error!)
    const renamed = `${'a'.repeat(n - 1)}b`
    expect(collisions(registryOf(TAG, content('content--post', [ref(one), ref(renamed)])))).toEqual([])
  })

  it('names the column when it differs from the field name', () => {
    // MUTATION: name only the field. The collision is in the column, which a
    // `column` declaration keeps apart from the field name.
    const pinned = { ...ref('pinned'), column: two }
    const [error] = collisions(registryOf(TAG, content('content--post', [ref(one), pinned])))
    expect(error!.message).toContain(`field "pinned" (column "${two}")`)
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
    expect(errors[0]!.message).toContain(`rename field "${one}" or "${two}" so that the two differ within their first 57 characters.`)
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
  it('reports a foreign key and a check constraint that share their first 63 characters', () => {
    // MUTATION: compare names only within one kind. The foreign key of `x…`
    // and the check of `content_post_x…` both begin with 63 identical characters.
    const fk = 'x'.repeat(55)
    const check = `content_post_${'x'.repeat(50)}`
    const errors = collisions(registryOf(TAG, content('content--post', [ref(fk), enumField(check)])))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain(`"${foreignKeyName('content_post', fk, 'taxonomy_tag', 'id')}"`)
    expect(errors[0]!.message).toContain(`"${check}_check"`)
    expect(errors[0]!.message).toContain(`field "${fk}"`)
    expect(errors[0]!.message).toContain(`field "${check}"`)
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

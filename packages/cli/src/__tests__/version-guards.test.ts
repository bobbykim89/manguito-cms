import { describe, it, expect } from 'vitest'
import { highestSnapshot } from '../commands/version.js'
import { orphanedTombstoneErrors } from '../commands/version.js'
import {
  parseSchema,
  buildSchemaRegistry,
  type ParsedSchema,
  type ParsedRoles,
  type ParsedRoutes,
  type SchemaRegistry,
} from '@bobbykim/manguito-cms-core'

// Core publishes only its main entry (`exports` is just "."), so its internal
// test fixtures are not importable here. These build registries through the
// REAL parseSchema, which is the point: a hand-forged db_column would make
// name and column identical and the tests could not tell column-keying from
// name-keying.
const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

type FieldSpec = { name: string; type?: string; removed?: boolean; column?: string }

function makeContentType(name: string, fields: FieldSpec[]): ParsedSchema {
  const result = parseSchema(
    {
      name,
      label: name,
      type: 'content-type',
      default_base_path: 'x',
      only_one: false,
      // ContentTypeRawSchema requires fields wrapped in at least one tab.
      fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields: fields.map((f) => ({
        name: f.name,
        label: f.name,
        type: f.type ?? 'text/plain',
        required: false,
        ...(f.column !== undefined && { column: f.column }),
        ...(f.removed !== undefined && { removed: f.removed }),
      })) } }],
    },
    'content-type',
    `schemas/content-types/${name}.json`
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function makeRegistry(schemas: ParsedSchema[]): SchemaRegistry {
  return buildSchemaRegistry(schemas, EMPTY_ROUTES, EMPTY_ROLES)
}

describe('highestSnapshot', () => {
  it('returns the highest-numbered snapshot, not the last in the array', () => {
    const s = (version: string) => ({ version, registry: makeRegistry([]) })
    expect(highestSnapshot([s('v9'), s('v10'), s('v2')])!.version).toBe('v10')
  })

  it('returns null when nothing has been cut', () => {
    expect(highestSnapshot([])).toBeNull()
  })

  it('ignores a malformed version name rather than ranking it', () => {
    const s = (version: string) => ({ version, registry: makeRegistry([]) })
    expect(highestSnapshot([s('v1'), s('vX')])!.version).toBe('v1')
  })
})

describe('orphanedTombstoneErrors', () => {
  it('names the tombstone that retiring a version would orphan', () => {
    // v1 exposes column blog_desc; current retains it as a tombstone. Retire
    // v1 and nothing exposes that column any more.
    const registry = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snapshots = [
      {
        version: 'v1',
        registry: makeRegistry([
          makeContentType('content--blog_post', [
            { name: 'title' },
            { name: 'blog_desc', type: 'text/rich' },
          ]),
        ]),
      },
    ]

    const errors = orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })
    expect(errors.map((e) => e.code)).toEqual(['ORPHANED_TOMBSTONE'])
    expect(errors[0]!.message).toContain('blog_desc')
  })

  it('returns nothing when another live version still exposes the column', () => {
    const live = (name: string) => makeContentType('content--blog_post', [{ name: 'title' }, { name, type: 'text/rich' }])
    const registry = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title' },
        { name: 'blog_desc', type: 'text/rich', removed: true },
      ]),
    ])
    const snapshots = [
      { version: 'v1', registry: makeRegistry([live('blog_desc')]) },
      { version: 'v2', registry: makeRegistry([live('blog_desc')]) },
    ]

    // v2 still exposes blog_desc, so retiring v1 orphans nothing.
    expect(orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })).toEqual([])
  })

  it('returns nothing when there are no tombstones at all', () => {
    const registry = makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])])
    const snapshots = [
      { version: 'v1', registry: makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]) },
    ]
    expect(orphanedTombstoneErrors({ registry, snapshots, retiring: 'v1' })).toEqual([])
  })
})

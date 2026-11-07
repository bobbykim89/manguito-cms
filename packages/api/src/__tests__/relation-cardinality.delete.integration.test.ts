import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import { getTestDb, createTestApp, authenticatedRequest, testParsedSchema } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
  countRows,
  seedTestUsers,
  parseOrThrow,
  tableSql,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcdel')
const EXTRA = 'rcdel_outside_ref'
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>

// A taxonomy whose required single reference points at its own type, built
// through core's real parser so its column and RESTRICT rule are real.
const SELF = 'taxonomy--rcdelself_node'
const selfRegistry = buildSchemaRegistry(
  [
    parseOrThrow(
      {
        name: SELF,
        label: 'Node',
        type: 'taxonomy-type',
        fields: [
          { name: 'name', label: 'Name', type: 'text/plain', required: false },
          { name: 'parent', label: 'Parent', type: 'reference', target: SELF, rel: 'one-to-one', required: true },
        ],
      },
      'taxonomy-type'
    ),
  ],
  { base_paths: [] },
  testParsedSchema.roles
)
const selfTable = selfRegistry.taxonomy_types[SELF]!.db.table_name
let selfApp: ReturnType<typeof createTestApp>

// A taxonomy whose own paragraphs hold a required reference back to their type:
// a block directly, and an inner paragraph nested one level inside the block.
const OWN = {
  node: 'taxonomy--rcdelown_node',
  block: 'paragraph--rcdelown_block',
  inner: 'paragraph--rcdelown_inner',
}
const ownRegistry = buildSchemaRegistry(
  [
    parseOrThrow(
      {
        name: OWN.node,
        label: 'Node',
        type: 'taxonomy-type',
        fields: [
          { name: 'name', label: 'Name', type: 'text/plain', required: false },
          { name: 'blocks', label: 'Blocks', type: 'paragraph', ref: OWN.block, rel: 'one-to-many', required: false },
        ],
      },
      'taxonomy-type'
    ),
    parseOrThrow(
      {
        name: OWN.block,
        label: 'Block',
        type: 'paragraph-type',
        fields: [
          { name: 'back', label: 'Back', type: 'reference', target: OWN.node, rel: 'one-to-one', required: true },
          { name: 'inner', label: 'Inner', type: 'paragraph', ref: OWN.inner, rel: 'one-to-one', required: false },
        ],
      },
      'paragraph-type'
    ),
    parseOrThrow(
      {
        name: OWN.inner,
        label: 'Inner',
        type: 'paragraph-type',
        fields: [
          { name: 'back', label: 'Back', type: 'reference', target: OWN.node, rel: 'one-to-one', required: true },
        ],
      },
      'paragraph-type'
    ),
  ],
  { base_paths: [] },
  testParsedSchema.roles
)
const ownTables = {
  node: ownRegistry.taxonomy_types[OWN.node]!.db.table_name,
  block: ownRegistry.paragraph_types[OWN.block]!.db.table_name,
  inner: ownRegistry.paragraph_types[OWN.inner]!.db.table_name,
}
let ownApp: ReturnType<typeof createTestApp>

async function dropOwnTables(): Promise<void> {
  for (const t of [ownTables.inner, ownTables.block, ownTables.node]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
}

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await seedTestUsers(db)
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  const self = selfRegistry.taxonomy_types[SELF]!
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${selfTable}" CASCADE`))
  await db.execute(sql.raw(tableSql(selfTable, self.system_fields, self.fields)))
  selfApp = createTestApp(selfRegistry, db)
  await dropOwnTables()
  const node = ownRegistry.taxonomy_types[OWN.node]!
  const block = ownRegistry.paragraph_types[OWN.block]!
  const inner = ownRegistry.paragraph_types[OWN.inner]!
  await db.execute(sql.raw(tableSql(ownTables.node, node.system_fields, node.fields)))
  await db.execute(sql.raw(tableSql(ownTables.block, block.system_fields, block.fields)))
  await db.execute(sql.raw(tableSql(ownTables.inner, inner.system_fields, inner.fields)))
  ownApp = createTestApp(ownRegistry, db)
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${selfTable}" CASCADE`))
  await dropOwnTables()
  await dropFixtureTables(db, fx)
})

const delTag = (id: string) => authenticatedRequest(app, 'admin', 'DELETE', `/admin/api/taxonomy/${fx.names.tag}/${id}`)
const delPost = (id: string) => authenticatedRequest(app, 'admin', 'DELETE', `/admin/api/content/${fx.names.post}/${id}`)

describe('deleting an item a required reference uses', () => {
  it('is refused with 409 ITEM_IN_USE naming each location, and the item stays', async () => {
    // MUTATION: skip findRequiredReferrers in the taxonomy delete. RESTRICT then
    // fires, and the response is the generic race message (or a 500 before
    // Task 9), with no locations.
    const tag = await insertTag(db, fx, 'used')
    const post = await insertPost(db, fx, { slug: 'uses-tag', owner: tag })
    await insertParagraph(db, fx.tables.card, {
      parentId: post, parentType: fx.tables.post, parentField: 'cards', order: 0, values: { card_tag: tag },
    })
    const res = await delTag(tag)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('ITEM_IN_USE')
    expect(body.error.message).toBe(
      'This item is still used by 2 items: 1 in Post (Owner), 1 in Card (Card tag). Remove it from those first.'
    )
    expect(await countRows(db, fx.tables.tag, `id = '${tag}'`)).toBe(1)
  })

  it('maps a foreign-key violation the pre-check cannot see to 409, touching nothing', async () => {
    // MUTATION: keep the old order (paragraph cleanup, then repo.delete) or drop
    // the isForeignKeyViolation catch. The post's link row is then gone, or the
    // response is a 500.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
    const tag = await insertTag(db, fx, 'owner')
    const post = await insertPost(db, fx, { slug: 'outside-ref', owner: tag })
    await insertParagraph(db, fx.tables.link, {
      parentId: post, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'stay' },
    })
    // A table outside the registry stands in for a use added after the check.
    await db.execute(
      sql.raw(`CREATE TABLE "${EXTRA}" (ref uuid NOT NULL REFERENCES "${fx.tables.post}"(id) ON DELETE RESTRICT)`)
    )
    await db.execute(sql.raw(`INSERT INTO "${EXTRA}" (ref) VALUES ('${post}')`))

    const res = await delPost(post)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still in use. Remove it from the items that use it first.'
    )
    expect(await countRows(db, fx.tables.post, `id = '${post}'`)).toBe(1)
    expect(await countRows(db, fx.tables.link, `parent_id = '${post}'`)).toBe(1)
  })
})

describe('deletes that must still succeed', () => {
  it('deleting a target of optional references clears them and succeeds', async () => {
    // MUTATION: count optional references in findRequiredReferrers too. The
    // delete is then refused although nothing requires the tag.
    const owner = await insertTag(db, fx, 'owner')
    const optional = await insertTag(db, fx, 'optional')
    const post = await insertPost(db, fx, { slug: 'optional-uses', owner })
    await db.execute(sql.raw(`UPDATE "${fx.tables.post}" SET category = '${optional}' WHERE id = '${post}'`))
    await db.execute(sql.raw(`INSERT INTO "${fx.tables.tags}" (left_id, right_id) VALUES ('${post}', '${optional}')`))

    const res = await delTag(optional)
    expect(res.status).toBe(200)
    expect(await countRows(db, fx.tables.post, `id = '${post}' AND category IS NULL`)).toBe(1)
    expect(await countRows(db, fx.tables.tags, `right_id = '${optional}'`)).toBe(0)
  })

  it('a successful delete still removes the item\'s paragraph rows', async () => {
    // MUTATION: return right after repo.delete, dropping the cleanup moved
    // after it.
    const owner = await insertTag(db, fx, 'owner')
    const post = await insertPost(db, fx, { slug: 'with-paragraphs', owner })
    await insertParagraph(db, fx.tables.link, {
      parentId: post, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'gone' },
    })
    expect((await delPost(post)).status).toBe(200)
    expect(await countRows(db, fx.tables.link, `parent_id = '${post}'`)).toBe(0)
  })
})

describe('a required reference to its own type', () => {
  const insertNode = async (name: string, parent: string | 'self'): Promise<string> => {
    const id = randomUUID()
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"${selfTable}"`)} (id, name, parent, published)
          VALUES (${id}, ${name}, ${parent === 'self' ? id : parent}, true)`
    )
    return id
  }
  const delNode = (id: string) => authenticatedRequest(selfApp, 'admin', 'DELETE', `/admin/api/taxonomy/${SELF}/${id}`)

  it('does not count the item pointing at itself, so it can be deleted', async () => {
    // MUTATION: count every row of the owner's table, including the row being
    // deleted. An item that references itself is then refused with 409,
    // although Postgres would delete it under RESTRICT.
    const node = await insertNode('alone', 'self')
    expect((await delNode(node)).status).toBe(200)
    expect(await countRows(db, selfTable, `id = '${node}'`)).toBe(0)
  })

  it('still refuses the delete while another item points at it', async () => {
    // MUTATION: skip the count entirely when the referring field's owner is
    // the type being deleted. The other item's use is then missed and the
    // delete reaches RESTRICT (the race message), not the counted 409.
    const root = await insertNode('root', 'self')
    const child = await insertNode('child', root)
    const res = await delNode(root)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still used by 1 item: 1 in Node (Parent). Remove it from those first.'
    )
    expect(await countRows(db, selfTable, `id = '${root}'`)).toBe(1)
    expect((await delNode(child)).status).toBe(200)
    expect((await delNode(root)).status).toBe(200)
  })
})

describe('an item whose own paragraph refers back to it', () => {
  const insertNode = async (name: string): Promise<string> => {
    const r = await db.execute(
      sql`INSERT INTO ${sql.raw(`"${ownTables.node}"`)} (name, published) VALUES (${name}, true) RETURNING id`
    )
    return (r.rows[0] as { id: string }).id
  }
  const insertBlock = (parent: string, back: string): Promise<string> =>
    insertParagraph(db, ownTables.block, {
      parentId: parent, parentType: ownTables.node, parentField: 'blocks', order: 0, values: { back },
    })
  const delNode = (id: string) => authenticatedRequest(ownApp, 'admin', 'DELETE', `/admin/api/taxonomy/${OWN.node}/${id}`)

  it('deletes it, with its paragraphs, when only its own paragraph refers back', async () => {
    // MUTATION: count own paragraph rows as uses (today's findRequiredReferrers).
    // The delete is a 409.
    const node = await insertNode('alone')
    const block = await insertBlock(node, node)
    expect((await delNode(node)).status).toBe(200)
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(0)
    expect(await countRows(db, ownTables.block, `id = '${block}'`)).toBe(0)
  })

  it('deletes it when the reference back is in a nested paragraph', async () => {
    // MUTATION: collect only direct paragraph rows in ownParagraphRowIds. The
    // nested row counts as a use: 409.
    const node = await insertNode('nested')
    const other = await insertNode('other')
    const block = await insertBlock(node, other)
    const inner = await insertParagraph(db, ownTables.inner, {
      parentId: block, parentType: ownTables.block, parentField: 'inner', order: 0, values: { back: node },
    })
    expect((await delNode(node)).status).toBe(200)
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(0)
    expect(await countRows(db, ownTables.block, `id = '${block}'`)).toBe(0)
    expect(await countRows(db, ownTables.inner, `id = '${inner}'`)).toBe(0)
  })

  it("still refuses while another item's paragraph refers to it, counting only that one", async () => {
    // MUTATION: skip paragraph owners whenever own rows exist. The other
    // item's use is missed.
    const node = await insertNode('used')
    await insertBlock(node, node)
    const other = await insertNode('user')
    await insertBlock(other, node)
    const res = await delNode(node)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still used by 1 item: 1 in Block (Back). Remove it from those first.'
    )
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(1)
  })
})

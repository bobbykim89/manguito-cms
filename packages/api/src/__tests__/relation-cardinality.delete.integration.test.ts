import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import { getTestDb, authenticatedRequest, testParsedSchema, seedRoleUsers } from '@bobbykim/manguito-cms-test-utils'
import { createTestApp } from './test-app'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
  countRows,
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
// The node and the block each hold an image, for the media counts. A content
// type (page) has its own paragraph (section) refer back the same way.
const OWN = {
  node: 'taxonomy--rcdelown_node',
  block: 'paragraph--rcdelown_block',
  inner: 'paragraph--rcdelown_inner',
  page: 'content--rcdelown_page',
  section: 'paragraph--rcdelown_section',
}
const OWN_BASE_PATH = 'rcdelown-pages'
const ownRegistry = buildSchemaRegistry(
  [
    parseOrThrow(
      {
        name: OWN.node,
        label: 'Node',
        type: 'taxonomy-type',
        fields: [
          { name: 'name', label: 'Name', type: 'text/plain', required: false },
          { name: 'photo', label: 'Photo', type: 'image', required: false },
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
          { name: 'image', label: 'Image', type: 'image', required: false },
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
    parseOrThrow(
      {
        name: OWN.page,
        label: 'Page',
        type: 'content-type',
        default_base_path: OWN_BASE_PATH,
        only_one: false,
        fields: [
          {
            tab: {
              name: 'main',
              label: 'Main',
              fields: [
                { name: 'title', label: 'Title', type: 'text/plain', required: false },
                { name: 'sections', label: 'Sections', type: 'paragraph', ref: OWN.section, rel: 'one-to-many', required: false },
              ],
            },
          },
        ],
      },
      'content-type'
    ),
    parseOrThrow(
      {
        name: OWN.section,
        label: 'Section',
        type: 'paragraph-type',
        fields: [
          { name: 'back', label: 'Back', type: 'reference', target: OWN.page, rel: 'one-to-one', required: true },
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
  page: ownRegistry.content_types[OWN.page]!.db.table_name,
  section: ownRegistry.paragraph_types[OWN.section]!.db.table_name,
}
let ownApp: ReturnType<typeof createTestApp>
// Media rows this file seeds, removed in afterAll.
const seededMedia: string[] = []

async function dropOwnTables(): Promise<void> {
  for (const t of [ownTables.section, ownTables.page, ownTables.inner, ownTables.block, ownTables.node]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
  await db.execute(sql`DELETE FROM base_paths WHERE path = ${OWN_BASE_PATH}`)
}

// The columns follow the media table admin.integration.test.ts creates.
async function ensureMediaTable(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL DEFAULT 'image',
      url VARCHAR(2048) NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      alt VARCHAR(255),
      file_size INTEGER NOT NULL,
      width INTEGER, height INTEGER, duration INTEGER,
      reference_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`))
}

async function insertMedia(referenceCount: number): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO media (type, url, mime_type, file_size, reference_count)
        VALUES ('image', 'http://localhost/uploads/rcdel.png', 'image/png', 1, ${referenceCount}) RETURNING id`
  )
  const id = (r.rows[0] as { id: string }).id
  seededMedia.push(id)
  return id
}

async function mediaCount(id: string): Promise<number> {
  const r = await db.execute(sql`SELECT reference_count FROM media WHERE id = ${id}`)
  return (r.rows[0] as { reference_count: number }).reference_count
}

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await seedRoleUsers(db)
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  const self = selfRegistry.taxonomy_types[SELF]!
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${selfTable}" CASCADE`))
  await db.execute(sql.raw(tableSql(selfTable, self.system_fields, self.fields)))
  selfApp = createTestApp(selfRegistry, db)
  await dropOwnTables()
  await ensureMediaTable()
  const node = ownRegistry.taxonomy_types[OWN.node]!
  const block = ownRegistry.paragraph_types[OWN.block]!
  const inner = ownRegistry.paragraph_types[OWN.inner]!
  const page = ownRegistry.content_types[OWN.page]!
  const section = ownRegistry.paragraph_types[OWN.section]!
  await db.execute(sql.raw(tableSql(ownTables.node, node.system_fields, node.fields)))
  await db.execute(sql.raw(tableSql(ownTables.block, block.system_fields, block.fields)))
  await db.execute(sql.raw(tableSql(ownTables.inner, inner.system_fields, inner.fields)))
  await db.execute(sql.raw(tableSql(ownTables.page, page.system_fields, page.fields)))
  await db.execute(sql.raw(tableSql(ownTables.section, section.system_fields, section.fields)))
  await db.execute(sql`INSERT INTO base_paths (name, path) VALUES (${OWN_BASE_PATH}, ${OWN_BASE_PATH}) ON CONFLICT (path) DO NOTHING`)
  ownApp = createTestApp(ownRegistry, db)
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${selfTable}" CASCADE`))
  await dropOwnTables()
  if (seededMedia.length > 0) await db.execute(sql`DELETE FROM media WHERE id = ANY(${sql.param(seededMedia)}::uuid[])`)
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

  it('maps a foreign-key violation on a taxonomy delete to 409, touching nothing', async () => {
    // MUTATION: delete the taxonomy item's paragraphs before its row. Its link row is then gone.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
    const tag = await insertTag(db, fx, 'with-link')
    await insertParagraph(db, fx.tables.link, {
      parentId: tag, parentType: fx.tables.tag, parentField: 'tag_link', order: 0, values: { url: 'stay' },
    })
    // A table outside the registry stands in for a use added after the check.
    await db.execute(
      sql.raw(`CREATE TABLE "${EXTRA}" (ref uuid NOT NULL REFERENCES "${fx.tables.tag}"(id) ON DELETE RESTRICT)`)
    )
    await db.execute(sql.raw(`INSERT INTO "${EXTRA}" (ref) VALUES ('${tag}')`))

    const res = await delTag(tag)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still in use. Remove it from the items that use it first.'
    )
    expect(await countRows(db, fx.tables.tag, `id = '${tag}'`)).toBe(1)
    expect(await countRows(db, fx.tables.link, `parent_id = '${tag}'`)).toBe(1)
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
    // item's use is missed. Or delete own paragraphs before the refusal: the
    // node's own block is then gone although the node stays.
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
    expect(await countRows(db, ownTables.block, `parent_id = '${node}'`)).toBe(1)
  })

  it('deletes a content item, with its paragraphs, when only its own paragraph refers back', async () => {
    // MUTATION: pass no fields to deleteItemCascade from the content route.
    // Its section is then not removed first, and RESTRICT refuses the row:
    // the race 409.
    const bp = await db.execute(sql`SELECT id FROM base_paths WHERE path = ${OWN_BASE_PATH}`)
    const r = await db.execute(
      sql`INSERT INTO ${sql.raw(`"${ownTables.page}"`)} (slug, base_path_id, published)
          VALUES ('own-page', ${(bp.rows[0] as { id: string }).id}, true) RETURNING id`
    )
    const page = (r.rows[0] as { id: string }).id
    const section = await insertParagraph(db, ownTables.section, {
      parentId: page, parentType: ownTables.page, parentField: 'sections', order: 0, values: { back: page },
    })
    expect((await authenticatedRequest(ownApp, 'admin', 'DELETE', `/admin/api/content/${OWN.page}/${page}`)).status).toBe(200)
    expect(await countRows(db, ownTables.page, `id = '${page}'`)).toBe(0)
    expect(await countRows(db, ownTables.section, `id = '${section}'`)).toBe(0)
  })
})

describe('media counts when the paragraphs go first', () => {
  const insertNode = async (photo: string): Promise<string> => {
    const r = await db.execute(
      sql`INSERT INTO ${sql.raw(`"${ownTables.node}"`)} (name, photo, published) VALUES ('media', ${photo}, true) RETURNING id`
    )
    return (r.rows[0] as { id: string }).id
  }
  const insertBlock = (parent: string, image: string): Promise<string> =>
    insertParagraph(db, ownTables.block, {
      parentId: parent, parentType: ownTables.node, parentField: 'blocks', order: 0, values: { back: parent, image },
    })
  const delNode = (id: string) => authenticatedRequest(ownApp, 'admin', 'DELETE', `/admin/api/taxonomy/${OWN.node}/${id}`)

  // A node holding `shared` at top level and in one own block, and
  // `blockOnly` in another. Each media id counts the node once.
  const seed = async () => {
    const shared = await insertMedia(1)
    const blockOnly = await insertMedia(1)
    const node = await insertNode(shared)
    await insertBlock(node, shared)
    await insertBlock(node, blockOnly)
    return { shared, blockOnly, node }
  }

  it('on a foreign-key race, releases only the media the item no longer holds', async () => {
    // MUTATION: release all paragraph media ids. `shared` then drops to 0
    // although the node still holds it at top level.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
    const { shared, blockOnly, node } = await seed()
    // A table outside the registry stands in for a use added after the check.
    await db.execute(
      sql.raw(`CREATE TABLE "${EXTRA}" (ref uuid NOT NULL REFERENCES "${ownTables.node}"(id) ON DELETE RESTRICT)`)
    )
    await db.execute(sql.raw(`INSERT INTO "${EXTRA}" (ref) VALUES ('${node}')`))

    const res = await delNode(node)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still in use. Remove it from the items that use it first.'
    )
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(1)
    expect(await countRows(db, ownTables.block, `parent_id = '${node}'`)).toBe(0)
    expect(await mediaCount(shared)).toBe(1)
    expect(await mediaCount(blockOnly)).toBe(0)
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
  })

  it('on any other failure of the row delete, still releases the media of the removed paragraphs', async () => {
    // MUTATION: release only on a foreign-key violation (rethrow other errors
    // first). `blockOnly` then stays at 1 with no paragraph left to hold it.
    const { shared, blockOnly, node } = await seed()
    // A trigger makes the row delete fail with an error that is not 23503.
    await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION rcdel_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`))
    await db.execute(sql.raw(`CREATE TRIGGER rcdel_refuse BEFORE DELETE ON "${ownTables.node}" FOR EACH ROW EXECUTE FUNCTION rcdel_refuse()`))
    try {
      expect((await delNode(node)).status).toBe(500)
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS rcdel_refuse ON "${ownTables.node}"`))
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS rcdel_refuse()`))
    }
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(1)
    expect(await countRows(db, ownTables.block, `parent_id = '${node}'`)).toBe(0)
    expect(await mediaCount(shared)).toBe(1)
    expect(await mediaCount(blockOnly)).toBe(0)
  })

  it('on success, releases the media of its own fields and of its paragraphs', async () => {
    // MUTATION: release only the paragraph media on the paragraphs-first
    // path. `topOnly` then stays at 1 after the node is gone.
    const topOnly = await insertMedia(1)
    const blockOnly = await insertMedia(1)
    const node = await insertNode(topOnly)
    await insertBlock(node, blockOnly)
    expect((await delNode(node)).status).toBe(200)
    expect(await countRows(db, ownTables.node, `id = '${node}'`)).toBe(0)
    expect(await mediaCount(topOnly)).toBe(0)
    expect(await mediaCount(blockOnly)).toBe(0)
  })
})

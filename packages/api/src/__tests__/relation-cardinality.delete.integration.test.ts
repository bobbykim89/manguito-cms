import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
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
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcdel')
const EXTRA = 'rcdel_outside_ref'
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await seedTestUsers(db)
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
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

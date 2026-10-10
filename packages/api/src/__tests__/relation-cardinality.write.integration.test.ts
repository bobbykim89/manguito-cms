import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  seedTestUsers,
  dropFixtureTables,
  insertTag,
  countRows,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcwrite')
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>
let tagA = ''
let tagB = ''

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await seedTestUsers(db)
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  tagA = await insertTag(db, fx, 'a')
  tagB = await insertTag(db, fx, 'b')
}, 30_000)

afterAll(async () => {
  await dropFixtureTables(db, fx)
})

const POSTS = () => `/admin/api/content/${fx.names.post}`
let slugN = 0

async function create(extra: Record<string, unknown>) {
  const res = await authenticatedRequest(app, 'admin', 'POST', POSTS(), {
    body: { slug: `p-${++slugN}`, title: 'T', owner: tagA, ...extra },
  })
  return { status: res.status, body: (await res.json()) as { data?: { id: string }; error?: { code: string; details?: Array<{ field: string }> } } }
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await authenticatedRequest(app, 'admin', 'PATCH', `${POSTS()}/${id}`, { body })
  return { status: res.status, body: (await res.json()) as { error?: { code: string } } }
}

const linkRows = (parentId: string, field = 'link') =>
  countRows(db, fx.tables.link, `parent_id = '${parentId}' AND parent_field = '${field}'`)

describe('writing a one-to-one paragraph', () => {
  it('stores an object', async () => {
    // MUTATION: keep `Array.isArray(body[f.name]) ? … : []` in writeNewItem.
    // The object is dropped and nothing is stored (today's silent loss).
    const { status, body } = await create({ link: { url: 'u1' } })
    expect(status).toBe(201)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('rejects a list with 422 and stores nothing', async () => {
    // MUTATION: drop the relationShapeError call in writeNewItem.
    const { status, body } = await create({ link: [{ url: 'u1' }] })
    expect(status).toBe(422)
    expect(body.error!.code).toBe('VALIDATION_ERROR')
    expect(body.error!.details!.map((d) => d.field)).toEqual(['link'])
  })

  it('null clears it on update', async () => {
    // MUTATION: map null to "skip" instead of an empty list. The row stays.
    const { body } = await create({ link: { url: 'u1' } })
    expect((await patch(body.data!.id, { link: null })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(0)
  })

  it('an update that leaves the field out keeps it', async () => {
    // MUTATION: remove `if (!(f.name in body)) continue` from writeExistingItem's
    // paragraph loop. A title-only PATCH then erases the link.
    const { body } = await create({ link: { url: 'keep' } })
    expect((await patch(body.data!.id, { title: 'renamed' })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('an update with the wrong shape is refused and erases nothing', async () => {
    // MUTATION: validate after the paragraph loop. The rows are deleted first.
    const { body } = await create({ link: { url: 'keep' } })
    expect((await patch(body.data!.id, { link: [{ url: 'x' }] })).status).toBe(422)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('accepts a round-tripped admin read value', async () => {
    // MUTATION: reject objects carrying unknown keys (id, parent_id, order…).
    // The admin edit form saves back exactly what it read.
    const { body } = await create({ link: { url: 'rt' } })
    const read = await authenticatedRequest(app, 'admin', 'GET', `${POSTS()}/${body.data!.id}`)
    const link = ((await read.json()) as { data: { link: Record<string, unknown> } }).data.link
    expect((await patch(body.data!.id, { link })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('stores a nested one-to-one paragraph inside a list item', async () => {
    // MUTATION: keep `Array.isArray(pItem[n.fieldName]) ? … : []` in
    // persistParagraphField. The nested object is dropped.
    const { body } = await create({ cards: [{ heading: 'h', card_link: { url: 'n' }, card_tag: tagA }] })
    const card = await db.execute(
      sql.raw(`SELECT id FROM "${fx.tables.card}" WHERE parent_id = '${body.data!.id}'`)
    )
    const cardId = (card.rows[0] as { id: string }).id
    expect(await linkRows(cardId, 'card_link')).toBe(1)
  })
})

describe('writing references', () => {
  it('a deprecated one-to-many reference stores one id', async () => {
    // MUTATION: reject strings for 'one' references.
    const { status, body } = await create({ category: tagB })
    expect(status).toBe(201)
    const row = await db.execute(sql.raw(`SELECT category FROM "${fx.tables.post}" WHERE id = '${body.data!.id}'`))
    expect((row.rows[0] as { category: string }).category).toBe(tagB)
  })

  it('a list for a "one" reference is a 422, not a 500', async () => {
    // MUTATION: skip reference fields in checkRelationInput. Postgres then
    // fails on `($1, $2)` and the response is a 500.
    expect((await create({ category: [tagA, tagB] })).status).toBe(422)
  })

  it('rejects null for a "many" field', async () => {
    // MUTATION: treat null as []. The request "succeeds" and clears the field.
    expect((await create({ tags: null })).status).toBe(422)
  })

  it('an update that leaves a many-to-many field out keeps its links', async () => {
    // MUTATION: remove `if (!(f.name in body)) continue` from writeExistingItem's
    // junction loop.
    const { body } = await create({ tags: [tagA, tagB] })
    expect((await patch(body.data!.id, { title: 'renamed' })).status).toBe(200)
    expect(await countRows(db, fx.tables.tags, `left_id = '${body.data!.id}'`)).toBe(2)
  })

  it('a malformed id in a "many" reference is a 422 that keeps the existing links', async () => {
    // MUTATION: accept any string array for a 'many' reference. The PATCH then
    // deletes both links, inserts tagA, fails on 'bogus' (22P02) and 500s,
    // leaving one link.
    const { body } = await create({ tags: [tagA, tagB] })
    const res = await patch(body.data!.id, { tags: [tagA, 'bogus'] })
    expect(res.status).toBe(422)
    expect(res.body.error!.code).toBe('VALIDATION_ERROR')
    expect(await countRows(db, fx.tables.tags, `left_id = '${body.data!.id}'`)).toBe(2)
  })
})

describe('taxonomy writes', () => {
  const TAGS = () => `/admin/api/taxonomy/${fx.names.tag}`

  it('stores a one-to-one paragraph object, and a name-only PATCH keeps it', async () => {
    // MUTATION: wire the fixes into the content routes only. The taxonomy POST
    // drops the object, or its PATCH erases it.
    const created = await authenticatedRequest(app, 'admin', 'POST', TAGS(), { body: { name: 't', tag_link: { url: 'tl' } } })
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { data: { id: string } }).data.id
    expect(await linkRows(id, 'tag_link')).toBe(1)
    const patched = await authenticatedRequest(app, 'admin', 'PATCH', `${TAGS()}/${id}`, { body: { name: 't2' } })
    expect(patched.status).toBe(200)
    expect(await linkRows(id, 'tag_link')).toBe(1)
  })

  it('rejects a list for a one-to-one paragraph', async () => {
    // MUTATION: no relationShapeError in the taxonomy POST.
    const res = await authenticatedRequest(app, 'admin', 'POST', TAGS(), { body: { name: 't', tag_link: [{ url: 'x' }] } })
    expect(res.status).toBe(422)
  })
})

// #54: inputs that pass the shape check but would make Postgres refuse a
// statement part-way through the write. They are refused before any write.
describe('references and required fields checked before writing', () => {
  const MISSING_ID = '00000000-0000-4000-8000-0000000000ff'
  const postsWithSlug = (slug: string) => countRows(db, fx.tables.post, `slug = '${slug}'`)

  it('refuses a link to an item that does not exist, keeping the existing links', async () => {
    // MUTATION: skip findMissingReferences. persistJunctionField then deletes
    // both links, inserts tagA, and fails on the foreign key: a 500 and lost links.
    const { body } = await create({ tags: [tagA, tagB] })
    const res = await authenticatedRequest(app, 'admin', 'PATCH', `${POSTS()}/${body.data!.id}`, {
      body: { tags: [tagA, MISSING_ID] },
    })
    expect(res.status).toBe(422)
    const err = ((await res.json()) as { error: { message: string; details: Array<{ field: string }> } }).error
    expect(err.message).toBe('Relation fields refer to items that do not exist')
    expect(err.details.map((d) => d.field)).toEqual(['tags[1]'])
    expect(await countRows(db, fx.tables.tags, `left_id = '${body.data!.id}'`)).toBe(2)
  })

  it('refuses a paragraph item missing a required field, writing nothing', async () => {
    // MUTATION: skip checkRequiredInParagraphItems. The post row is inserted,
    // then the card insert fails on NOT NULL: a 500 and a half-created post.
    const { status, body } = await create({ cards: [{ heading: 'no tag' }] })
    expect(status).toBe(422)
    expect(body.error!.code).toBe('VALIDATION_ERROR')
    expect(body.error!.details!.map((d) => d.field)).toEqual(['cards[0].card_tag'])
    expect(await postsWithSlug(`p-${slugN}`)).toBe(0)
  })

  it('names a missing reference inside a paragraph item by its path', async () => {
    // MUTATION: collect reference ids from top-level fields only. The card's
    // card_tag then reaches the database and fails on the foreign key.
    const { status, body } = await create({ cards: [{ heading: 'h', card_tag: MISSING_ID }] })
    expect(status).toBe(422)
    expect(body.error!.details!.map((d) => d.field)).toEqual(['cards[0].card_tag'])
    expect(await postsWithSlug(`p-${slugN}`)).toBe(0)
  })

  it('refuses a single reference to an item that does not exist with 422, not 500', async () => {
    // MUTATION: check only many-to-many lists. The insert then fails on the
    // owner foreign key and the client gets a generic 500.
    const { status, body } = await create({ owner: MISSING_ID })
    expect(status).toBe(422)
    expect(body.error!.details!.map((d) => d.field)).toEqual(['owner'])
  })
})

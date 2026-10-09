import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcread')
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>
let filledId = ''
let filledLinkId = ''
let emptyId = ''

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  const tag = await insertTag(db, fx, 'owner-tag')

  filledId = await insertPost(db, fx, { slug: 'filled', owner: tag })
  filledLinkId = await insertParagraph(db, fx.tables.link, {
    parentId: filledId, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'u-top' },
  })
  const cardId = await insertParagraph(db, fx.tables.card, {
    parentId: filledId, parentType: fx.tables.post, parentField: 'cards', order: 0, values: { heading: 'h', card_tag: tag },
  })
  await insertParagraph(db, fx.tables.link, {
    parentId: cardId, parentType: fx.tables.card, parentField: 'card_link', order: 0, values: { url: 'u-nested' },
  })

  emptyId = await insertPost(db, fx, { slug: 'empty', owner: tag })

  // Legacy data: two rows in a one-to-one field, as today's admin allows.
  const legacyId = await insertPost(db, fx, { slug: 'legacy', owner: tag })
  await insertParagraph(db, fx.tables.link, {
    parentId: legacyId, parentType: fx.tables.post, parentField: 'link', order: 1, values: { url: 'second' },
  })
  await insertParagraph(db, fx.tables.link, {
    parentId: legacyId, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'first' },
  })
}, 30_000)

afterAll(async () => {
  await dropFixtureTables(db, fx)
})

async function publicGet(path: string) {
  const res = await app.request(`/api/${fx.basePath}/${path}`)
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } }
}

describe('reading a one-to-one paragraph', () => {
  it('public include returns the single row as an object', async () => {
    // MUTATION: keep `row[fieldName] = byParent[...] ?? []` in
    // resolveRelationField's paragraph branch. `link` is then an array.
    const { status, body } = await publicGet('filled?include=link')
    expect(status).toBe(200)
    expect(Array.isArray(body.data['link'])).toBe(false)
    expect(body.data['link']).toMatchObject({ url: 'u-top' })
  })

  it('public include returns null when the field is empty', async () => {
    // MUTATION: `list[0]` without `?? null`. undefined is dropped from the JSON,
    // so the key goes missing instead of reading null.
    const { body } = await publicGet('empty?include=link')
    expect(body.data['link']).toBeNull()
  })

  it('a read without include returns the single row id, not an array of ids', async () => {
    // MUTATION: keep `.map((r) => r['id'])` unwrapped in resolveRelationBareIds.
    const { body } = await publicGet('filled')
    expect(body.data['link']).toBe(filledLinkId)
  })

  it('returns the lowest-order row when legacy data holds several', async () => {
    // MUTATION: take the last row (`list[list.length - 1]`), or drop
    // `ORDER BY "order"`. The order-1 row inserted first would then win.
    const { body } = await publicGet('legacy?include=link')
    expect(body.data['link']).toMatchObject({ url: 'first' })
  })

  it('leaves one-to-many paragraphs as arrays', async () => {
    // MUTATION: shape every paragraph as 'one'.
    const { body } = await publicGet('filled?include=cards')
    expect(Array.isArray(body.data['cards'])).toBe(true)
    expect((body.data['cards'] as unknown[]).length).toBe(1)
  })

  it('the admin edit read returns objects at both nesting levels', async () => {
    // MUTATION: shape only the top level in the admin read; leave
    // loadParagraphRows' nested assignment as a list. The nested card_link is
    // then an array.
    const res = await authenticatedRequest(app, 'admin', 'GET', `/admin/api/content/${fx.names.post}/${filledId}`)
    const data = ((await res.json()) as { data: Record<string, unknown> }).data
    expect(data['link']).toMatchObject({ url: 'u-top' })
    const cards = data['cards'] as Array<Record<string, unknown>>
    expect(cards[0]!['card_link']).toMatchObject({ url: 'u-nested' })
  })

  it('the admin edit read returns null for an empty one-to-one paragraph', async () => {
    // MUTATION: leave the admin edit read assignment unshaped. It reads [].
    const res = await authenticatedRequest(app, 'admin', 'GET', `/admin/api/content/${fx.names.post}/${emptyId}`)
    const data = ((await res.json()) as { data: Record<string, unknown> }).data
    expect(data['link']).toBeNull()
  })
})

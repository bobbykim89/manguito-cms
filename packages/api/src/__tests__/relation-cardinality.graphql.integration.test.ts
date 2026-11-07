import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, seedRoleUsers } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import { singleQueryName } from '../graphql/naming'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcgql')
let db: DrizzlePostgresInstance
let app: { fetch: (r: Request) => Response | Promise<Response> }
let savedOrder: string[] = []

async function gql(query: string) {
  const res = await app.fetch(
    new Request('http://local/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
  )
  return res.json() as Promise<{ data?: Record<string, { link?: unknown; tags?: { id: string }[] }>; errors?: unknown }>
}

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await seedRoleUsers(db)
  await createFixtureTables(db, fx)
  const owner = await insertTag(db, fx, 'owner-tag')

  const withLink = await insertPost(db, fx, { slug: 'with-link', owner })
  await insertParagraph(db, fx.tables.link, {
    parentId: withLink, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'u' },
  })

  // Saved order is the reverse of id order, so an id-only read gets it wrong.
  const ordered = await insertPost(db, fx, { slug: 'ordered', owner })
  const ids = [await insertTag(db, fx, 'a'), await insertTag(db, fx, 'b'), await insertTag(db, fx, 'c')]
  savedOrder = [...ids].sort().reverse()
  const j = fx.registry.content_types[fx.names.post]!.fields.find((f) => f.name === 'tags')!.db_column!.junction!
  // Rows are inserted in id order, so an unordered read returns id order.
  for (const [order, tagId] of [...savedOrder].reverse().map((id, i) => [savedOrder.length - 1 - i, id] as const)) {
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"${j.table_name}"`)} (${sql.raw(`"${j.left_column}"`)}, ${sql.raw(`"${j.right_column}"`)}, "order") VALUES (${ordered}, ${tagId}, ${order})`
    )
  }

  app = createCmsApp({
    registry: fx.registry,
    db,
    storage: createLocalAdapter(),
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  }).app
}, 30_000)

afterAll(async () => {
  await dropFixtureTables(db, fx)
})

describe('relation cardinality: GraphQL', () => {
  it('resolves a one-to-one paragraph to an object', async () => {
    const q = singleQueryName(fx.names.post)
    const body = await gql(`{ ${q}(slug: "with-link") { link { url } } }`)
    expect(body.errors).toBeUndefined()
    // MUTATION: resolve a 'one' paragraph as a list (before #50). link is then an array.
    expect(body.data?.[q]?.link).toEqual({ url: 'u' })
  })

  it('returns links in their saved order', async () => {
    const q = singleQueryName(fx.names.post)
    const body = await gql(`{ ${q}(slug: "ordered") { tags { id } } }`)
    expect(body.errors).toBeUndefined()
    // MUTATION: drop junctionOrderBy from resolveRelationField.
    expect(body.data?.[q]?.tags?.map((t) => t.id)).toEqual(savedOrder)
  })
})

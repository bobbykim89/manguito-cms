import { describe, it, expect } from 'vitest'
import { graphql } from 'graphql'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import type {
  ParsedContentType,
  ParsedField,
  ParsedParagraphType,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import { createFieldKeyMap } from '../../field-keys'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve'
import {
  divergentParagraphType,
  divergentTargetType,
  divergentTextField,
} from '../../field-keys.test-fixtures'

// Divergence proofs that run through the whole built schema rather than a
// single resolver. The sibling resolvers.divergence.test.ts calls resolvers
// directly; these two cases only exist once buildGraphQLSchema has wired a
// type's FieldKeyMap into the resolver it creates, so they must execute a real
// query to prove anything.

// ─── sortBy: an enum value that is a LABEL, not a column ──────────────────────
//
// The sort enum's internal values mix key spaces: `created_at` / `updated_at`
// are system columns, but `title` is a schema field's label. Under divergence
// handing `title` straight to the repository produces `ORDER BY "title"`
// against column `blog_title` — a Postgres error surfacing as a 500.
//
// divergentTargetType is exactly the shape needed: a content type whose only
// field is label `title` over column `blog_title`.
const sortRegistry = {
  content_types: { 'content--category': divergentTargetType },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function capturingCtx(captured: { opts?: Record<string, unknown> }): GraphQLContext {
  const repo = {
    findMany: async (opts: Record<string, unknown>) => {
      captured.opts = opts
      return {
        data: [],
        meta: { total: 0, page: 1, per_page: 10, total_pages: 0, has_next: false, has_prev: false },
      }
    },
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('GraphQL sortBy with a divergent label', () => {
  const query = '{ categories(sortBy: title) { meta { total } } }'

  it('orders by the storage column, not the label', async () => {
    const schema = buildGraphQLSchema(sortRegistry, {
      'content--category': createFieldKeyMap(divergentTargetType.fields),
    })
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({ schema, source: query, contextValue: capturingCtx(captured) })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('blog_title')
  })

  it('leaves a system column alone — it is not a label and has no mapping', async () => {
    const schema = buildGraphQLSchema(sortRegistry, {
      'content--category': createFieldKeyMap(divergentTargetType.fields),
    })
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({
      schema,
      source: '{ categories(sortBy: createdAt) { meta { total } } }',
      contextValue: capturingCtx(captured),
    })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('created_at')
  })

  it('passes the value through unchanged when no field key map is supplied', async () => {
    const schema = buildGraphQLSchema(sortRegistry)
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({ schema, source: query, contextValue: capturingCtx(captured) })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('title')
  })
})

// ─── A programmatic field on a PARAGRAPH type ────────────────────────────────
//
// buildObjectType runs over paragraph types too, so a programmatic field there
// is built with `fieldKeyMaps['paragraph--card']`. When paragraph maps are kept
// out of that object the map is `undefined`, the projection to labels silently
// degrades to identity, and `ctx.get('title')` reads a storage-keyed record and
// returns undefined — contradicting the rule that the programmatic record is
// the one row GraphQL projects.

const paragraphSummaryField: ParsedField = {
  name: 'summary',
  label: 'Summary',
  field_type: 'programmatic',
  required: false,
  nullable: true,
  order: 1,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'computed-display' },
}

// divergentParagraphType plus a programmatic sibling of its divergent field.
const cardType: ParsedParagraphType = {
  ...divergentParagraphType,
  fields: [divergentTextField, paragraphSummaryField],
}

const cardsField: ParsedField = {
  name: 'cards',
  label: 'Cards',
  field_type: 'paragraph',
  required: false,
  nullable: true,
  order: 1,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' },
}

// divergentTargetType renamed and given the paragraph field — the parent whose
// query reaches the paragraph type.
const postType: ParsedContentType = {
  ...divergentTargetType,
  name: 'content--post',
  fields: [divergentTextField, cardsField],
}

const paragraphRegistry = {
  content_types: { 'content--post': postType },
  taxonomy_types: {},
  paragraph_types: { 'paragraph--card': cardType },
  enum_types: {},
} as unknown as SchemaRegistry

function paragraphCtx(): GraphQLContext {
  const repo = {
    findMany: async () => ({
      data: [{ id: 'c1', blog_title: 'Parent' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    }),
  }
  const resolvers = new Map([
    [
      resolverKey('paragraph--card', 'summary'),
      programmaticField({ schema: 'paragraph--card', field: 'summary' }, (ctx) =>
        `S:${String(ctx.get('title'))}`
      ),
    ],
  ])
  return {
    repos: { 'content--post': repo },
    resolver: createProgrammaticResolver(resolvers),
    // Stand in for the paragraph dataloader: hands back storage-keyed child rows.
    loaders: {
      load: async (_type: string, field: string) =>
        field === 'cards' ? [{ id: 'p1', blog_title: 'Card One' }] : null,
    },
    programmaticMemo: new WeakMap(),
  } as unknown as GraphQLContext
}

describe('GraphQL programmatic field on a paragraph type', () => {
  const query = '{ posts { data { cards { summary } } } }'

  it('hands the resolver a label-keyed record when the paragraph map is present', async () => {
    const schema = buildGraphQLSchema(paragraphRegistry, {
      'content--post': createFieldKeyMap(postType.fields),
      'paragraph--card': createFieldKeyMap(cardType.fields),
    })

    const result = await graphql({ schema, source: query, contextValue: paragraphCtx() })

    expect(result.errors).toBeUndefined()
    const data = result.data as { posts: { data: Array<{ cards: Array<{ summary: string }> }> } }
    expect(data.posts.data[0]!.cards[0]!.summary).toBe('S:Card One')
  })

  it('reads nothing when the paragraph type has no map — the gap this closes', async () => {
    const schema = buildGraphQLSchema(paragraphRegistry, {
      'content--post': createFieldKeyMap(postType.fields),
    })

    const result = await graphql({ schema, source: query, contextValue: paragraphCtx() })

    expect(result.errors).toBeUndefined()
    const data = result.data as { posts: { data: Array<{ cards: Array<{ summary: string }> }> } }
    expect(data.posts.data[0]!.cards[0]!.summary).toBe('S:undefined')
  })
})

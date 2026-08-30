import { describe, it, expect } from 'vitest'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import { divergentMediaField, divergentTextField } from '../../field-keys.test-fixtures'
import { createFieldKeyMap } from '../../field-keys'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve'
import type { GraphQLContext } from '../context'
import { programmaticFieldResolver, resolveFieldValue } from '../resolvers'

describe('GraphQL field value resolution with a divergent label', () => {
  it('reads the storage column, not the label', () => {
    const row = { id: 'c1', blog_title: 'Hello' }
    expect(resolveFieldValue(divergentTextField, row)).toBe('Hello')
  })

  it('returns null when the column is absent', () => {
    expect(resolveFieldValue(divergentTextField, { id: 'c1' })).toBeNull()
  })
})

// GraphQL has no route-level projection: every other field resolves per field by
// column (resolveFieldValue above). The programmatic record is the one row that
// must speak labels, because `ctx.get(fieldName)` takes the schema field name.
describe('GraphQL programmatic resolution with a divergent label', () => {
  function contextWith(loaderEffect?: (row: Record<string, unknown>) => void): GraphQLContext {
    const resolvers = new Map([
      [
        resolverKey('content--blog_post', 'summary'),
        programmaticField(
          { schema: 'content--blog_post', field: 'summary' },
          (ctx) => `S:${ctx.get('title')}|${JSON.stringify(ctx.get('hero'))}`
        ),
      ],
    ])
    return {
      resolver: createProgrammaticResolver(resolvers),
      loaders: {
        load: async (_type: string, _field: string, row: Record<string, unknown>) => {
          loaderEffect?.(row)
          return null
        },
      },
      programmaticMemo: new WeakMap(),
    } as unknown as GraphQLContext
  }

  it('hands the resolver a label-keyed record', async () => {
    const resolve = programmaticFieldResolver(
      'content--blog_post',
      'summary',
      [],
      createFieldKeyMap([divergentTextField])
    )
    const parent = { id: 'c1', blog_title: 'Hello' }

    expect(await resolve(parent, undefined, contextWith())).toBe('S:Hello|undefined')
    // The real row is untouched — scalar resolvers still read it by column.
    expect(parent).toEqual({ id: 'c1', blog_title: 'Hello' })
  })

  it('maps to labels only after the media loaders have resolved', async () => {
    const resolve = programmaticFieldResolver(
      'content--blog_post',
      'summary',
      ['hero'],
      createFieldKeyMap([divergentTextField, divergentMediaField])
    )
    // Stand in for the media dataloader: it writes the resolved object onto the
    // LABEL and drops the raw FK column, exactly as resolveRelationField does.
    const ctx = contextWith((row) => {
      row['hero'] = { id: 'm1' }
      delete row['blog_hero_image']
    })
    const parent = { id: 'c1', blog_title: 'Hello', blog_hero_image: 'm1' }

    expect(await resolve(parent, undefined, ctx)).toBe('S:Hello|{"id":"m1"}')
    expect(parent).toEqual({ id: 'c1', blog_title: 'Hello', blog_hero_image: 'm1' })
  })

  it('leaves the record unmapped when no field key map is supplied', async () => {
    const resolve = programmaticFieldResolver('content--blog_post', 'summary')
    const parent = { id: 'c1', blog_title: 'Hello' }

    expect(await resolve(parent, undefined, contextWith())).toBe('S:undefined|undefined')
  })
})

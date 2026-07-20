import { describe, it, expect, vi } from 'vitest'
import { createRelationLoaders } from '../dataloaders'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import * as relations from '../../relations'

// A registry with one content type "post" holding a reference field "author".
const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type',
      name: 'content--post',
      fields: [
        {
          name: 'author',
          field_type: 'reference',
          db_column: {
            column_name: 'author_id',
            foreign_key: { table: 'content--author', column: 'id', on_delete: 'SET NULL' },
          },
        },
      ],
    },
  },
  taxonomy_types: {},
  paragraph_types: {},
} as unknown as SchemaRegistry

describe('createRelationLoaders', () => {
  it('batches sibling parents into one resolveRelationField call', async () => {
    const spy = vi
      .spyOn(relations, 'resolveRelationField')
      .mockImplementation(async (_db, rows, fieldName) => {
        for (const r of rows as Record<string, unknown>[]) r[fieldName] = { id: r['author_id'] }
      })

    const db = {} as never
    const loaders = createRelationLoaders(db, registry)
    const p1 = { id: '1', author_id: 'a1' }
    const p2 = { id: '2', author_id: 'a2' }

    const [r1, r2] = await Promise.all([
      loaders.load('content--post', 'author', p1),
      loaders.load('content--post', 'author', p2),
    ])

    expect(r1).toEqual({ id: 'a1' })
    expect(r2).toEqual({ id: 'a2' })
    // Both loads batched → resolveRelationField called exactly once with both rows.
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.calls[0]![1] as unknown[]).length).toBe(2)
    spy.mockRestore()
  })
})

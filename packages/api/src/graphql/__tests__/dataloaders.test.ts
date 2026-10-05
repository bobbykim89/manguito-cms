import { describe, it, expect, vi } from 'vitest'
import { createRelationLoaders } from '../dataloaders'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import * as relations from '../../relations'
import { divergentMediaField } from '../../field-keys.test-fixtures'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

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

// A registry with one paragraph type "paragraph--photo-card" holding an image
// (media) field, embedded via a content type's paragraph field — mirrors the
// wiring in schema.ts where relation resolvers are attached to paragraph
// object types' image/video/file/reference sub-fields.
const registryWithParagraph = {
  content_types: {},
  taxonomy_types: {},
  paragraph_types: {
    'paragraph--photo-card': {
      schema_type: 'paragraph-type',
      name: 'paragraph--photo-card',
      fields: [
        {
          name: 'image',
          field_type: 'image',
          db_column: { column_name: 'image_id' },
        },
      ],
    },
  },
} as unknown as SchemaRegistry

describe('createRelationLoaders', () => {
  it('batches sibling parents into one resolveRelationField call', async () => {
    const spy = vi
      .spyOn(relations, 'resolveRelationField')
      .mockImplementation(async (_db, rows) => {
        // Resolved IN PLACE under the storage column, as the real resolver now
        // does — the loader reads the relation back from `author_id`, not `author`.
        for (const r of rows as Record<string, unknown>[]) r['author_id'] = { id: r['author_id'] }
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

  it('resolves relation fields embedded in paragraph types (not just content/taxonomy)', async () => {
    const spy = vi
      .spyOn(relations, 'resolveRelationField')
      .mockImplementation(async (_db, rows) => {
        // Resolved IN PLACE under the storage column — the loader reads the
        // relation back from `image_id`, not `image`.
        for (const r of rows as Record<string, unknown>[]) r['image_id'] = { id: r['image_id'] }
      })

    const db = {} as never
    const loaders = createRelationLoaders(db, registryWithParagraph)
    const row = { id: 'p1', image_id: 'm1' }

    const result = await loaders.load('paragraph--photo-card', 'image', row)

    expect(result).toEqual({ id: 'm1' })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('createRelationLoaders — column-backed relations', () => {
  it('returns a media relation from its storage column, not the field name', async () => {
    // divergentMediaField is `hero` over `blog_hero_image`, so name and column
    // differ and the test cannot pass under the wrong one.
    // MUTATION: restore `return rows.map((r) => r[fieldName])` in the loader.
    // resolveRelationField now writes `blog_hero_image`, so reading `hero`
    // returns undefined.
    const registry = {
      content_types: {
        'content--post': {
          schema_type: 'content-type',
          name: 'content--post',
          fields: [divergentMediaField],
          db: { table_name: 'post' },
        },
      },
      taxonomy_types: {},
      paragraph_types: {},
      enum_types: {},
    } as unknown as SchemaRegistry
    const db = {
      execute: async () => ({ rows: [{ id: 'm1', url: '/a.png' }] }),
    } as unknown as DrizzlePostgresInstance

    const loaders = createRelationLoaders(db, registry)
    const parent = { id: 'p1', blog_hero_image: 'm1' }

    expect(await loaders.load('content--post', 'hero', parent)).toEqual({ id: 'm1', url: '/a.png' })
  })
})

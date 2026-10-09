import { describe, it, expect } from 'vitest'
import { parseSchema } from '../../parser/parseSchema'
import type { ParsedSchema } from '../../parser/parseSchema'
import { buildSchemaRegistry } from '../../parser/validate'
import { findSchemaDeprecations } from '../deprecations'

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type' | 'paragraph-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function registryWith(withDeprecated: boolean) {
  const rel = withDeprecated ? 'one-to-many' : 'one-to-one'
  return buildSchemaRegistry(
    [
      parseOrThrow(
        {
          name: 'content--post',
          label: 'Post',
          type: 'content-type',
          default_base_path: 'posts',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'main',
                label: 'Main',
                fields: [
                  { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--tag', rel, required: false },
                  { name: 'author', label: 'Author', type: 'reference', target: 'taxonomy--tag', rel: 'one-to-one', required: false },
                  { name: 'tags', label: 'Tags', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false },
                ],
              },
            },
          ],
        },
        'content-type',
        'schemas/content-types/content--post.json'
      ),
      parseOrThrow(
        {
          name: 'taxonomy--tag',
          label: 'Tag',
          type: 'taxonomy-type',
          fields: [{ name: 'parent', label: 'Parent', type: 'reference', target: 'taxonomy--tag', rel, required: false }],
        },
        'taxonomy-type',
        'schemas/taxonomy-types/taxonomy--tag.json'
      ),
      parseOrThrow(
        {
          name: 'paragraph--card',
          label: 'Card',
          type: 'paragraph-type',
          fields: [{ name: 'target', label: 'Target', type: 'reference', target: 'content--post', rel, required: false }],
        },
        'paragraph-type',
        'schemas/paragraph-types/paragraph--card.json'
      ),
    ],
    { base_paths: [] },
    { roles: [], valid_permissions: [] }
  )
}

describe('findSchemaDeprecations', () => {
  it('lists every one-to-many reference across content, taxonomy and paragraph types', () => {
    // MUTATION: scan registry.content_types only. The taxonomy and paragraph
    // entries disappear.
    const found = findSchemaDeprecations(registryWith(true))
      .map((d) => `${d.type_name}.${d.field_name}`)
      .sort()
    expect(found).toEqual(['content--post.category', 'paragraph--card.target', 'taxonomy--tag.parent'])
  })

  it('names the source file and says what to use instead', () => {
    // MUTATION: omit source_file, or reword the message. The CLI prints both.
    const d = findSchemaDeprecations(registryWith(true)).find((x) => x.field_name === 'category')!
    expect(d.source_file).toBe('schemas/content-types/content--post.json')
    expect(d.message).toBe(
      'content--post.category uses "one-to-many", which is deprecated for references. It holds a single item, the same as "one-to-one". Use "one-to-one" for a single item, or "many-to-many" for a list.'
    )
  })

  it('flags nothing when no reference uses one-to-many', () => {
    // MUTATION: flag `rel !== 'one-to-one'`. The many-to-many field is flagged.
    expect(findSchemaDeprecations(registryWith(false))).toEqual([])
  })
})

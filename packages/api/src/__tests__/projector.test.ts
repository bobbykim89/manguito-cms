import { describe, it, expect } from 'vitest'
import { isPlainRow, projectRow, buildProjectors, type Projectors } from '../projector'
import { createFieldKeyMap } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  divergentParagraphType,
  paragraphField,
} from '../field-keys.test-fixtures'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

// 'post' has a divergent text field plus a media field, and three relation
// fields whose targets are 'card' (paragraph) and 'category' (reference).
const PROJECTORS: Projectors = {
  post: {
    map: createFieldKeyMap([divergentTextField, divergentMediaField]),
    nested: [
      { label: 'cards', target: 'card' },
      { label: 'category', target: 'category' },
      { label: 'tags', target: 'category' },
    ],
  },
  card: { map: createFieldKeyMap([divergentTextField]), nested: [] },
  category: { map: createFieldKeyMap([divergentTextField]), nested: [] },
}

describe('isPlainRow', () => {
  it('accepts a plain object', () => {
    expect(isPlainRow({ a: 1 })).toBe(true)
  })

  it('rejects null, arrays and strings', () => {
    expect(isPlainRow(null)).toBe(false)
    expect(isPlainRow([{ a: 1 }])).toBe(false)
    expect(isPlainRow('uuid-1')).toBe(false)
  })

  it('rejects a Date — timestamps are values, not rows', () => {
    expect(isPlainRow(new Date())).toBe(false)
  })
})

describe('projectRow', () => {
  it('maps the top level', () => {
    const out = projectRow({ id: 'p1', blog_title: 'Hi' }, 'post', PROJECTORS)
    expect(out).toEqual({ id: 'p1', title: 'Hi' })
  })

  it('maps paragraph children to the paragraph type labels', () => {
    const out = projectRow(
      { id: 'p1', blog_title: 'Hi', cards: [{ id: 'c1', blog_title: 'One' }] },
      'post',
      PROJECTORS
    )
    expect(out['cards']).toEqual([{ id: 'c1', title: 'One' }])
  })

  it('maps a resolved reference target to the target type labels', () => {
    const out = projectRow(
      { id: 'p1', category: { id: 'k1', blog_title: 'News' } },
      'post',
      PROJECTORS
    )
    expect(out['category']).toEqual({ id: 'k1', title: 'News' })
  })

  it('maps a junction target array element-wise', () => {
    const out = projectRow(
      { id: 'p1', tags: [{ id: 't1', blog_title: 'A' }, { id: 't2', blog_title: 'B' }] },
      'post',
      PROJECTORS
    )
    expect(out['tags']).toEqual([{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }])
  })

  it('leaves a bare id string alone (not ?include=d)', () => {
    const out = projectRow({ id: 'p1', category: 'k1' }, 'post', PROJECTORS)
    expect(out['category']).toBe('k1')
  })

  it('leaves a bare id array alone', () => {
    const out = projectRow({ id: 'p1', tags: ['t1', 't2'] }, 'post', PROJECTORS)
    expect(out['tags']).toEqual(['t1', 't2'])
  })

  it('leaves a resolved media object untouched — media is not in nested', () => {
    const media = { id: 'm1', url: '/uploads/a.png', file_name: 'a.png' }
    const out = projectRow({ id: 'p1', blog_hero_image: media }, 'post', PROJECTORS)
    expect(out['hero']).toEqual(media)
  })

  it('skips null and absent nested values', () => {
    const out = projectRow({ id: 'p1', category: null }, 'post', PROJECTORS)
    expect(out['category']).toBeNull()
    expect(out).not.toHaveProperty('tags')
  })

  it('passes a row through unchanged for an unknown type', () => {
    const row = { id: 'p1', blog_title: 'Hi' }
    expect(projectRow(row, 'nope', PROJECTORS)).toBe(row)
  })

  it('passes a nested value through when its target has no projector', () => {
    const projectors: Projectors = {
      post: { map: createFieldKeyMap([divergentTextField]), nested: [{ label: 'x', target: 'missing' }] },
    }
    const nested = { blog_title: 'raw' }
    const out = projectRow({ id: 'p1', x: nested }, 'post', projectors)
    expect(out['x']).toBe(nested)
  })

  // The property the whole design leans on.
  it('projects a shared nested object independently per parent, without mutating it', () => {
    const shared = { id: 'k1', blog_title: 'News' }
    const a = projectRow({ id: 'p1', category: shared }, 'post', PROJECTORS)
    const b = projectRow({ id: 'p2', category: shared }, 'post', PROJECTORS)

    expect(a['category']).toEqual({ id: 'k1', title: 'News' })
    expect(b['category']).toEqual({ id: 'k1', title: 'News' })
    expect(a['category']).not.toBe(b['category'])
    // The source survives untouched — a second pass would otherwise see 'title'
    // and lose the value.
    expect(shared).toEqual({ id: 'k1', blog_title: 'News' })
  })

  it('does not mutate the top-level source row', () => {
    const row = { id: 'p1', blog_title: 'Hi' }
    projectRow(row, 'post', PROJECTORS)
    expect(row).toEqual({ id: 'p1', blog_title: 'Hi' })
  })
})

describe('buildProjectors', () => {
  // A content type with one paragraph field pointing at 'paragraph--card'.
  const contentType = {
    fields: [divergentTextField, divergentMediaField, { ...paragraphField, ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' } }],
  }
  const registry = {
    content_types: { 'content--post': contentType },
    taxonomy_types: {},
    paragraph_types: { 'paragraph--card': divergentParagraphType },
  } as unknown as SchemaRegistry
  const maps = {
    'content--post': createFieldKeyMap(contentType.fields as never),
    'paragraph--card': createFieldKeyMap(divergentParagraphType.fields),
  }

  it('covers paragraph types, not just content and taxonomy', () => {
    expect(Object.keys(buildProjectors(registry, maps)).sort()).toEqual([
      'content--post',
      'paragraph--card',
    ])
  })

  it('lists the paragraph field as nested, targeting its ref', () => {
    expect(buildProjectors(registry, maps)['content--post']!.nested).toEqual([
      { label: 'cards', target: 'paragraph--card' },
    ])
  })

  it('excludes media fields from nested', () => {
    const labels = buildProjectors(registry, maps)['content--post']!.nested.map((n) => n.label)
    expect(labels).not.toContain('hero')
  })
})

describe('projectRow — fallbacks', () => {
  // Mirrors this file's existing PROJECTORS literal. `divergentTextField`
  // exposes the label 'title' on column 'blog_title', so the fallback is keyed
  // by LABEL — substitution happens after toLabels has run.
  const WITH_FALLBACK: Projectors = {
    post: {
      map: createFieldKeyMap([divergentTextField]),
      nested: [],
      fallbacks: { title: 'no title' },
    },
  }

  it('substitutes the fallback when the retained column is null', () => {
    // A retained column reads null for every row written since the tombstone.
    // Left as null it would tell an older live version's consumer "no value"
    // rather than serving the coherent shape the fallback exists to provide.
    const out = projectRow({ id: 'p1', blog_title: null }, 'post', WITH_FALLBACK)
    expect(out).toEqual({ id: 'p1', title: 'no title' })
  })

  it('substitutes when the column is absent from the row entirely', () => {
    const out = projectRow({ id: 'p1' }, 'post', WITH_FALLBACK)
    expect(out['title']).toBe('no title')
  })

  it('does NOT substitute for 0, empty string or false', () => {
    // The trap. All three are legitimate stored values and replacing them
    // would silently destroy real data.
    const zero: Projectors = {
      post: { map: createFieldKeyMap([divergentTextField]), nested: [], fallbacks: { title: 'FB' } },
    }
    expect(projectRow({ blog_title: 0 }, 'post', zero)['title']).toBe(0)
    expect(projectRow({ blog_title: '' }, 'post', zero)['title']).toBe('')
    expect(projectRow({ blog_title: false }, 'post', zero)['title']).toBe(false)
  })

  it('leaves a column with a real value untouched', () => {
    const out = projectRow({ id: 'p1', blog_title: 'Hi' }, 'post', WITH_FALLBACK)
    expect(out['title']).toBe('Hi')
  })

  it('is a no-op when no fallback is declared for the type', () => {
    // The zero-config path: every existing response must be byte-identical.
    const none: Projectors = { post: { map: createFieldKeyMap([divergentTextField]), nested: [] } }
    expect(projectRow({ id: 'p1', blog_title: null }, 'post', none)).toEqual({ id: 'p1', title: null })
  })
})

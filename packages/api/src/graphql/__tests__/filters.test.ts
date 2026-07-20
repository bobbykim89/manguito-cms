import { describe, it, expect } from 'vitest'
import { buildFieldNameMap } from '../naming'
import { SortOrderEnum, buildSortFieldEnum, translateFilters } from '../filters'

describe('sort enums', () => {
  it('SortOrderEnum has ASC/DESC', () => {
    expect(SortOrderEnum.getValues().map((v) => v.name).sort()).toEqual(['ASC', 'DESC'])
  })

  it('sort field enum maps camelCase names to snake_case columns', () => {
    const e = buildSortFieldEnum('BlogPost')
    const created = e.getValue('createdAt')
    expect(created?.value).toBe('created_at')
    expect(e.getValue('title')?.value).toBe('title')
  })
})

describe('translateFilters', () => {
  const nameMap = buildFieldNameMap(['created_at', 'blog_title'])

  it('translates eq / in / operators to repo filters keyed by column', () => {
    const result = translateFilters(
      {
        blogTitle: { eq: 'Hello' },
        createdAt: { gt: '2026-01-01', lte: '2026-12-31' },
        category: { in: ['a', 'b'] },
      },
      nameMap
    )
    expect(result).toEqual({
      blog_title: 'Hello',
      created_at: { gt: '2026-01-01', lte: '2026-12-31' },
      category: ['a', 'b'],
    })
  })

  it('returns an empty object for undefined input', () => {
    expect(translateFilters(undefined, nameMap)).toEqual({})
  })
})

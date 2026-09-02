import { describe, it, expect } from 'vitest'
import { makeContentType, makeRegistry } from './fixtures'

describe('version test fixtures', () => {
  it('builds a registry whose fields carry real db_columns', () => {
    const reg = makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])])
    const field = reg.content_types['content--post']!.fields[0]!
    expect(field.name).toBe('blog_title')
    expect(field.db_column?.column_name).toBe('blog_title')
  })

  it('honours required', () => {
    const reg = makeRegistry([
      makeContentType('content--post', [{ name: 'a', required: true }, { name: 'b' }]),
    ])
    const [a, b] = reg.content_types['content--post']!.fields
    expect(a!.db_column?.nullable).toBe(false)
    expect(b!.db_column?.nullable).toBe(true)
  })
})

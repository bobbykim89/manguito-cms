import { describe, it, expect } from 'vitest'
import { parseFilters } from '../query-params'

// NOTE: parseFilters's first parameter is the request URL (a string parsed
// internally with `new URL(...).searchParams`), not a plain query-param
// record — this differs from the illustrative object literal in the task
// brief, which would not match this function's actual signature. The four
// scenarios below are otherwise the ones the brief specifies.

describe('parseFilters with a label-to-column mapper', () => {
  const validFields = new Set(['title'])
  const columnFor = (label: string) => (label === 'title' ? 'blog_title' : undefined)

  it('validates the label and returns the column', () => {
    const result = parseFilters('http://x/?filter[title]=Hello', validFields, columnFor)
    expect(result).toEqual({ ok: true, filters: { blog_title: 'Hello' } })
  })

  it('maps operator filters too', () => {
    const result = parseFilters('http://x/?filter[title][gt]=5', validFields, columnFor)
    expect(result).toEqual({ ok: true, filters: { blog_title: { gt: '5' } } })
  })

  it('rejects a column name used as a filter key', () => {
    const result = parseFilters('http://x/?filter[blog_title]=Hello', validFields, columnFor)
    expect(result).toEqual({ ok: false, invalidField: 'blog_title' })
  })

  it('behaves as before when no mapper is supplied', () => {
    const result = parseFilters('http://x/?filter[title]=Hello', validFields)
    expect(result).toEqual({ ok: true, filters: { title: 'Hello' } })
  })
})

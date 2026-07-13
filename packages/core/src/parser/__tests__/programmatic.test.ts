import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'

const CONTENT_WITH_PROGRAMMATIC = {
  name: 'content--example',
  label: 'Example',
  type: 'content-type',
  default_base_path: 'example',
  only_one: false,
  fields: [
    {
      tab: {
        name: 'main',
        label: 'Main',
        fields: [
          { name: 'blog_title', label: 'Title', type: 'text/plain', required: true },
          { name: 'blog_summary', label: 'Summary', type: 'programmatic' },
        ],
      },
    },
  ],
}

describe('programmatic field parsing', () => {
  it('parses a programmatic field with no column and a read-only ui component', () => {
    const result = parseSchema(CONTENT_WITH_PROGRAMMATIC, 'content-type', 'example.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const field = result.schema.fields.find((f) => f.name === 'blog_summary')!
    expect(field.field_type).toBe('programmatic')
    expect(field.db_column).toBeNull()
    expect(field.required).toBe(false)
    expect(field.nullable).toBe(true)
    expect(field.ui_component).toEqual({ component: 'computed-display' })
  })

  it('accepts but ignores an explicit required on a programmatic field', () => {
    const raw = structuredClone(CONTENT_WITH_PROGRAMMATIC)
    ;(raw.fields[0]!.tab.fields[1] as Record<string, unknown>)['required'] = true
    const result = parseSchema(raw, 'content-type', 'example.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const field = result.schema.fields.find((f) => f.name === 'blog_summary')!
    expect(field.required).toBe(false)
  })
})

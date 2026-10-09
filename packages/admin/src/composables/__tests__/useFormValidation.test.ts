import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { useFormValidation } from '../useFormValidation'

function makeField(overrides: Partial<ParsedField> = {}): ParsedField {
  return {
    name: 'title',
    label: 'Title',
    field_type: 'text/plain',
    required: true,
    nullable: false,
    order: 0,
    validation: { required: true },
    db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
    ui_component: { component: 'text-input' },
    ...overrides,
  }
}

describe('useFormValidation', () => {
  it('validate(): required field empty → adds error for that field', () => {
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({ name: 'title', label: 'Title', required: true })
    touch('title')
    validate([field], { title: '' })
    expect(errors.value['title']).toBe('Title is required.')
  })

  it('validate(): field with value → no error', () => {
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({ name: 'title', required: true })
    touch('title')
    validate([field], { title: 'Hello world' })
    expect(errors.value['title']).toBeUndefined()
  })

  it('blur behavior: error only shown after touch() is called for that field', () => {
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({ name: 'title', required: true })

    // validate without touching — validation returns false but no visible error
    const invalid = validate([field], { title: '' })
    expect(invalid).toBe(false)
    expect(errors.value['title']).toBeUndefined()

    // touch then validate again — error now appears
    touch('title')
    validate([field], { title: '' })
    expect(errors.value['title']).toBeDefined()
  })

  it('publish mode: all fields validated regardless of touched state', () => {
    const { validate, errors } = useFormValidation()
    const field = makeField({ name: 'title', required: true })

    // validateAll = true (publish mode) — no touch() needed
    const valid = validate([field], { title: '' }, true)
    expect(valid).toBe(false)
    expect(errors.value['title']).toBe('Title is required.')
  })

  it('mergeServerErrors(): PUBLISH_VALIDATION_ERROR details merged into errors state', () => {
    const { mergeServerErrors, errors } = useFormValidation()
    mergeServerErrors([
      { field: 'title', message: 'Title is too long.' },
      { field: 'body', message: 'Body is required.' },
    ])
    expect(errors.value['title']).toBe('Title is too long.')
    expect(errors.value['body']).toBe('Body is required.')
  })

  it('clearErrors(): resets all error state', () => {
    const { validate, touch, clearErrors, errors, touched } = useFormValidation()
    const field = makeField({ name: 'title', required: true })
    touch('title')
    validate([field], { title: '' }, true)
    expect(Object.keys(errors.value).length).toBeGreaterThan(0)

    clearErrors()
    expect(Object.keys(errors.value)).toHaveLength(0)
    expect(touched.value.size).toBe(0)
  })

  it('validate(): required one-to-one paragraph left empty (null) → required error', () => {
    // MUTATION: drop `value === null` from isEmpty. An empty one-to-one
    // paragraph would then pass "required".
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({
      name: 'link', label: 'Link', field_type: 'paragraph', db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel: 'one-to-one' },
    })
    touch('link')
    validate([field], { link: null })
    expect(errors.value['link']).toBe('Link is required.')
  })

  it('validate(): max_items never counts a one-to-one object', () => {
    // MUTATION: treat a non-array value as a one-item list in the max_items
    // check. A filled one-to-one paragraph would then fail max 0.
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({
      name: 'link', label: 'Link', field_type: 'paragraph', required: false, db_column: null,
      validation: { required: false, max_items: 0 },
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel: 'one-to-one' },
    })
    touch('link')
    validate([field], { link: { url: 'a' } })
    expect(errors.value['link']).toBeUndefined()
  })
})

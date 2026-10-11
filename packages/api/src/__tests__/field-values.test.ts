import { describe, it, expect } from 'vitest'
import { buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import { checkFieldValues, emptyValuesToNull } from '../field-values'
import { parseOrThrow } from './relation-cardinality.fixture'

// One content type with a field of every stored scalar type, and a paragraph
// list whose items have their own fields.
const registry = buildSchemaRegistry(
  [
    parseOrThrow(
      {
        name: 'paragraph--fv_block',
        label: 'Block',
        type: 'paragraph-type',
        fields: [
          { name: 'caption', label: 'Caption', type: 'text/plain', limit: 5, required: false },
          { name: 'shown_on', label: 'Shown on', type: 'date', required: false },
        ],
      },
      'paragraph-type'
    ),
    parseOrThrow(
      {
        name: 'content--fv_item',
        label: 'Item',
        type: 'content-type',
        default_base_path: 'items',
        only_one: false,
        fields: [
          {
            tab: {
              name: 'main',
              label: 'Main',
              fields: [
                { name: 'code', label: 'Code', type: 'text/plain', limit: 10, pattern: '^[a-z]+$', required: false },
                { name: 'title', label: 'Title', type: 'text/plain', required: true },
                { name: 'notes', label: 'Notes', type: 'text/rich', required: false },
                { name: 'qty', label: 'Qty', type: 'integer', min: 1, max: 5, required: false },
                { name: 'price', label: 'Price', type: 'float', required: false },
                { name: 'active', label: 'Active', type: 'boolean', required: false },
                { name: 'on_sale', label: 'On sale', type: 'date', required: false },
                { name: 'size', label: 'Size', type: 'enum', values: ['s', 'm', 'l'], required: false },
                { name: 'blocks', label: 'Blocks', type: 'paragraph', ref: 'paragraph--fv_block', rel: 'one-to-many', max: 2, required: false },
              ],
            },
          },
        ],
      },
      'content-type'
    ),
  ],
  { base_paths: [] },
  { roles: [], valid_permissions: [] }
)
const fields = registry.content_types['content--fv_item']!.fields
const check = (body: Record<string, unknown>) => checkFieldValues(fields, body, registry)
const fieldsWithErrors = (body: Record<string, unknown>) => check(body).map((e) => e.field)

describe('checkFieldValues', () => {
  it('accepts a valid value of every type, and leaves absent fields alone', () => {
    // MUTATION: check every field, present or not. A PATCH naming one field
    // would then fail on all the required ones it leaves out.
    expect(
      check({
        code: 'abc', title: 'T', notes: '<p>x</p>', qty: 3, price: 9.99, active: false,
        on_sale: '2026-10-11T09:30:00.000Z', size: 'm', blocks: [{ caption: 'hi', shown_on: '2026-10-11' }],
      })
    ).toEqual([])
    expect(check({})).toEqual([])
  })

  it('refuses a value whose type its column cannot store', () => {
    // MUTATION: drop a type check. Postgres then refuses the value part-way
    // through the write, after a paragraph field's old rows are deleted.
    expect(check({ code: 123, qty: '3', price: '9.99', active: 'yes', on_sale: 'tomorrow', notes: 1 })).toEqual([
      { field: 'code', message: 'code must be text.' },
      { field: 'notes', message: 'notes must be text.' },
      { field: 'qty', message: 'qty must be a whole number.' },
      { field: 'price', message: 'price must be a number.' },
      { field: 'active', message: 'active must be true or false.' },
      { field: 'on_sale', message: 'on_sale must be a date, such as 2026-10-11 or 2026-10-11T09:30:00Z.' },
    ])
  })

  it('refuses numbers and dates the column cannot hold', () => {
    // MUTATION: drop the integer range, the decimal(10, 4) limit or the
    // Date.parse check. Postgres refuses each (22003, 22008).
    expect(fieldsWithErrors({ qty: 1.5 })).toEqual(['qty'])
    expect(check({ qty: 3_000_000_000 })[0]!.message).toBe('qty is too large.')
    expect(check({ price: 1_000_000 })[0]!.message).toBe('price must be less than 1000000 in size.')
    expect(fieldsWithErrors({ price: 999_999.9999 })).toEqual([])
    expect(fieldsWithErrors({ on_sale: '2026-13-45' })).toEqual(['on_sale'])
  })

  it('counts text length in characters, as Postgres does', () => {
    // MUTATION: compare value.length (UTF-16 units). Ten emoji then read as 20
    // and are refused although the varchar(10) column holds them.
    expect(fieldsWithErrors({ title: '😀'.repeat(255) })).toEqual([])
    expect(check({ title: 'x'.repeat(256) })).toEqual([
      { field: 'title', message: 'title can be at most 255 characters.' },
    ])
    expect(check({ code: 'abcdefghijk' })[0]!.message).toBe('code can be at most 10 characters.')
  })

  it('enforces the declared rules: pattern, min and max, allowed values, max items', () => {
    // MUTATION: skip the declared rules (check only what Postgres refuses). An
    // API client could then store values the schema declares invalid.
    expect(check({ code: 'ABC' })[0]!.message).toBe('code is not in the correct format.')
    expect(check({ qty: 0 })[0]!.message).toBe('qty must be at least 1.')
    expect(check({ qty: 6 })[0]!.message).toBe('qty must be at most 5.')
    expect(check({ size: 'xl' })[0]!.message).toBe('size must be one of: s, m, l.')
    expect(check({ blocks: [{}, {}, {}] })[0]).toEqual({ field: 'blocks', message: 'blocks can hold at most 2 items.' })
  })

  it('refuses null for a NOT NULL column, naming a required field as required', () => {
    // MUTATION: let null through. A PATCH that clears a required field, or an
    // optional boolean (NOT NULL, default false), then fails in Postgres.
    expect(check({ title: null, active: null, code: null })).toEqual([
      { field: 'title', message: 'title is required.' },
      { field: 'active', message: 'active cannot be empty.' },
    ])
  })

  it('checks paragraph items, naming each by its path', () => {
    // MUTATION: check top-level fields only. A bad value inside an item then
    // fails in Postgres after the field's old paragraph rows are deleted.
    expect(check({ blocks: [{ caption: 'ok' }, { caption: 'too long', shown_on: 'soon' }] })).toEqual([
      { field: 'blocks[1].caption', message: 'blocks[1].caption can be at most 5 characters.' },
      { field: 'blocks[1].shown_on', message: 'blocks[1].shown_on must be a date, such as 2026-10-11 or 2026-10-11T09:30:00Z.' },
    ])
  })
})

describe('emptyValuesToNull', () => {
  it('turns "" into null for date, number and enum fields, in items too, and leaves text alone', () => {
    // MUTATION: leave '' as sent. A cleared date in the admin form ('') then
    // fails the date check, where it used to fail in Postgres with a 500.
    const body = { on_sale: '', qty: '', price: '', size: '', code: '', blocks: [{ caption: '', shown_on: '' }] }
    expect(emptyValuesToNull(fields, body, registry)).toEqual({
      on_sale: null, qty: null, price: null, size: null, code: '', blocks: [{ caption: '', shown_on: null }],
    })
    expect(body.on_sale).toBe('') // the input is not changed
  })
})

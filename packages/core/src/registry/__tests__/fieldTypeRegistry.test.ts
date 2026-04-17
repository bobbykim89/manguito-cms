import { describe, it, expect } from 'vitest'
import { fieldTypeRegistry } from '../fieldTypeRegistry'
import type { FieldType } from '../types'

// ─── Coverage: every registered field type ───────────────────────────────────

const ALL_FIELD_TYPES: FieldType[] = [
  'text/plain', 'text/rich', 'integer', 'float', 'boolean', 'date',
  'image', 'video', 'file', 'enum', 'paragraph', 'reference',
]

describe('fieldTypeRegistry — completeness', () => {
  it('has an entry for every supported field type', () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(fieldTypeRegistry[type], `missing entry for "${type}"`).toBeDefined()
    }
  })

  it('every entry has a ui_component', () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(fieldTypeRegistry[type]?.ui_component, `missing ui_component for "${type}"`).toBeDefined()
    }
  })

  it('every entry has a validation_defaults object', () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(
        typeof fieldTypeRegistry[type]?.validation_defaults,
        `validation_defaults is not an object for "${type}"`
      ).toBe('object')
    }
  })
})

// ─── Primitive types ──────────────────────────────────────────────────────────

describe('fieldTypeRegistry — primitives', () => {
  it('text/plain — varchar, text-input', () => {
    const entry = fieldTypeRegistry['text/plain']
    expect(entry.db_column?.column_type).toBe('varchar')
    expect(entry.ui_component.component).toBe('text-input')
  })

  it('text/rich — text, rich-text-editor', () => {
    const entry = fieldTypeRegistry['text/rich']
    expect(entry.db_column?.column_type).toBe('text')
    expect(entry.ui_component.component).toBe('rich-text-editor')
  })

  it('integer — integer, number-input step 1', () => {
    const entry = fieldTypeRegistry['integer']
    expect(entry.db_column?.column_type).toBe('integer')
    const ui = entry.ui_component as { component: string; step: number }
    expect(ui.component).toBe('number-input')
    expect(ui.step).toBe(1)
  })

  it('float — decimal, number-input step 0.01', () => {
    const entry = fieldTypeRegistry['float']
    expect(entry.db_column?.column_type).toBe('decimal')
    const ui = entry.ui_component as { component: string; step: number }
    expect(ui.step).toBe(0.01)
  })

  it('boolean — boolean, NOT NULL (nullable: false), checkbox', () => {
    const entry = fieldTypeRegistry['boolean']
    expect(entry.db_column?.column_type).toBe('boolean')
    expect(entry.db_column?.nullable).toBe(false)
    expect(entry.ui_component.component).toBe('checkbox')
  })

  it('date — timestamp, date-picker', () => {
    const entry = fieldTypeRegistry['date']
    expect(entry.db_column?.column_type).toBe('timestamp')
    expect(entry.ui_component.component).toBe('date-picker')
  })
})

// ─── Media types ──────────────────────────────────────────────────────────────

describe('fieldTypeRegistry — media', () => {
  it('image — uuid FK to media, file-upload with image/* mime type', () => {
    const entry = fieldTypeRegistry['image']
    expect(entry.db_column?.column_type).toBe('uuid')
    expect(entry.db_column?.foreign_key?.table).toBe('media')
    expect(entry.db_column?.foreign_key?.on_delete).toBe('SET NULL')
    const ui = entry.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.component).toBe('file-upload')
    expect(ui.accepted_mime_types).toEqual(['image/*'])
  })

  it('video — uuid FK to media, file-upload with video/* mime type', () => {
    const entry = fieldTypeRegistry['video']
    expect(entry.db_column?.foreign_key?.table).toBe('media')
    const ui = entry.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.accepted_mime_types).toEqual(['video/*'])
  })

  it('file — uuid FK to media, file-upload with application/pdf mime type', () => {
    const entry = fieldTypeRegistry['file']
    expect(entry.db_column?.foreign_key?.table).toBe('media')
    const ui = entry.ui_component as { component: string; accepted_mime_types: string[] }
    expect(ui.accepted_mime_types).toEqual(['application/pdf'])
  })

  it('all media types share the same foreign_key column reference', () => {
    for (const type of ['image', 'video', 'file'] as const) {
      const fk = fieldTypeRegistry[type].db_column?.foreign_key
      expect(fk?.column).toBe('id')
      expect(fk?.on_delete).toBe('SET NULL')
    }
  })
})

// ─── Enum type ────────────────────────────────────────────────────────────────

describe('fieldTypeRegistry — enum', () => {
  it('enum — varchar, check_constraint is empty array (parser fills it in)', () => {
    const entry = fieldTypeRegistry['enum']
    expect(entry.db_column?.column_type).toBe('varchar')
    expect(entry.db_column?.check_constraint).toEqual([])
  })

  it('enum ui_component is select with empty options array (parser fills it in)', () => {
    const ui = fieldTypeRegistry['enum'].ui_component as { component: string; options: string[] }
    expect(ui.component).toBe('select')
    expect(ui.options).toEqual([])
  })
})

// ─── Paragraph type ───────────────────────────────────────────────────────────

describe('fieldTypeRegistry — paragraph', () => {
  it('paragraph — db_column is null', () => {
    expect(fieldTypeRegistry['paragraph'].db_column).toBeNull()
  })

  it('paragraph — ui_component is paragraph-embed', () => {
    expect(fieldTypeRegistry['paragraph'].ui_component.component).toBe('paragraph-embed')
  })
})

// ─── Reference type ───────────────────────────────────────────────────────────

describe('fieldTypeRegistry — reference', () => {
  it('reference — db_column is uuid FK template', () => {
    const entry = fieldTypeRegistry['reference']
    expect(entry.db_column?.column_type).toBe('uuid')
    expect(entry.db_column?.foreign_key?.column).toBe('id')
    expect(entry.db_column?.foreign_key?.on_delete).toBe('SET NULL')
    // table is empty — parser fills from target machine name
    expect(entry.db_column?.foreign_key?.table).toBe('')
  })

  it('reference — ui_component is typeahead-select', () => {
    expect(fieldTypeRegistry['reference'].ui_component.component).toBe('typeahead-select')
  })
})

// ─── Registry is serializable ─────────────────────────────────────────────────

describe('fieldTypeRegistry — serializability', () => {
  it('can be JSON serialized without loss', () => {
    const serialized = JSON.stringify(fieldTypeRegistry)
    const deserialized = JSON.parse(serialized)
    // Check a few spot values survive the round trip
    expect(deserialized['text/plain'].db_column.column_type).toBe('varchar')
    expect(deserialized['paragraph'].db_column).toBeNull()
    expect(deserialized['integer'].ui_component.step).toBe(1)
  })
})

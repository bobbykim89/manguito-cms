import type { Hono } from 'hono'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerSchemaRoute(app: Hono, registry: SchemaRegistry): void {
  app.get('/admin/api/schema', (c) => {
    const content_types = Object.values(registry.content_types).map((ct) => ({
      name: ct.name,
      label: ct.label,
      only_one: ct.only_one,
      fields: ct.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.field_type,
        required: f.required,
      })),
    }))

    const taxonomy_types = Object.values(registry.taxonomy_types).map((tt) => ({
      name: tt.name,
      label: tt.label,
      fields: tt.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.field_type,
        required: f.required,
      })),
    }))

    const paragraph_types = Object.values(registry.paragraph_types).map((pt) => ({
      name: pt.name,
      label: pt.label,
      fields: pt.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.field_type,
        required: f.required,
      })),
    }))

    const enum_types = Object.values(registry.enum_types).map((et) => ({
      name: et.name,
      label: et.label,
      values: et.values,
    }))

    return c.json({
      ok: true,
      data: { content_types, taxonomy_types, paragraph_types, enum_types },
    })
  })
}

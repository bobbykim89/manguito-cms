import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerSchemaRoute(
  app: Hono,
  registry: SchemaRegistry,
  db: DrizzlePostgresInstance,
): void {
  // Full schema — used by dynamic renderer in dev mode
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

  // Navigation meta-endpoints — list types with item counts for admin sidebar
  app.get('/admin/api/content', async (c) => {
    const data = await Promise.all(
      Object.values(registry.content_types).map(async (ct) => {
        const result = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(`"${ct.db.table_name}"`)}`
        )
        const count = Number((result.rows[0] as { count: string | number }).count)
        return { name: ct.name, label: ct.label, only_one: ct.only_one, count }
      })
    )
    return c.json({ ok: true, data })
  })

  app.get('/admin/api/taxonomy', async (c) => {
    const data = await Promise.all(
      Object.values(registry.taxonomy_types).map(async (tt) => {
        const result = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(`"${tt.db.table_name}"`)}`
        )
        const count = Number((result.rows[0] as { count: string | number }).count)
        return { name: tt.name, label: tt.label, count }
      })
    )
    return c.json({ ok: true, data })
  })
}

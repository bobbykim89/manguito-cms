# Decision — Drizzle Codegen

> Defines how `generateSchemaFile` translates a `SchemaRegistry` into a valid Drizzle schema TypeScript string. Covers field mapping, table ordering, junction tables, and paragraph topological sorting.

---

## Core Design: Pure Function

`generateSchemaFile` is a pure function. It takes a `SchemaRegistry` and returns a TypeScript string. It has no side effects — no filesystem access, no DB connection.

```ts
export function generateSchemaFile(registry: SchemaRegistry): string
```

**Why pure:** The same codegen logic runs in two different contexts — dev mode (writing to `.manguito/`) and production build (writing to `dist/generated/`). The CLI decides the output path. Keeping codegen pure means it is fully unit-testable without any filesystem mocking or temp directory setup.

---

## Import Strategy

All generated files use namespace import. This avoids tracking which column types are actually used across all schemas:

```ts
import * as s from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
```

All column builders are referenced as `s.uuid(...)`, `s.varchar(...)`, etc. `sql` is needed for check constraints and default expressions.

---

## Table Ordering

Table definitions must appear before anything that references them (for TypeScript type inference — Drizzle's `() =>` callbacks handle runtime ordering but TypeScript still needs the types to be defined first for the type checker).

```
1. System tables     — media, base_paths, roles, users
                       everything else FKs into these
2. Taxonomy types    — reference media only
3. Paragraph types   — topologically sorted (nested paragraph before parent)
4. Content types     — no required ordering between them
5. Junction tables   — always last, reference content tables on both sides
```

### Why content types need no ordering

Cross-content-type `reference` fields produce either:
- A FK column on the source content table (`one-to-one`, `one-to-many`) — uses `() =>` callback
- A junction table (`many-to-many`) — defined in step 5

The `() =>` callback form defers FK evaluation to runtime, so TypeScript sees the types as long as both tables are in the same file. Since all content types are in the same generated file, no ordering is needed between them.

Self-referencing content types (a blog post referencing other blog posts) follow the same rule — the junction table references the same table twice and is defined last.

---

## Paragraph Topological Sort

Paragraphs can nest one level deep (a paragraph field inside a paragraph type). The nested paragraph's table must be defined before the parent paragraph's table for TypeScript type inference.

The Phase 2 parser guarantees no circular paragraph references (`CIRCULAR_REFERENCE` error), so this sort always terminates.

```ts
function orderParagraphTypes(
  paragraphs: Record<string, ParsedParagraphType>
): ParsedParagraphType[] {
  const sorted: ParsedParagraphType[] = []
  const visited = new Set<string>()

  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    const paragraph = paragraphs[name]
    for (const field of paragraph.fields) {
      // paragraph fields that embed another paragraph create a table dependency
      if (
        field.field_type === 'paragraph' &&
        field.db_column.foreign_key?.table.startsWith('paragraph_')
      ) {
        visit(field.db_column.foreign_key.table)
      }
    }
    sorted.push(paragraph)
  }

  for (const name of Object.keys(paragraphs)) visit(name)
  return sorted
}
```

---

## System Field → Drizzle Column

System fields are auto-injected by the parser and have a limited set of `db_type` values:

| `db_type` | Drizzle builder | Notes |
|-----------|----------------|-------|
| `uuid` | `s.uuid()` | PK gets `.primaryKey().defaultRandom()` |
| `varchar` | `s.varchar()` | No length — system varchars are unbounded |
| `boolean` | `s.boolean()` | `default: "false"` → `.default(false)` |
| `timestamp` | `s.timestamp()` | `default: "now()"` → `.defaultNow()` |
| `integer` | `s.integer()` | `default: "0"` → `.default(0)` |

All non-nullable, non-PK system fields get `.notNull()`.

---

## ParsedField → Drizzle Column

Fields that produce no column on the current table return `null` and are skipped:

| Condition | Result |
|-----------|--------|
| `field_type === 'paragraph'` | `null` — column is on the paragraph table via `parent_id` |
| `db_column.junction` is set | `null` — many-to-many, handled by junction table |
| All others | Drizzle column string |

Column type mapping:

| `DbColumnType` | Drizzle builder | Notes |
|----------------|----------------|-------|
| `varchar` | `s.varchar('name', { length: N })` | `N` from `validation.limit ?? 255`. Enum fields use `s.varchar('name')` (no length — check constraint used instead) |
| `text` | `s.text('name')` | Rich text — no length limit |
| `integer` | `s.integer('name')` | |
| `decimal` | `s.decimal('name', { precision: 10, scale: 4 })` | Float fields |
| `boolean` | `s.boolean('name')` | |
| `timestamp` | `s.timestamp('name')` | Date fields |
| `uuid` | `s.uuid('name')` | Media FKs and reference FKs |

**FK references always use `() =>` callback form:**

```ts
// correct — always this form
cover_id: s.uuid('cover_id')
  .references(() => media.id, { onDelete: 'set null' })

// never this form — breaks with forward references
cover_id: s.uuid('cover_id')
  .references(media.id, { onDelete: 'set null' })
```

`on_delete` values from `DbColumn.foreign_key` map to Drizzle's string literals:
- `"CASCADE"` → `'cascade'`
- `"SET NULL"` → `'set null'`
- `"RESTRICT"` → `'restrict'`

**Nullable:** Fields with `db_column.nullable === false` get `.notNull()`.

---

## Enum Check Constraints

Enum fields store their allowed values as a `check_constraint` array on `DbColumn`. Drizzle handles this as a table-level constraint in the third argument of `pgTable()`:

```ts
export const content_blog_post = s.pgTable(
  'content_blog_post',
  {
    // ...columns
    status: s.varchar('status').notNull(),
  },
  (table) => ({
    status_check: s.check(
      'status_check',
      sql`${table.status} IN ('draft', 'review', 'approved')`
    )
  })
)
```

If a schema has no enum fields, the third argument to `pgTable()` is omitted entirely.

---

## System Tables

Hardcoded — not derived from `SchemaRegistry`. Always identical regardless of user schemas.

```ts
export const media = s.pgTable('media', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  url: s.varchar('url', { length: 2048 }).notNull(),
  mime_type: s.varchar('mime_type', { length: 255 }).notNull(),
  alt: s.varchar('alt', { length: 255 }),
  file_size: s.integer('file_size').notNull(),
  width: s.integer('width'),
  height: s.integer('height'),
  duration: s.integer('duration'),
  reference_count: s.integer('reference_count').notNull().default(0),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const base_paths = s.pgTable('base_paths', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  path: s.varchar('path', { length: 1024 }).notNull().unique(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const roles = s.pgTable('roles', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  name: s.varchar('name', { length: 255 }).notNull().unique(),
  label: s.varchar('label', { length: 255 }).notNull(),
  is_system: s.boolean('is_system').notNull().default(false),
  hierarchy_level: s.integer('hierarchy_level').notNull().unique(),
  permissions: s.text('permissions').array().notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

export const users = s.pgTable('users', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  email: s.varchar('email', { length: 255 }).notNull().unique(),
  password_hash: s.varchar('password_hash', { length: 255 }).notNull(),
  role_id: s.uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  token_version: s.integer('token_version').notNull().default(0),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})
```

Note `onDelete: 'restrict'` on `users.role_id` — this is the DB-level enforcement that backs up the seeder's application-level check for users assigned to deleted roles.

---

## Junction Table Generation

Junction tables are generated from `ContentDbMeta.junction_tables`. Each junction table:
- References the left content table (the owner) with `CASCADE` on delete
- References the right content table (the target) with `CASCADE` on delete
- Optionally includes an `order` column for ordered many-to-many relations

```ts
// Example: blog post ↔ blog post (self-referencing many-to-many)
export const junction_content_blog_post_blog_related = s.pgTable(
  'junction_content_blog_post_blog_related',
  {
    left_id: s.uuid('left_id')
      .notNull()
      .references(() => content_blog_post.id, { onDelete: 'cascade' }),
    right_id: s.uuid('right_id')
      .notNull()
      .references(() => content_blog_post.id, { onDelete: 'cascade' }),
    order: s.integer('order').notNull().default(0),
  }
)
```

Self-referencing case (`left_table === right_table`) is handled identically — both columns reference the same table variable. No special case needed.

---

## Generated File Structure

```ts
import * as s from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── System Tables ──────────────────────────────────────────────────────────
export const media = s.pgTable('media', { ... })
export const base_paths = s.pgTable('base_paths', { ... })
export const roles = s.pgTable('roles', { ... })
export const users = s.pgTable('users', { ... })

// ─── Taxonomy Types ──────────────────────────────────────────────────────────
export const taxonomy_daily_post = s.pgTable('taxonomy_daily_post', { ... })

// ─── Paragraph Types ─────────────────────────────────────────────────────────
export const paragraph_link_item = s.pgTable('paragraph_link_item', { ... })
export const paragraph_photo_card = s.pgTable('paragraph_photo_card', { ... })

// ─── Content Types ───────────────────────────────────────────────────────────
export const content_blog_post = s.pgTable('content_blog_post', { ... }, (t) => ({ ... }))

// ─── Junction Tables ─────────────────────────────────────────────────────────
export const junction_content_blog_post_blog_related = s.pgTable(...)
```

Variable names are derived directly from table names (replacing hyphens with underscores if any). The `ContentDbMeta.table_name` / `ParagraphDbMeta.table_name` / `TaxonomyDbMeta.table_name` values from the parser are used as-is for both the SQL table name and the TypeScript variable name.

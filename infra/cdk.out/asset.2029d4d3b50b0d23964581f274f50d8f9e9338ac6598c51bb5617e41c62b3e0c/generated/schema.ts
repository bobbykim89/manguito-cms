import * as s from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── System Tables ──────────────────────────────────────────────────────────
export const media = s.pgTable('media', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  type: s.varchar('type', { length: 50 }).notNull(),
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
  must_change_password: s.boolean('must_change_password').notNull().default(false),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
})

// ─── Taxonomy Types ──────────────────────────────────────────────────────────
export const taxonomy_daily_post = s.pgTable('taxonomy_daily_post', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  published: s.boolean('published').default(false).notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
  daily_title: s.varchar('daily_title', { length: 255 }).notNull(),
  daily_desc: s.text('daily_desc').notNull(),
})

// ─── Paragraph Types ─────────────────────────────────────────────────────────
export const paragraph_link_item = s.pgTable(
  'paragraph_link_item',
  {
    id: s.uuid('id').primaryKey().defaultRandom(),
    parent_id: s.uuid('parent_id').notNull(),
    parent_type: s.varchar('parent_type').notNull(),
    parent_field: s.varchar('parent_field').notNull(),
    order: s.integer('order').default(0).notNull(),
    created_at: s.timestamp('created_at').defaultNow().notNull(),
    updated_at: s.timestamp('updated_at').defaultNow().notNull(),
    link_item_url: s.varchar('link_item_url', { length: 255 }).notNull(),
    link_item_target: s.varchar('link_item_target').notNull(),
    link_item_text: s.varchar('link_item_text', { length: 255 }).notNull(),
  },
  (table) => ({
    link_item_target_check: s.check(
      'link_item_target_check',
      sql`${table.link_item_target} IN ('_self', '_blank')`
    ),
  })
)

export const paragraph_card_image_link = s.pgTable('paragraph_card_image_link', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  parent_id: s.uuid('parent_id').notNull(),
  parent_type: s.varchar('parent_type').notNull(),
  parent_field: s.varchar('parent_field').notNull(),
  order: s.integer('order').default(0).notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
  card_image_link_title: s.varchar('card_image_link_title', { length: 255 }).notNull(),
  card_image_link_image: s.uuid('card_image_link_image').notNull().references(() => media.id, { onDelete: 'set null' }),
  card_image_link_text: s.text('card_image_link_text'),
})

export const paragraph_photo_card = s.pgTable('paragraph_photo_card', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  parent_id: s.uuid('parent_id').notNull(),
  parent_type: s.varchar('parent_type').notNull(),
  parent_field: s.varchar('parent_field').notNull(),
  order: s.integer('order').default(0).notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
  photo_card_title: s.varchar('photo_card_title', { length: 255 }).notNull(),
  photo_card_image: s.uuid('photo_card_image').notNull().references(() => media.id, { onDelete: 'set null' }),
  photo_card_text: s.text('photo_card_text'),
})

// ─── Content Types ───────────────────────────────────────────────────────────
export const content_blog_post = s.pgTable('content_blog_post', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  slug: s.varchar('slug').notNull(),
  base_path_id: s.uuid('base_path_id').notNull(),
  published: s.boolean('published').default(false).notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
  blog_title: s.varchar('blog_title', { length: 255 }).notNull(),
  blog_hero_image: s.uuid('blog_hero_image').references(() => media.id, { onDelete: 'set null' }),
  blog_desc: s.text('blog_desc').notNull(),
  blog_meta_title: s.varchar('blog_meta_title', { length: 255 }).notNull(),
  blog_meta_desc: s.varchar('blog_meta_desc', { length: 255 }).notNull(),
})

export const content_example_page = s.pgTable('content_example_page', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  slug: s.varchar('slug').notNull(),
  base_path_id: s.uuid('base_path_id').notNull(),
  published: s.boolean('published').default(false).notNull(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
  updated_at: s.timestamp('updated_at').defaultNow().notNull(),
  title: s.varchar('title', { length: 255 }).notNull(),
  hero_image: s.uuid('hero_image').references(() => media.id, { onDelete: 'set null' }),
  body: s.text('body'),
})

// ─── Junction Tables ─────────────────────────────────────────────────────────
export const junction_content_blog_post_blog_related = s.pgTable(
  'junction_content_blog_post_blog_related',
  {
    left_id: s.uuid('left_id')
      .notNull()
      .references(() => content_blog_post.id, { onDelete: 'cascade' }),
    right_id: s.uuid('right_id')
      .notNull()
      .references(() => content_blog_post.id, { onDelete: 'cascade' }),
  }
)
import * as s from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── System Tables ──────────────────────────────────────────────────────────
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

// ─── Content Types ───────────────────────────────────────────────────────────
export const content_mig_test = s.pgTable('content_mig_test', {
  id: s.uuid('id').primaryKey().defaultRandom(),
  created_at: s.timestamp('created_at').defaultNow().notNull(),
})
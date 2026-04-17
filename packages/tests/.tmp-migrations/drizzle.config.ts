import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: '/mnt/projects/manguito-cms/packages/tests/.tmp-migrations/schema.ts',
  out: '/mnt/projects/manguito-cms/packages/tests/.tmp-migrations/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env['DB_URL']! },
  migrationsTable: '__manguito_migrations_test',
})
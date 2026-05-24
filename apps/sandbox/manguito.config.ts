import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createLocalAdapter } from '@bobbykim/manguito-cms-api/storage'
import { createServer, createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

export default defineConfig({
  schema: {
    base_path: './schemas',
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
      roles: 'roles',
    },
  },

  // connectDb reads DB_URL from process.env — set it in .env
  db: createPostgresAdapter(),

  migrations: {
    table: '__manguito_migrations',
    folder: './migrations',
  },

  storage: createLocalAdapter(),

  server: createServer({
    cors: { origin: process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:5173' },
  }),

  api: createAPIAdapter({
    prefix: '/api',
    media: { max_file_size: 4 * 1024 * 1024 },
  }),

  admin: createAdminAdapter({ prefix: '/admin' }),
})

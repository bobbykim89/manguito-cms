import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './schema.ts',
  out: '../../migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DB_URL!,
  },
  migrations: {
    table: '__manguito_migrations',
    schema: 'public',
  },
  tablesFilter: ['!__manguito_migrations'],
})
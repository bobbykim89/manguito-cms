import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import {
  createLocalAdapter,
  createS3Adapter,
  createCloudinaryAdapter,
} from '@bobbykim/manguito-cms-api'
import {
  createServer,
  createLambdaHandler,
  createVercelHandler,
} from '@bobbykim/manguito-cms-api'
import { createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
  // all optional — defaults apply if omitted
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

  db: isProd
    ? createPostgresAdapter()
    : createPostgresAdapter({ url: process.env.DEV_DB_URL }),

  // optional — omit entirely if db adapter doesn't support migrations
  migrations: {
    table: '__manguito_migrations',
    folder: './migrations',
  },

  storage: isProd
    ? createS3Adapter({
        bucket: process.env.S3_BUCKET,
        region: process.env.AWS_REGION,
      })
    : createLocalAdapter(),

  server: isProd
    ? createLambdaHandler({
        cors: { origin: process.env.ALLOWED_ORIGIN },
      })
    : createServer({
        port: 3000,
        cors: { origin: 'http://localhost:5173' },
      }),

  api: createAPIAdapter({
    prefix: '/api', // default
    media: {
      max_file_size: 4 * 1024 * 1024, // default: 4MB
    },
  }),

  admin: createAdminAdapter({
    prefix: '/admin', // default
  }),
})

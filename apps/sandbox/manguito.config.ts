import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'
import { createServer, createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

export default defineConfig({
  name: 'Sandbox - Manguito CMS',
  schema: {
    base_path: './schemas',
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
    },
  },

  // connectDb reads DB_URL from process.env — set it in .env
  db: createPostgresAdapter(),

  migrations: {
    table: '__manguito_migrations',
    folder: './migrations',
  },

  // storage: createCloudinaryAdapter({
  //   folder: 'manguito-sandbox',
  // }),
  storage: createS3Adapter({
    bucket: process.env['S3_BUCKET'] ?? '',
    region:
      process.env['S3_REGION'] ?? process.env['AWS_REGION'] ?? 'us-east-1',
    // On AWS (Lambda/Fargate) leave these unset — the execution/task role
    // supplies credentials. On platforms without an AWS role (e.g. Vercel),
    // set S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY to an IAM user's keys. Custom
    // names are used because the Lambda runtime reserves the AWS_ prefix.
    ...(process.env['S3_ACCESS_KEY_ID'] && process.env['S3_SECRET_ACCESS_KEY']
      ? {
          access_key_id: process.env['S3_ACCESS_KEY_ID'],
          secret_access_key: process.env['S3_SECRET_ACCESS_KEY'],
        }
      : {}),
  }),
  // storage: createLocalAdapter(), // for local testing

  server: createServer({
    cors: { origin: process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:5173' },
  }),

  api: createAPIAdapter({
    prefix: '/api',
    media: { max_file_size: 4 * 1024 * 1024 },
    // GraphQL public API (opt-in, query-only). Uncomment to enable POST /graphql.
    //   graphql: { enabled: true },  // maxDepth: 8, maxComplexity: 1000, graphiql: dev-only
    // Rate limiting for public list endpoints (paginated collections).
    // Defaults: 30 req/IP and 500 req global per 60s window when omitted.
    //   rateLimit: { findAll: { windowMs: 60_000, maxPerIp: 30, maxGlobal: 500 } },
    // Set findAll to '*' to disable the list-endpoint limiter entirely:
    //   rateLimit: { findAll: '*' },
  }),

  admin: createAdminAdapter({ prefix: '/admin' }),
})

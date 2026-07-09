# Configuration reference

Manguito CMS is configured through a single file, `manguito.config.ts`, at the
root of your project. It exports the result of `defineConfig()` from
`@bobbykim/manguito-cms-core`, which resolves defaults and validates that the
required adapters are present. The CLI (`manguito dev`, `manguito build`,
`manguito start`, ...) loads this file to know how to connect to your
database, store media, and serve the API and admin panel.

This document is the full reference for every config block, adapter factory,
and environment variable. For how to author content schemas (content types,
paragraph types, taxonomies, enums), see
[`schema-authoring.md`](./schema-authoring.md). For a project overview, see
the root [`README.md`](../README.md).

## Full example

```ts
// manguito.config.ts
import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'
import { createServer, createAPIAdapter } from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

export default defineConfig({
  name: 'my-cms',
  schema: { base_path: './schemas' },
  db: createPostgresAdapter(),
  migrations: { table: '__manguito_migrations', folder: './migrations' },
  storage: createS3Adapter({
    bucket: process.env['STORAGE_S3_BUCKET']!,
    region: process.env['STORAGE_S3_REGION']!,
  }),
  server: createServer({ cors: { origin: process.env['ALLOWED_ORIGIN'] ?? '*' } }),
  api: createAPIAdapter({ prefix: '/api' }),
  admin: createAdminAdapter({ prefix: '/admin' }),
})
```

## Configuration blocks

`ManguitoConfig` has eight top-level blocks. `db`, `storage`, `server`, `api`,
and `admin` are **required** — each takes the result of an adapter factory
(see [Adapters](#adapters) below). `name`, `schema`, and `migrations` are
**optional** and fall back to defaults.

### `name`

Optional. A display name for the project, used in the admin panel and CLI
output. Defaults to `'Manguito CMS'` if omitted.

### `schema`

Optional. Controls where the schema parser looks for content-type,
paragraph-type, taxonomy-type, and enum-type definitions.

```ts
schema: {
  base_path: './schemas',
  folders: {
    content_types: 'content-types',
    paragraph_types: 'paragraph-types',
    taxonomy_types: 'taxonomy-types',
    enum_types: 'enum-types',
  },
}
```

- `base_path` — root directory the parser walks. Defaults to `'./schemas'`.
- `folders` — override any of the four subfolder names individually; each
  defaults to the value shown above. `roles.json` and `routes.json` are not
  folders — they are fixed files read directly from `base_path`.

### `db`

Required. The result of a DB adapter factory — currently
`createPostgresAdapter()` from `@bobbykim/manguito-cms-db`. See
[Adapters](#adapters).

### `migrations`

Optional. Controls where generated migrations are written and which table
tracks applied migrations.

```ts
migrations: {
  table: '__manguito_migrations',
  folder: './migrations',
}
```

- `table` — defaults to `'__manguito_migrations'`.
- `folder` — defaults to `'./migrations'`.

Migrations are skipped entirely (resolved to `null`) when the `db` adapter's
`type` is `'mongodb'`.

### `storage`

Required. The result of a storage adapter factory — `createLocalAdapter()`,
`createS3Adapter()`, or `createCloudinaryAdapter()`, all from
`@bobbykim/manguito-cms-api/storage`. See [Adapters](#adapters).

### `server`

Required. The result of `createServer()` from `@bobbykim/manguito-cms-api`.

```ts
server: createServer({
  port: 3000,
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
})
```

- `port` — defaults to `PORT` env var, or `3000`.
- `cors.origin` — defaults to `ALLOWED_ORIGIN` env var, or `'*'`.
- `cors.methods` — defaults to `['GET', 'POST', 'PUT', 'PATCH', 'DELETE']`.
- `cors.credentials` — defaults to `true`.

### `api`

Required. The result of `createAPIAdapter()` from `@bobbykim/manguito-cms-api`.

```ts
api: createAPIAdapter({
  prefix: '/api',
  media: { max_file_size: 4 * 1024 * 1024 }, // set explicitly to enforce a cap
  rateLimit: {
    findAll: { windowMs: 60_000, maxPerIp: 60, maxGlobal: 600 },
  },
})
```

- `prefix` — API route prefix. Defaults to `'/api'`.
- `media.max_file_size` — max upload size in bytes. **Has no default** — if
  omitted, uploads are not size-capped by the API adapter. Set an explicit
  value (e.g. `4 * 1024 * 1024` for 4 MiB) to enforce a limit.
- `rateLimit.findAll` — rate limiting for public list endpoints (paginated
  collections, not single-item lookups). Set to `'*'` to disable the
  list-endpoint limiter entirely, or an object with `windowMs`, `maxPerIp`,
  `maxGlobal`.

### `admin`

Required. The result of `createAdminAdapter()` from
`@bobbykim/manguito-cms-admin`.

```ts
admin: createAdminAdapter({ prefix: '/admin' })
```

- `prefix` — admin panel route prefix. Defaults to `'/admin'`.

## Adapters

Each required config block is populated by an adapter factory. Options and
the env vars they read are verified against source:

| Factory | Import path | Options (verified) | Reads env |
| --- | --- | --- | --- |
| `createPostgresAdapter()` | `@bobbykim/manguito-cms-db` | `{ url?, serverless?, pool? { max?, idle_timeout? } }` | `DB_URL` |
| `createLocalAdapter()` | `@bobbykim/manguito-cms-api/storage` | `{ upload_dir? }` (default `./uploads`; only warns in `NODE_ENV=production` — does not throw, does not disable the adapter) | `NODE_ENV` |
| `createS3Adapter()` | `@bobbykim/manguito-cms-api/storage` | `{ bucket, region, prefix?, access_key_id?, secret_access_key? }` | (creds via options or AWS SDK chain) |
| `createCloudinaryAdapter()` | `@bobbykim/manguito-cms-api/storage` | `{ cloud_name?, folder?, access_key_id?, secret_access_key? }` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `createServer()` | `@bobbykim/manguito-cms-api` | `{ port?, base_url?, cors? { origin, methods?, credentials?, enabled? } }` | `PORT`, `ALLOWED_ORIGIN` |
| `createAPIAdapter()` | `@bobbykim/manguito-cms-api` | `{ prefix?, media? { max_file_size? }, rateLimit? { findAll? } }` (prefix default `/api`; `media.max_file_size` has no default — uploads are uncapped unless set) | — |
| `createAdminAdapter()` | `@bobbykim/manguito-cms-admin` | `{ prefix? }` (default `/admin`) | — |

Source: `packages/db/src/adapters/postgres.ts`, `packages/api/src/storage/adapters/{local,s3,cloudinary}.ts`, `packages/api/src/server/node.ts`, `packages/api/src/index.ts:11-30`, `packages/admin/src/adapters/admin.ts`.

> Note: `access_key_id`/`secret_access_key` are the real S3/Cloudinary option
> names — NOT `api_key`/`api_secret`.

### Storage adapter snippets

**Local** — writes to disk. Not recommended for production (files don't
persist across container restarts or serverless invocations); the factory
only warns via `console.warn` when `NODE_ENV` is `'production'` — it does not
throw and does not disable the adapter, and there is no CLI/build-step
enforcement.

```ts
import { createLocalAdapter } from '@bobbykim/manguito-cms-api/storage'

storage: createLocalAdapter({ upload_dir: './uploads' })
```

**S3** — presigned uploads to an S3 bucket. `bucket` and `region` are
required; credentials fall back to the AWS SDK's default provider chain if
`access_key_id`/`secret_access_key` are omitted.

```ts
import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'

storage: createS3Adapter({
  bucket: process.env['STORAGE_S3_BUCKET']!,
  region: process.env['STORAGE_S3_REGION']!,
  prefix: 'uploads',
})
```

**Cloudinary** — presigned uploads to Cloudinary. Reads
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` from
the environment when the matching options are omitted.

```ts
import { createCloudinaryAdapter } from '@bobbykim/manguito-cms-api/storage'

storage: createCloudinaryAdapter({ folder: 'my-cms' })
```

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DB_URL` | yes | — | Postgres connection string (`postgres://…`) |
| `AUTH_SECRET` | yes | — | JWT signing secret; required by any token sign/verify path (`signToken`/`verifyToken`, admin media pending-upload tokens) regardless of environment |
| `PORT` | no | `3000` | Node server port |
| `NODE_ENV` | no | `development` | Env mode; `production` only makes the local storage adapter print a `console.warn` (no throw, no disable) |
| `ALLOWED_ORIGIN` | no | `*` | CORS allowed origin |
| `CLOUDINARY_CLOUD_NAME` | if Cloudinary | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | if Cloudinary | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | if Cloudinary | — | Cloudinary API secret |
| `SEEDER_DB_URL` | no | — | Separate DB URL for seeding, if used |

`DB_URL` must start with `postgres://` or `postgresql://`; the adapter throws
on connect otherwise.

## See also

- [`README.md`](../README.md) — project overview and quick start.
- [`schema-authoring.md`](./schema-authoring.md) — content types, paragraph
  types, taxonomy types, enum types, and field reference.

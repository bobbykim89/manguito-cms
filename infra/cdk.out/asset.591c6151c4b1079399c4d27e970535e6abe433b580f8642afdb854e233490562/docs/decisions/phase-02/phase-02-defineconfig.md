# Decision — defineConfig Shape

> Defines the `manguito.config.ts` contract — the single file users write to configure the entire CMS.

---

## Design Principles

**Minimal required config.** A working CMS requires only five keys: `db`, `storage`, `server`, `api`, `admin`. The `schema` and `migrations` keys are fully optional with sensible defaults.

**Adapter pattern throughout.** Every swappable concern (`db`, `storage`, `server`, `api`, `admin`) uses a factory function. This keeps `defineConfig` agnostic of implementation details and makes future adapter additions non-breaking.

**Credentials from environment variables by default.** No adapter requires credentials to be passed explicitly. All adapters read from standard environment variable names by default. Users only pass credentials explicitly when overriding the default env var name.

**One pattern, no exceptions.** Every top-level key either receives a plain config object (for `schema` and `migrations`) or an adapter factory return value. No mixing of the two styles.

---

## Complete Config Shape

```ts
// manguito.config.ts — full example showing all options
import { defineConfig } from '@bobbykim/manguito-cms-core'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import {
  createLocalAdapter,
  createS3Adapter,
  createCloudinaryAdapter,
  createServer,
  createLambdaHandler,
  createVercelHandler,
  createAPIAdapter,
} from '@bobbykim/manguito-cms-api'
import { createAdminAdapter } from '@bobbykim/manguito-cms-admin'

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
  // optional — all defaults apply if omitted entirely
  schema: {
    base_path: './schemas',
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
      roles: 'roles',
    }
  },

  // required
  db: isProd
    ? createPostgresAdapter()
    : createPostgresAdapter({ url: process.env.DEV_DB_URL }),

  // optional — omit for non-relational DB adapters (e.g. MongoDB)
  migrations: {
    table: '__manguito_migrations',
    folder: './migrations',
  },

  // required
  storage: isProd
    ? createS3Adapter({
        bucket: process.env.S3_BUCKET,
        region: process.env.AWS_REGION,
      })
    : createLocalAdapter(),

  // required
  server: isProd
    ? createLambdaHandler({
        cors: { origin: process.env.ALLOWED_ORIGIN }
      })
    : createServer({
        port: 3000,
        cors: { origin: 'http://localhost:5173' }
      }),

  // required
  api: createAPIAdapter({
    prefix: '/api',
    media: {
      max_file_size: 4 * 1024 * 1024,
    }
  }),

  // required
  admin: createAdminAdapter({
    prefix: '/admin',
  }),
})
```

**Minimal working config** (all defaults, local dev):

```ts
export default defineConfig({
  db: createPostgresAdapter(),
  storage: createLocalAdapter(),
  server: createServer(),
  api: createAPIAdapter(),
  admin: createAdminAdapter(),
})
```

---

## TypeScript Types

### ManguitoConfig (user-facing)

```ts
type ManguitoConfig = {
  schema?: SchemaConfig           // optional — defaults apply
  db: DbAdapter                   // required
  migrations?: MigrationsConfig   // optional — null for non-relational DBs
  storage: StorageAdapter         // required
  server: ServerAdapter           // required
  api: APIAdapter                 // required
  admin: AdminAdapter             // required
}
```

### ResolvedManguitoConfig (internal)

```ts
// what defineConfig returns — no optionals, consumers get fully populated config
type ResolvedManguitoConfig = {
  schema: ResolvedSchemaConfig
  db: DbAdapter
  migrations: ResolvedMigrationsConfig | null
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}
```

---

## Schema Config

```ts
type SchemaConfig = {
  base_path?: string
  folders?: Partial<SchemaFolders>
}

type SchemaFolders = {
  content_types: string
  paragraph_types: string
  taxonomy_types: string
  enum_types: string
  roles: string
}

type ResolvedSchemaConfig = {
  base_path: string           // default: './schemas'
  folders: SchemaFolders      // all folder names fully populated
}
```

**Defaults:**

| Key | Default |
| --- | ------- |
| `base_path` | `'./schemas'` |
| `folders.content_types` | `'content-types'` |
| `folders.paragraph_types` | `'paragraph-types'` |
| `folders.taxonomy_types` | `'taxonomy-types'` |
| `folders.enum_types` | `'enum-types'` |
| `folders.roles` | `'roles'` |

`routes.json` lives at `{base_path}/routes.json` — filename is fixed, not configurable.

**Config-time validation:**

| Check | Error code |
| ----- | ---------- |
| `base_path` directory exists | `SCHEMA_DIR_NOT_FOUND` |
| Each folder resolves to a real directory | `SCHEMA_FOLDER_NOT_FOUND` |
| No two folders resolve to the same path | `DUPLICATE_SCHEMA_FOLDER` |
| `routes.json` exists at `base_path` root | `ROUTES_FILE_NOT_FOUND` |

---

## Migrations Config

```ts
type MigrationsConfig = {
  table?: string    // default: '__manguito_migrations'
  folder?: string   // default: './migrations'
}

type ResolvedMigrationsConfig = {
  table: string
  folder: string
} | null            // null when DB adapter type is 'mongodb' or non-relational
```

`__manguito_` prefix on the default table name avoids collision with user-defined content tables in shared Postgres instances.

`manguito build` auto-generates `drizzle.config.ts` from the resolved migrations config — users never maintain this file manually:

```ts
// auto-generated — never hand-edited
export default defineConfig({
  schema: './dist/generated/schema.ts',
  out: './migrations',            // from resolved migrations.folder
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DB_URL },
  migrationsTable: '__manguito_migrations', // from resolved migrations.table
})
```

---

## DB Adapter

### Interface (defined in `@bobbykim/manguito-cms-core`)

```ts
interface DbAdapter {
  readonly type: "postgres" | "mongodb"
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  runMigrations(): Promise<MigrationResult>
  getMigrationStatus(): Promise<MigrationStatus>
  getTableNames(): Promise<string[]>
  tableExists(name: string): Promise<boolean>
}
```

### `createPostgresAdapter` (`@bobbykim/manguito-cms-db`)

```ts
type PostgresAdapterOptions = {
  url?: string              // default: process.env.DB_URL
  serverless?: boolean      // default: auto-detected from URL (neon.tech → true)
  pool?: {
    max?: number            // default: 10
    idle_timeout?: number   // default: 30 (seconds)
    connect_timeout?: number // default: 10 (seconds)
  }
}

export function createPostgresAdapter(
  options: PostgresAdapterOptions = {}
): DbAdapter
```

**Serverless auto-detection:** If `url` contains `neon.tech`, the adapter automatically uses the Neon HTTP driver instead of TCP — no need to set `serverless: true` manually.

**Config-time validation:**

| Check | Error code |
| ----- | ---------- |
| URL present from options or env | `DB_URL_MISSING` |
| URL format is valid | `DB_URL_INVALID` |

Connection is validated at startup (`connect()`), not at config parse time.

---

## Storage Adapter

### Interface (defined in `@bobbykim/manguito-cms-core`)

```ts
interface StorageAdapter {
  readonly type: "local" | "s3" | "cloudinary"
  upload(file: File | Buffer, options: UploadOptions): Promise<UploadResult>
  delete(key: string): Promise<void>
  getUrl(key: string): string
  getPresignedUploadUrl(options: PresignedOptions): Promise<PresignedResult>
}

type UploadOptions = {
  folder: "image" | "video" | "file"
  filename: string
  mime_type: string
}

type UploadResult = {
  key: string
  url: string
}

type PresignedOptions = {
  folder: "image" | "video" | "file"
  filename: string
  mime_type: string
  expires_in?: number   // seconds, default: 3600
}

type PresignedResult = {
  upload_url: string
  key: string
  expires_at: number
}
```

### `createLocalAdapter`

```ts
type LocalAdapterOptions = {
  upload_dir?: string     // default: './uploads'
  max_file_size?: number  // default: from api.media.max_file_size in resolved config
}

export function createLocalAdapter(
  options: LocalAdapterOptions = {}
): StorageAdapter
```

**Production warning:** If `NODE_ENV === 'production'` and local adapter is configured, `manguito start` prints:

```
⚠ Warning: Local storage adapter is not recommended for production.
  Uploaded files will not persist across container restarts or serverless invocations.
  Consider using S3 or Cloudinary for production deployments.
```

| Environment | Local adapter |
| ----------- | ------------- |
| Local development | ✓ Recommended |
| Traditional single VPS | ⚠ Works but not recommended |
| Containerized (Docker/ECS) | ✗ Files lost on redeploy |
| Serverless (Lambda/Vercel) | ✗ Fundamentally broken |

### `createS3Adapter`

```ts
type S3AdapterOptions = {
  bucket: string                    // required
  region: string                    // required
  prefix?: string                   // optional folder prefix for all keys
  access_key_id?: string            // default: process.env.AWS_ACCESS_KEY_ID
  secret_access_key?: string        // default: process.env.AWS_SECRET_ACCESS_KEY
}

export function createS3Adapter(options: S3AdapterOptions): StorageAdapter
```

### `createCloudinaryAdapter`

```ts
type CloudinaryAdapterOptions = {
  cloud_name: string                // required
  folder?: string                   // optional folder prefix
  access_key_id?: string            // default: process.env.CLOUDINARY_API_KEY
  secret_access_key?: string        // default: process.env.CLOUDINARY_API_SECRET
}

export function createCloudinaryAdapter(
  options: CloudinaryAdapterOptions
): StorageAdapter
```

---

## Server Adapter

### Interface (defined in `@bobbykim/manguito-cms-core`)

```ts
interface ServerAdapter {
  readonly type: "node" | "lambda" | "vercel"
  getEntryPoint(): string
  cors: CorsConfig
}

type CorsConfig = {
  origin: string | string[]   // default: process.env.ALLOWED_ORIGIN
  methods?: string[]          // default: ["GET", "POST", "PUT", "PATCH", "DELETE"]
  credentials?: boolean       // default: true
}
```

### `createServer` (traditional Node server)

```ts
type NodeServerOptions = {
  port?: number               // default: process.env.PORT ?? 3000
  base_url?: string           // default: `http://localhost:${port}`
  cors?: Partial<CorsConfig>
}

export function createServer(options: NodeServerOptions = {}): ServerAdapter
```

### `createLambdaHandler` (AWS Lambda)

```ts
type LambdaHandlerOptions = {
  cors?: Partial<CorsConfig>
  timeout?: number            // default: 29 seconds (API Gateway max)
  memory?: number             // default: 512 MB
}

export function createLambdaHandler(
  options: LambdaHandlerOptions = {}
): ServerAdapter
```

### `createVercelHandler` (Vercel Functions)

```ts
type VercelHandlerOptions = {
  cors?: Partial<CorsConfig>
  region?: string             // default: "iad1"
  max_duration?: number       // default: 10 seconds (hobby plan max)
}

export function createVercelHandler(
  options: VercelHandlerOptions = {}
): ServerAdapter
```

---

## API Adapter

### Interface (defined in `@bobbykim/manguito-cms-core`)

```ts
interface APIAdapter {
  readonly prefix: string
  readonly media: ResolvedMediaConfig
}

type ResolvedMediaConfig = {
  max_file_size: number   // bytes
}
```

### `createAPIAdapter` (`@bobbykim/manguito-cms-api`)

```ts
type APIAdapterOptions = {
  prefix?: string           // default: '/api'
  media?: {
    max_file_size?: number  // default: 4 * 1024 * 1024 (4MB)
  }
}

export function createAPIAdapter(
  options: APIAdapterOptions = {}
): APIAdapter
```

**Global file size limit:** `max_file_size` is validated at parse time against individual field `max_size` values. If a schema field defines `max_size` larger than the global limit, the parser emits `MAX_SIZE_EXCEEDS_GLOBAL_LIMIT`.

**Deployment target size constraints:**

| Service | Hard limit |
| ------- | ---------- |
| AWS Lambda (API Gateway) | 10MB |
| Vercel (hobby) | 4.5MB |
| Vercel (pro) | 100MB |
| Traditional server | No hard limit |

The default 4MB is safely below the most restrictive common target. For large video uploads, the presigned URL flow bypasses the server entirely — see `phase-05-media-endpoints.md`.

---

## Admin Adapter

### Interface (defined in `@bobbykim/manguito-cms-core`)

```ts
interface AdminAdapter {
  readonly prefix: string
}
```

### `createAdminAdapter` (`@bobbykim/manguito-cms-admin`)

```ts
type AdminAdapterOptions = {
  prefix?: string   // default: '/admin'
}

export function createAdminAdapter(
  options: AdminAdapterOptions = {}
): AdminAdapter
```

---

## defineConfig Function

```ts
// packages/core/src/config/defineConfig.ts

export function defineConfig(config: ManguitoConfig): ResolvedManguitoConfig {
  return {
    schema: resolveSchemaConfig(config.schema),
    db: config.db,
    migrations: resolveMigrationsConfig(config.migrations, config.db),
    storage: config.storage,
    server: config.server,
    api: config.api,
    admin: config.admin,
  }
}

function resolveSchemaConfig(config?: SchemaConfig): ResolvedSchemaConfig {
  return {
    base_path: config?.base_path ?? './schemas',
    folders: {
      content_types: config?.folders?.content_types ?? 'content-types',
      paragraph_types: config?.folders?.paragraph_types ?? 'paragraph-types',
      taxonomy_types: config?.folders?.taxonomy_types ?? 'taxonomy-types',
      enum_types: config?.folders?.enum_types ?? 'enum-types',
      roles: config?.folders?.roles ?? 'roles',
    }
  }
}

function resolveMigrationsConfig(
  config?: MigrationsConfig,
  db?: DbAdapter
): ResolvedMigrationsConfig | null {
  if (db?.type === 'mongodb') return null
  return {
    table: config?.table ?? '__manguito_migrations',
    folder: config?.folder ?? './migrations',
  }
}
```

---

## Environment Variables Reference

```bash
# Database
DB_URL=                          # postgres connection string
DEV_DB_URL=                      # optional — separate dev database

# Storage — S3
S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Storage — Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Auth
AUTH_SECRET=                     # min 32 chars, generated by manguito init

# Server
PORT=3000
NODE_ENV=development
ALLOWED_ORIGIN=
BASE_URL=                        # used by local storage adapter for URL generation
```

All credentials read from environment variables by default. Never hardcode credentials in `manguito.config.ts`.

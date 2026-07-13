// ─── Schema Config ────────────────────────────────────────────────────────────

// The four schema-type folders walked by the parser. roles.json and routes.json
// are not folders — they are fixed files read directly from base_path.
export type SchemaFolders = {
  content_types: string
  paragraph_types: string
  taxonomy_types: string
  enum_types: string
}

export type SchemaConfig = {
  base_path?: string
  folders?: Partial<SchemaFolders>
}

export type ResolvedSchemaConfig = {
  base_path: string
  folders: SchemaFolders
}

// ─── Programmatic Fields Config ───────────────────────────────────────────────

export type ProgrammaticConfig = {
  dir?: string
}

export type ResolvedProgrammaticConfig = {
  dir: string
}

// ─── Migrations Config ────────────────────────────────────────────────────────

export type MigrationsConfig = {
  table?: string
  folder?: string
}

export type ResolvedMigrationsConfig = {
  table: string
  folder: string
} | null

// ─── DB Adapter ───────────────────────────────────────────────────────────────

export type MigrationResult = {
  applied: number
  skipped: number
}

export type MigrationStatus = {
  pending: string[]
  applied: string[]
}

// Migration orchestration is not an adapter responsibility: it needs the
// generated drizzle config path + migrations folder, which the CLI produces at
// build time. It runs through the standalone runDevMigration / generateMigration
// / applyMigrations / getMigrationStatus functions in @bobbykim/manguito-cms-db,
// which take those paths as arguments. The adapter is connection + introspection
// only. (MigrationResult / MigrationStatus below are the return types of those
// standalone functions.)
export interface DbAdapter {
  readonly type: 'postgres' | 'mongodb'
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  getTableNames(): Promise<string[]>
  tableExists(name: string): Promise<boolean>
}

// ─── Storage Adapter ──────────────────────────────────────────────────────────

export type PresignedOptions = {
  folder: 'image' | 'video' | 'file'
  filename: string
  mime_type: string
  expires_in?: number
}

export type PresignedResult = {
  upload_url: string
  key: string
  expires_at: number
  // Some storages (e.g. Cloudinary) require a multipart POST with signed form
  // fields instead of a raw PUT (S3). When `method` is 'POST', the client posts
  // a form containing `fields` plus the file; otherwise it PUTs the raw file.
  method?: 'PUT' | 'POST'
  fields?: Record<string, string>
}

export interface StorageAdapter {
  readonly type: 'local' | 's3' | 'cloudinary'
  delete(key: string): Promise<void>
  getUrl(key: string): string
  getPresignedUploadUrl(options: PresignedOptions): Promise<PresignedResult>
  upload?(key: string, data: Uint8Array, mimeType: string): Promise<void>
  /** Optional metadata lookup used to validate uploaded objects on confirm. */
  stat?(key: string): Promise<{ size: number; content_type?: string } | null>
  /**
   * Cross-origin hosts the browser connects to during a presigned upload,
   * as CSP connect-src origins (scheme + host, no path). Used to build the
   * Content-Security-Policy. Adapters whose uploads are same-origin (local)
   * omit this.
   */
  getUploadOrigins?(): string[]
}

// ─── Server Adapter ───────────────────────────────────────────────────────────

export type CorsConfig = {
  enabled?: boolean
  origin: string | string[]
  methods?: string[]
  credentials?: boolean
}

export interface ServerAdapter {
  readonly type: 'node' | 'lambda' | 'vercel'
  getEntryPoint(): string
  cors: CorsConfig
}

// ─── API Adapter ──────────────────────────────────────────────────────────────

export type ResolvedMediaConfig = {
  max_file_size?: number
}

export type ResolvedRateLimitConfig = {
  /**
   * Rate limiting for public list endpoints (paginated collections, not
   * single-item lookups). Set `findAll: '*'` to disable the list-endpoint
   * limiter entirely.
   */
  findAll?:
    | '*'
    | {
        windowMs?: number
        maxPerIp?: number
        maxGlobal?: number
      }
}

export interface APIAdapter {
  readonly prefix: string
  readonly media?: ResolvedMediaConfig
  readonly rateLimit?: ResolvedRateLimitConfig
}

// ─── Admin Adapter ────────────────────────────────────────────────────────────

export interface AdminAdapter {
  readonly prefix: string
}

// ─── Top-level Config ─────────────────────────────────────────────────────────

export type ManguitoConfig = {
  name?: string
  schema?: SchemaConfig
  programmatic?: ProgrammaticConfig
  db: DbAdapter
  migrations?: MigrationsConfig
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}

export type ResolvedManguitoConfig = {
  name: string
  schema: ResolvedSchemaConfig
  programmatic: ResolvedProgrammaticConfig
  db: DbAdapter
  migrations: ResolvedMigrationsConfig | null
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}

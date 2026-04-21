// ─── Schema Config ────────────────────────────────────────────────────────────

export type SchemaFolders = {
  content_types: string
  paragraph_types: string
  taxonomy_types: string
  enum_types: string
  roles: string
}

export type SchemaConfig = {
  base_path?: string
  folders?: Partial<SchemaFolders>
}

export type ResolvedSchemaConfig = {
  base_path: string
  folders: SchemaFolders
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

export interface DbAdapter {
  readonly type: 'postgres' | 'mongodb'
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  runMigrations(): Promise<MigrationResult>
  getMigrationStatus(): Promise<MigrationStatus>
  getTableNames(): Promise<string[]>
  tableExists(name: string): Promise<boolean>
}

// ─── Storage Adapter ──────────────────────────────────────────────────────────

export type UploadOptions = {
  folder: 'image' | 'video' | 'file'
  filename: string
  mime_type: string
}

export type UploadResult = {
  key: string
  url: string
}

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
}

export interface StorageAdapter {
  readonly type: 'local' | 's3' | 'cloudinary'
  upload(file: File | Buffer, options: UploadOptions): Promise<UploadResult>
  delete(key: string): Promise<void>
  getUrl(key: string): string
  getPresignedUploadUrl(options: PresignedOptions): Promise<PresignedResult>
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

export interface APIAdapter {
  readonly prefix: string
  readonly media?: ResolvedMediaConfig
}

// ─── Admin Adapter ────────────────────────────────────────────────────────────

export interface AdminAdapter {
  readonly prefix: string
}

// ─── Top-level Config ─────────────────────────────────────────────────────────

export type ManguitoConfig = {
  schema?: SchemaConfig
  db: DbAdapter
  migrations?: MigrationsConfig
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}

export type ResolvedManguitoConfig = {
  schema: ResolvedSchemaConfig
  db: DbAdapter
  migrations: ResolvedMigrationsConfig | null
  storage: StorageAdapter
  server: ServerAdapter
  api: APIAdapter
  admin: AdminAdapter
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export type FilterOperator = {
  gt?: number | string
  gte?: number | string
  lt?: number | string
  lte?: number | string
}

// Single scalar, multi-value equality array (OR), or range operator object
export type FilterValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | FilterOperator

// ─── Pagination ───────────────────────────────────────────────────────────────

export type PaginatedResult<T> = {
  ok: true
  data: T[]
  meta: {
    total: number
    page: number
    per_page: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
}

// ─── Content repository options ───────────────────────────────────────────────

export type FindManyOptions = {
  page?: number
  per_page?: number
  include?: string[]
  published_only?: boolean
  filters?: Record<string, FilterValue>
  sort_by?: 'title' | 'created_at' | 'updated_at'
  sort_order?: 'asc' | 'desc'
}

export type FindAllOptions = {
  include?: string[]
  published_only?: boolean
}

export type CreateInput<T> = Omit<T, 'id' | 'created_at' | 'updated_at'>

export type UpdateInput<T> = Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>

// ─── Content repository ───────────────────────────────────────────────────────

export interface ContentRepository<T> {
  findMany(options: FindManyOptions): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T | null>
  findBySlug(slug: string): Promise<T | null>
  create(data: CreateInput<T>): Promise<T>
  update(id: string, data: UpdateInput<T>): Promise<T | null>
  delete(id: string): Promise<void>
  findAll(options: FindAllOptions): Promise<T[]>
}

// ─── Media types ──────────────────────────────────────────────────────────────

export type MediaItem = {
  id: string
  type: 'image' | 'video' | 'file'
  url: string
  mime_type: string
  alt?: string
  file_size: number
  width?: number
  height?: number
  duration?: number
  reference_count: number
  created_at: Date
  updated_at: Date
}

export type CreateMediaInput = {
  type: 'image' | 'video' | 'file'
  url: string
  mime_type: string
  alt?: string
  file_size: number
  width?: number
  height?: number
  duration?: number
}

export type MediaFindManyOptions = {
  page?: number
  per_page?: number
  type?: 'image' | 'video' | 'file'
  orphaned?: boolean
}

// ─── Media repository ─────────────────────────────────────────────────────────

export interface MediaRepository {
  findMany(options: MediaFindManyOptions): Promise<PaginatedResult<MediaItem>>
  findOne(id: string): Promise<MediaItem | null>
  create(data: CreateMediaInput): Promise<MediaItem>
  update(id: string, data: Partial<MediaItem>): Promise<MediaItem | null>
  delete(id: string): Promise<void>
  incrementReferenceCount(ids: string[]): Promise<void>
  decrementReferenceCount(ids: string[]): Promise<void>
}

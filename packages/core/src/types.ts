// ─── Pagination ───────────────────────────────────────────────────────────────

export type PaginatedResult<T> = {
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

// ─── Repository ───────────────────────────────────────────────────────────────

export type FindManyOptions = {
  page?: number
  per_page?: number
  include?: string[]
  published_only?: boolean
  filters?: Record<string, unknown>
}

export type FindAllOptions = {
  include?: string[]
  published_only?: boolean
}

export type CreateInput<T> = Omit<T, 'id' | 'created_at' | 'updated_at'>

export type UpdateInput<T> = Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>

export interface ContentRepository<T> {
  findMany(options: FindManyOptions): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T | null>
  findBySlug(slug: string): Promise<T | null>
  create(data: CreateInput<T>): Promise<T>
  update(id: string, data: UpdateInput<T>): Promise<T | null>
  delete(id: string): Promise<void>
  findAll(options: FindAllOptions): Promise<T[]>
}

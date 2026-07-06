import type { FilterValue, FilterOperator } from '@bobbykim/manguito-cms-core'

// Query-param parsing shared by the public and admin content/taxonomy list routes.

// Only indexed system fields are sortable.
export const SORTABLE_FIELDS = new Set<string>(['title', 'created_at', 'updated_at'])

// Field types whose values are relations rather than plain columns.
export const RELATION_FIELD_TYPES = new Set([
  'paragraph',
  'reference',
  'image',
  'video',
  'file',
])

export function parsePagination(
  pageStr: string | undefined,
  perPageStr: string | undefined
): { ok: true; page: number; per_page: number } | { ok: false } {
  const page = pageStr !== undefined ? Number(pageStr) : 1
  const per_page = perPageStr !== undefined ? Number(perPageStr) : 10

  if (!Number.isInteger(page) || page < 1) return { ok: false }
  if (!Number.isInteger(per_page) || per_page < 1 || per_page > 100) return { ok: false }
  return { ok: true, page, per_page }
}

export function parseInclude(includeParam: string | undefined): string[] {
  if (!includeParam) return []
  return includeParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseFilters(
  url: string,
  validFields: Set<string>
): { ok: true; filters: Record<string, FilterValue> } | { ok: false; invalidField: string } {
  const { searchParams } = new URL(url)
  const filters: Record<string, FilterValue> = {}

  for (const [key, value] of searchParams.entries()) {
    const simpleMatch = /^filter\[([^\]]+)\]$/.exec(key)
    const opMatch = /^filter\[([^\]]+)\]\[([^\]]+)\]$/.exec(key)

    if (simpleMatch) {
      const field = simpleMatch[1]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      const existing = filters[field]
      if (existing !== undefined) {
        filters[field] = Array.isArray(existing)
          ? [...existing, value]
          : [existing as string | number | boolean, value]
      } else {
        filters[field] = value
      }
    } else if (opMatch) {
      const field = opMatch[1]!
      const operator = opMatch[2]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) continue
      const existing = (filters[field] as FilterOperator | undefined) ?? {}
      filters[field] = { ...(existing as FilterOperator), [operator]: value }
    }
  }

  return { ok: true, filters }
}

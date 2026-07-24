import DataLoader from 'dataloader'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
  ParsedParagraphType,
} from '@bobbykim/manguito-cms-core'
import { buildRelationsMap, resolveRelationField, type RelationDef } from '../relations.js'

export interface RelationLoaders {
  load(typeName: string, fieldName: string, parent: Record<string, unknown>): Promise<unknown>
}

type ParentRow = Record<string, unknown>

// One RelationLoaders instance per request. Loaders batch sibling parents per
// (type, field); the shared cache dedupes target lookups across all loaders in
// the request, mirroring the repository's resolveRows cache.
export function createRelationLoaders(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry
): RelationLoaders {
  const relMaps = new Map<string, Record<string, RelationDef>>()
  const loaders = new Map<string, DataLoader<ParentRow, unknown>>()
  const cache = new Map<string, unknown>()

  function relationsFor(typeName: string): Record<string, RelationDef> {
    let m = relMaps.get(typeName)
    if (!m) {
      const type = (registry.content_types[typeName] ??
        registry.taxonomy_types[typeName] ??
        registry.paragraph_types[typeName]) as
        | ParsedContentType
        | ParsedTaxonomyType
        | ParsedParagraphType
        | undefined
      m = type ? buildRelationsMap(type.fields, registry) : {}
      relMaps.set(typeName, m)
    }
    return m
  }

  function loaderFor(typeName: string, fieldName: string, rel: RelationDef): DataLoader<ParentRow, unknown> {
    const key = `${typeName}:${fieldName}`
    let dl = loaders.get(key)
    if (!dl) {
      dl = new DataLoader<ParentRow, unknown>(
        async (parents) => {
          const rows = parents as ParentRow[]
          // GraphQL is public-only (see app.ts) — always filter relation targets
          // to published rows, mirroring the REST public repos' publishedRelations.
          await resolveRelationField(db, rows, fieldName, rel, cache, true)
          return rows.map((r) => r[fieldName])
        },
        // Batch within a tick; do not memoize by parent identity (rows are mutated
        // and may recur across nesting levels).
        { cache: false }
      )
      loaders.set(key, dl)
    }
    return dl
  }

  return {
    async load(typeName, fieldName, parent) {
      const rel = relationsFor(typeName)[fieldName]
      if (!rel) return null
      return loaderFor(typeName, fieldName, rel).load(parent)
    },
  }
}

// ─── Public route path construction ───────────────────────────────────────────
//
// The single place public route paths are built. Registrators must not hardcode
// '/api/...': the prefix is configurable (api.prefix) and Stage 2 inserts a
// version segment here.

export function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return '/api'
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed === '' ? '/api' : trimmed
}

export type PublicPaths = {
  collection(basePath: string): string
  item(basePath: string): string
  taxonomyCollection(typeName: string): string
  taxonomyItem(typeName: string): string
  mediaCollection(): string
  mediaItem(): string
  openapi(): string
}

export function createPublicPaths(prefix: string): PublicPaths {
  return {
    collection: (basePath) => `${prefix}/${basePath}`,
    item: (basePath) => `${prefix}/${basePath}/:slug`,
    taxonomyCollection: (typeName) => `${prefix}/taxonomy/${typeName}`,
    taxonomyItem: (typeName) => `${prefix}/taxonomy/${typeName}/:id`,
    mediaCollection: () => `${prefix}/media`,
    mediaItem: () => `${prefix}/media/:id`,
    openapi: () => `${prefix}/openapi.json`,
  }
}

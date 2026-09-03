// ─── Public route path construction ───────────────────────────────────────────
//
// The single place public route paths are built. Registrators must not hardcode
// '/api/...': the prefix is configurable (api.prefix), and the schema-driven
// surface carries a version segment.
//
// The two shapes are separate types on purpose. Content and taxonomy are
// schema-driven and therefore versioned; media and the OpenAPI document are
// not — MediaItem is a fixed shape the schema never touches, so a version
// segment would duplicate byte-identical routes per live version. Keeping them
// in different types makes versioning media UNEXPRESSIBLE rather than merely
// discouraged.

export function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return '/api'
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed === '' ? '/api' : trimmed
}

/** The fixed public surface. Never versioned. */
export type PublicPaths = {
  mediaCollection(): string
  mediaItem(): string
  openapi(): string
}

/** The schema-driven public surface. Versioned, or unversioned when `version` is null. */
export type VersionedPaths = {
  collection(basePath: string): string
  item(basePath: string): string
  taxonomyCollection(typeName: string): string
  taxonomyItem(typeName: string): string
}

export function createPublicPaths(prefix: string): PublicPaths {
  return {
    mediaCollection: () => `${prefix}/media`,
    mediaItem: () => `${prefix}/media/:id`,
    openapi: () => `${prefix}/openapi.json`,
  }
}

/**
 * `version` null means no segment — the unversioned pass, whose paths must be
 * byte-identical to what the app served before versioning existed.
 */
export function createVersionedPaths(prefix: string, version: string | null): VersionedPaths {
  const root = version === null ? prefix : `${prefix}/${version}`
  return {
    collection: (basePath) => `${root}/${basePath}`,
    item: (basePath) => `${root}/${basePath}/:slug`,
    taxonomyCollection: (typeName) => `${root}/taxonomy/${typeName}`,
    taxonomyItem: (typeName) => `${root}/taxonomy/${typeName}/:id`,
  }
}

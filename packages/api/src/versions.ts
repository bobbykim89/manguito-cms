import type { VersionProjection } from '@bobbykim/manguito-cms-core'

// ─── The baked version model ──────────────────────────────────────────────────
//
// What `manguito build` writes into .manguito/version-model.ts and the
// generated server entry passes to createCmsApp.
//
// This is `Omit<VersionModel, 'union'>`. The union IS the current registry
// (`union === current` in core, by reference), and createCmsApp already
// receives that registry — so baking the union too would duplicate the whole
// registry in the generated bundle, and the reference identity that made it
// free in memory does not survive serialization.
export type BakedVersionModel = {
  /** e.g. 'v4' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /** Keyed by version name. */
  projections: Record<string, VersionProjection>
}

export type VersionClass = 'not-a-version' | 'live' | 'retired' | 'unknown'

const VERSION_SEGMENT = /^v\d+$/

function versionNumber(version: string): number {
  return Number.parseInt(version.slice(1), 10)
}

/**
 * What a URL's version segment is.
 *
 * The retired/unknown split is arithmetic on the model alone, with nothing
 * persisted: `current` is the highest snapshot plus one, so a number BELOW it
 * that is not live must have been cut and later retired, while a number at or
 * above it was never cut. A retired version answering 404 would read as "wrong
 * URL" and send a pinned consumer hunting for a typo instead of upgrading.
 *
 * `not-a-version` is load-bearing, not defensive: media stays unversioned, so
 * the catch-all sees `/api/media/:id` too and must fall through for it.
 */
export function classifyVersion(segment: string, model: BakedVersionModel): VersionClass {
  if (!VERSION_SEGMENT.test(segment)) return 'not-a-version'
  if (model.live.includes(segment)) return 'live'
  return versionNumber(segment) < versionNumber(model.current) ? 'retired' : 'unknown'
}

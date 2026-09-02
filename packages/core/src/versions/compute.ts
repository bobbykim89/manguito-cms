// packages/core/src/versions/compute.ts
import type { Result } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { VersionModel, VersionSnapshot } from './types.js'
import { validateVersionModel } from './validate.js'
import { buildProjections } from './projections.js'

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
}): Result<VersionModel> {
  const { current, snapshots } = input

  // Current is one past the highest cut; v1 when nothing has been cut.
  const highest = snapshots.reduce((max, s) => Math.max(max, versionNumber(s.version)), 0)
  const currentVersion = `v${highest + 1}`
  // `live` is documented oldest-first, so the order comes from the version
  // NUMBER, never the caller's array order — a direct call with [v2, v1] must
  // not produce live: ['v2','v1','v3']. Deduplicated for the same reason.
  const live = [
    ...new Set(snapshots.map((s) => s.version).sort((a, b) => versionNumber(a) - versionNumber(b))),
    currentVersion,
  ]

  // The union IS current. Retention is stated as a tombstone rather than
  // derived by merging snapshots, so a column an older live version still
  // serves is already in current — and checkUnionCompleteness below is what
  // makes that true, by rejecting any model where it is not. That check is the
  // whole of what the merge used to paper over.
  const union = current

  // Built BEFORE validation, unlike the derived model, which validated first
  // on the grounds that building an invalid model produces plausible-looking
  // wrong output. A projection is now a pure read of one version's own schema
  // files: it cannot be wrong, only incomplete — and detecting that is exactly
  // what the completeness check reads the projections for.
  const projections = buildProjections({ current, currentVersion, snapshots })

  const errors = validateVersionModel({ current, currentVersion, snapshots, union, projections })
  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, value: { current: currentVersion, live, union, projections } }
}

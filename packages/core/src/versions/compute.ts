import type { Result } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { PendingChanges, VersionHistory, VersionModel, VersionSnapshot } from './types.js'
import { validateRenameChain } from './fold.js'
import { validateVersionModel, validateModelStructure } from './validate.js'
import { buildUnionRegistry } from './union.js'
import { buildProjections } from './projections.js'

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
  history: VersionHistory
  pending: PendingChanges
}): Result<VersionModel> {
  const { current, snapshots, history, pending } = input

  // Current is one past the highest cut; v1 when nothing has been cut.
  const highest = snapshots.reduce((max, s) => Math.max(max, versionNumber(s.version)), 0)
  const currentVersion = `v${highest + 1}`
  // `live` is documented oldest-first, and checkAmbiguousRenames' recency
  // ranking reads position in it as recency — so the order comes from the
  // version NUMBER, never from the caller's array order. `loadVersionModel`
  // already discovers directories sorted, but a direct call with [v2, v1]
  // would otherwise produce live: ['v2','v1','v3'] and rank v1 as newer than
  // v2. Deduplicated for the same reason: two snapshots claiming one version
  // must not occupy two ranks.
  const live = [
    ...new Set(snapshots.map((s) => s.version).sort((a, b) => versionNumber(a) - versionNumber(b))),
    currentVersion,
  ]

  // Validation runs BEFORE the union and projections are built: building them
  // on a model known to be invalid produces plausible-looking wrong output, and
  // the errors are what the caller acts on either way.
  const errors = [
    ...validateRenameChain({ history, pending, snapshots, current, currentVersion }),
    ...validateVersionModel({ current, currentVersion, snapshots, live, history, pending }),
  ]
  if (errors.length > 0) return { ok: false, errors }

  const shared = { current, currentVersion, snapshots, live, history, pending }
  const union = buildUnionRegistry(shared)
  const projections = buildProjections(shared)

  // Invariants of the BUILT model — one column per field within a type, one
  // label per column within a projection. Nothing above guarantees them, and a
  // model that violates them is worse than an error: it hands db codegen two
  // fields fighting over one column, and the API two labels serving one value.
  const structural = validateModelStructure({ union, projections })
  if (structural.length > 0) return { ok: false, errors: structural }

  return {
    ok: true,
    value: { current: currentVersion, live, union, projections },
  }
}

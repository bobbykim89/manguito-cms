import type { Result } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { PendingChanges, VersionHistory, VersionModel, VersionSnapshot } from './types.js'
import { validateRenameChain } from './fold.js'
import { validateVersionModel } from './validate.js'
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
  const live = [...snapshots.map((s) => s.version), currentVersion]

  // Validation runs BEFORE the union and projections are built: building them
  // on a model known to be invalid produces plausible-looking wrong output, and
  // the errors are what the caller acts on either way.
  const errors = [
    ...validateRenameChain({ history, pending, snapshots, current, currentVersion }),
    ...validateVersionModel({ current, currentVersion, snapshots, live, history, pending }),
  ]
  if (errors.length > 0) return { ok: false, errors }

  const shared = { current, currentVersion, snapshots, live, history, pending }
  return {
    ok: true,
    value: {
      current: currentVersion,
      live,
      union: buildUnionRegistry(shared),
      projections: buildProjections(shared),
    },
  }
}

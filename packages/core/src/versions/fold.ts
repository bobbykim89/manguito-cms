import type { ParseError } from '../parser/loader.js'
import type { PendingChanges, VersionHistory, VersionSnapshot } from './types.js'
import type { SchemaRegistry } from '../parser/validate.js'

// ─── The rename fold ──────────────────────────────────────────────────────────
//
// A field's COLUMN is its label in the earliest version that ever contained it.
// A rename tagged `after: vJ` happened between vJ and vJ+1, so a version vK's
// labels reflect every rename tagged after vJ for all J < K. To recover the
// column behind a label in vK, apply the reverse of exactly those renames,
// newest first.
//
// The comparison is on the version's NUMBER, not on membership in `live` —
// history is never pruned, so a rename tagged after a RETIRED version must
// still apply. Filtering by `live` here would silently produce wrong columns
// for every field renamed during a retired version's life.

function versionNumber(version: string): number {
  const n = Number.parseInt(version.replace(/^v/, ''), 10)
  return Number.isNaN(n) ? -1 : n
}

/**
 * Renames that shaped `version`'s labels: those tagged after any OLDER version.
 * Sorted oldest-tag-first — machine-appended history is already chronological,
 * but a merge resolution can interleave two branches' appended blocks, and the
 * fold must be order-independent across tags, not dependent on array position.
 * `Array.prototype.sort` is stable, so within-tag insertion order is preserved.
 */
function renamesBefore(
  version: string,
  history: VersionHistory,
  type: string
): Array<{ from: string; to: string }> {
  const target = versionNumber(version)
  return history.renames
    .filter((r) => r.type === type && versionNumber(r.after) < target)
    .sort((a, b) => versionNumber(a.after) - versionNumber(b.after))
    .map((r) => ({ from: r.from, to: r.to }))
}

export function columnOf(input: {
  label: string
  type: string
  version: string
  live: string[]
  history: VersionHistory
  pending: PendingChanges
  current: string
}): string {
  const { label, type, version, history, pending, current } = input

  const applied = renamesBefore(version, history, type)

  // pending.json is implicitly tagged "after the newest cut", so it shaped the
  // current version's labels and no earlier one's.
  if (version === current) {
    applied.push(...pending.renames.filter((r) => r.type === type).map((r) => ({ from: r.from, to: r.to })))
  }

  // Unwind newest first: each step maps a later label back to its earlier one.
  let out = label
  for (let i = applied.length - 1; i >= 0; i--) {
    if (applied[i]!.to === out) out = applied[i]!.from
  }
  return out
}

/** Every label a registry's type exposes, for chain checking. */
function labelsOf(registry: SchemaRegistry, type: string): Set<string> | null {
  const schema = registry.schemas[type]
  if (!schema || !('fields' in schema)) return null
  return new Set((schema.fields as Array<{ name: string }>).map((f) => f.name))
}

/** A history `after` tag must look like `v<digits>` — anything else corrupts the fold's ordering. */
const AFTER_PATTERN = /^v\d+$/

/**
 * A rename's `from` must name a label that actually existed, and its `type`
 * must name a type that actually exists. Checking these here turns a misfiled
 * pending entry — or a hand-edited/merge-resolved history — into a loud
 * failure rather than a column that silently resolves to the wrong name.
 */
export function validateRenameChain(input: {
  history: VersionHistory
  pending: PendingChanges
  snapshots: VersionSnapshot[]
  current: SchemaRegistry
  currentVersion: string
}): ParseError[] {
  const { history, pending, snapshots, current, currentVersion } = input
  const errors: ParseError[] = []

  // Types that actually exist, from snapshots and current ONLY — never seeded
  // from a rename's own `type`, or a bad type name would vouch for itself.
  const knownTypes = new Set<string>()
  for (const snap of snapshots) {
    for (const type of Object.keys(snap.registry.schemas)) knownTypes.add(type)
  }
  for (const type of Object.keys(current.schemas)) knownTypes.add(type)

  // Every label any live version has ever exposed for a type, plus every `to`
  // a rename produced — a chain step may legitimately reference a label that
  // only ever existed between two cuts. (This seeding is for the LABEL check
  // only — a bad type must not be able to vouch for itself via its own `to`.)
  const knownLabels = new Map<string, Set<string>>()
  const add = (type: string, label: string): void => {
    if (!knownLabels.has(type)) knownLabels.set(type, new Set())
    knownLabels.get(type)!.add(label)
  }

  for (const snap of snapshots) {
    for (const type of Object.keys(snap.registry.schemas)) {
      for (const l of labelsOf(snap.registry, type) ?? []) add(type, l)
    }
  }
  for (const type of Object.keys(current.schemas)) {
    for (const l of labelsOf(current, type) ?? []) add(type, l)
  }
  for (const r of history.renames) add(r.type, r.to)
  for (const r of pending.renames) add(r.type, r.to)

  const check = (
    entry: { type: string; from: string; to: string },
    file: string,
    after: string
  ): void => {
    if (!knownTypes.has(entry.type)) {
      errors.push({
        file,
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename after ${after} names type "${entry.type}", which no live version defines. ` +
          `Remove the entry, or restore the type.`,
      })
      return
    }
    const labels = knownLabels.get(entry.type)
    if (!labels || !labels.has(entry.from)) {
      errors.push({
        file,
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename after ${after} maps "${entry.from}" → "${entry.to}" on "${entry.type}", ` +
          `but no version ever exposed a field named "${entry.from}". ` +
          `Check for a typo, or remove the entry.`,
      })
    }
  }

  // A malformed `after` tag (e.g. "V1" from a hand-edit or merge resolution)
  // corrupts version comparison silently: parsed as -1, it applies to EVERY
  // version including the earliest, breaking the invariant that the earliest
  // version's fold is always empty. Catch it here, before the fold consumes it.
  for (const r of history.renames) {
    if (!AFTER_PATTERN.test(r.after)) {
      errors.push({
        file: 'schemas/versions/history.json',
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename entry has a malformed "after" tag "${r.after}" — expected a version like "v1". ` +
          `Fix the tag, or remove the entry.`,
      })
    }
  }

  for (const r of history.renames) check(r, 'schemas/versions/history.json', r.after)
  for (const r of pending.renames) check(r, 'schemas/versions/pending.json', currentVersion)

  return errors
}

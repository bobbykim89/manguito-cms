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

// ─── Windows, not a flat list ─────────────────────────────────────────────────
//
// Every rename sharing one `after` tag happened in the SAME window — between
// two cuts — and the entries in a window carry no order relative to one
// another: `version:cut` appends a hand-written block, and pending.json is one
// unordered block by construction. So a window's renames are applied
// SIMULTANEOUSLY, which the unwind expresses as "at most one substitution per
// window". Applying every match within a window instead made the result depend
// on array position: a field-name shift (`title→headline`, `subtitle→title`)
// folded correctly in one typing order and corrupted the model in the other,
// and a swap (`a→b`, `b→a`) corrupted in both.
//
// Simultaneity is what makes a within-window `from`/`to` overlap meaningless
// rather than merely order-dependent, so `validateRenameChain` rejects one
// outright — see the WITHIN-WINDOW SHAPE section below.

type RenameStep = { from: string; to: string }

/**
 * Rename windows that shaped `version`'s labels: those tagged after any OLDER
 * version, grouped by tag and ordered oldest-tag-first. Machine-appended
 * history is already chronological, but a merge resolution can interleave two
 * branches' appended blocks, so the order comes from the `after` tag itself
 * and never from array position.
 */
function renameWindowsBefore(
  version: string,
  history: VersionHistory,
  type: string
): RenameStep[][] {
  const target = versionNumber(version)
  const byTag = new Map<number, RenameStep[]>()

  for (const r of history.renames) {
    if (r.type !== type) continue
    const tag = versionNumber(r.after)
    if (tag >= target) continue
    const window = byTag.get(tag)
    if (window) window.push({ from: r.from, to: r.to })
    else byTag.set(tag, [{ from: r.from, to: r.to }])
  }

  return [...byTag.entries()].sort((a, b) => a[0] - b[0]).map(([, window]) => window)
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

  const windows = renameWindowsBefore(version, history, type)

  // pending.json is implicitly tagged "after the newest cut", so it shaped the
  // current version's labels and no earlier one's. It is the newest window.
  if (version === current) {
    const window = pending.renames.filter((r) => r.type === type).map((r) => ({ from: r.from, to: r.to }))
    if (window.length > 0) windows.push(window)
  }

  // Unwind newest window first, at most one substitution per window: each step
  // maps a later label back to its earlier one, and a window's steps are
  // simultaneous, so no second step in the same window can consume the result.
  let out = label
  for (let i = windows.length - 1; i >= 0; i--) {
    const step = windows[i]!.find((s) => s.to === out)
    if (step) out = step.from
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

// ─── WITHIN-WINDOW SHAPE ─────────────────────────────────────────────────────
//
// A window's renames apply simultaneously (see columnOf), so two shapes inside
// one window have no meaning the fold could honour:
//
//   - a repeated `to` — two fields cannot end the window under one label; and
//   - a label that is both a `from` and a `to`. Read as a chain (`a→b`, `b→c`)
//     it means the author collapsed two windows into one and should have
//     recorded the net `a→c`; read as a shift (`title→headline`,
//     `subtitle→title`) it is only expressible across two cuts. The two are
//     structurally indistinguishable without the window's start labels — which
//     a retired version no longer supplies — so neither is accepted.
//
// Before windowing, these folded silently and array-order-dependently: a shift
// produced two fields carrying one column and a projection serving one column
// under two labels, with `ok: true`. Rejecting the shape keeps that loud.
function checkWindowShape(
  window: Array<{ from: string; to: string }>,
  type: string,
  file: string,
  after: string
): ParseError[] {
  const errors: ParseError[] = []
  const tos = new Set<string>()
  const froms = new Set(window.map((r) => r.from))

  for (const r of window) {
    if (tos.has(r.to)) {
      errors.push({
        file,
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Two renames after ${after} on "${type}" both rename a field to "${r.to}". ` +
          `Renames in one window apply together, so two fields cannot end up sharing a label. ` +
          `Keep one of the entries, or give them distinct targets.`,
      })
    }
    tos.add(r.to)
  }

  for (const r of window) {
    if (!froms.has(r.to)) continue
    errors.push({
      file,
      code: 'RENAME_CHAIN_BROKEN',
      message:
        `Rename after ${after} on "${type}" maps "${r.from}" → "${r.to}", but "${r.to}" is also renamed ` +
        `away in the same window. Renames in one window apply together, so a label cannot be both a ` +
        `source and a target. If this is a two-step chain, record the net rename instead ` +
        `(e.g. "${r.from}" → the label it ends up as). If two fields are genuinely trading labels, ` +
        `cut a version between the two renames so each lands in its own window.`,
    })
  }

  return errors
}

/** Groups renames into the windows the fold applies them in: one window per (type, `after` tag). */
function groupIntoWindows<T extends { type: string; from: string; to: string }>(
  renames: T[],
  tagOf: (r: T) => string
): Array<{ type: string; after: string; window: Array<{ from: string; to: string }> }> {
  const groups = new Map<string, { type: string; after: string; window: Array<{ from: string; to: string }> }>()
  for (const r of renames) {
    const after = tagOf(r)
    const key = `${r.type}::${after}`
    const group = groups.get(key)
    if (group) group.window.push({ from: r.from, to: r.to })
    else groups.set(key, { type: r.type, after, window: [{ from: r.from, to: r.to }] })
  }
  return [...groups.values()]
}

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
      continue
    }
    // A well-formed but out-of-range tag is just as corrupting, only later:
    // `version:cut` only ever writes a tag BELOW current, so a tag at or above
    // current names a window that cannot have happened. It surfaces as
    // AMBIGUOUS_RENAME only while the version holding the old label survives —
    // once that retires it becomes a silently wrong column.
    if (versionNumber(r.after) >= versionNumber(currentVersion)) {
      errors.push({
        file: 'schemas/versions/history.json',
        code: 'RENAME_CHAIN_BROKEN',
        message:
          `Rename entry is tagged "after": "${r.after}", but the current version is ${currentVersion} — ` +
          `a rename can only follow a version that has already been cut. Fix the tag, or move the entry ` +
          `to schemas/versions/pending.json if it has not been cut yet.`,
      })
    }
  }

  for (const { type, after, window } of groupIntoWindows(history.renames, (r) => r.after)) {
    errors.push(...checkWindowShape(window, type, 'schemas/versions/history.json', after))
  }
  for (const { type, window } of groupIntoWindows(pending.renames, () => currentVersion)) {
    errors.push(...checkWindowShape(window, type, 'schemas/versions/pending.json', currentVersion))
  }

  for (const r of history.renames) check(r, 'schemas/versions/history.json', r.after)
  for (const r of pending.renames) check(r, 'schemas/versions/pending.json', currentVersion)

  return errors
}

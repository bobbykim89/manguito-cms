import type { ParseError } from '../parser/loader.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { ParsedField } from '../registry/types.js'
import type { PendingChanges, VersionHistory, VersionProjection, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'
import { isColumnBacked } from '../registry/columns.js'

// ─── Shared lookups ─────────────────────────────────────────────────────────

/** A type's fields, whichever map (content or taxonomy) actually holds it. */
function fieldsOf(registry: SchemaRegistry, type: string): ParsedField[] | undefined {
  return registry.content_types[type]?.fields ?? registry.taxonomy_types[type]?.fields
}

/** Every type name current or any snapshot defines, content and taxonomy alike. */
function allTypeNames(current: SchemaRegistry, snapshots: VersionSnapshot[]): string[] {
  const names = new Set<string>()
  for (const t of Object.keys(current.content_types)) names.add(t)
  for (const t of Object.keys(current.taxonomy_types)) names.add(t)
  for (const snap of snapshots) {
    for (const t of Object.keys(snap.registry.content_types)) names.add(t)
    for (const t of Object.keys(snap.registry.taxonomy_types)) names.add(t)
  }
  return [...names]
}

function findFieldByLabel(registry: SchemaRegistry, type: string, label: string): ParsedField | undefined {
  return fieldsOf(registry, type)?.find((f) => f.name === label)
}

/** column-backed fields of a type, keyed by their fold-derived COLUMN (not label). */
function columnMapOf(
  registry: SchemaRegistry,
  type: string,
  version: string,
  input: { live: string[]; history: VersionHistory; pending: PendingChanges; current: string }
): Map<string, ParsedField> {
  const map = new Map<string, ParsedField>()
  for (const f of fieldsOf(registry, type) ?? []) {
    if (!isColumnBacked(f)) continue
    const col = columnOf({ label: f.name, type, version, ...input })
    map.set(col, f)
  }
  return map
}

// ─── AMBIGUOUS_RENAME ───────────────────────────────────────────────────────
//
// A column present in a live snapshot but absent from current's column set is
// a candidate for an undeclared rename. `columnOf` already folds any declared
// rename chain into a single identity, so if the old label was really renamed
// forward to a label current still exposes, both resolve to the SAME column
// and the column is never "missing" in the first place — condition (b), "no
// rename chain maps it forward," falls out of the column comparison for free
// and needs no separate check.
//
// A missing column is only reported when BOTH:
//   - a column current exposes did NOT exist in that same snapshot (genuinely
//     new, not merely still-present) — this is condition (c)'s "appeared", and
//   - that new column's field_type matches the missing column's field_type —
//     the rest of condition (c).
// Dropping either half turns an ordinary field removal (nothing of matching
// shape appeared) or an unrelated addition (wrong type) into a false alarm.
//
// A drop declared in EITHER history.drops or pending.drops suppresses the
// report outright: the ambiguity is resolved by hand, not by guessing. Per
// the design spec (2026-08-30-version-model-core-design.md:97), a drop is
// keyed "<type>.<label>" — the label AS IT STOOD WHEN REMOVED, which is what
// an author reads and writes, unlike a fallback which keys by column because
// a renamed-then-dropped field has no unambiguous label.
//
// A column can be exposed by more than one live snapshot under more than one
// label (renamed once, then dropped): fold every snapshot's fields down to
// column first, keeping only the MOST RECENT live version's label per
// column, before ever building a message. That single resolved label is then
// used for BOTH the message text and the drops match — one source, so they
// cannot drift apart the way a per-snapshot loop let them.
function checkAmbiguousRenames(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const errors: ParseError[] = []
  const foldInput = { live, history, pending, current: currentVersion }

  // Keyed "<type>.<label>", per the spec — never the fold-derived column.
  const droppedLabels = new Set<string>([
    ...history.drops.map((d) => d.field),
    ...pending.drops,
  ])

  // `live` is documented oldest-first, so position in it is recency order.
  const liveOrder = new Map(live.map((v, i) => [v, i]))

  for (const typeName of allTypeNames(current, snapshots)) {
    const currentByColumn = columnMapOf(current, typeName, currentVersion, foldInput)
    const currentColumns = new Set(currentByColumn.keys())

    // One entry per column across ALL live snapshots, keeping whichever
    // exposed it most recently — the label an author looking at the schema
    // today would actually recognize, not a stale earlier one.
    const historicalByColumn = new Map<string, { version: string; field: ParsedField }>()
    for (const snap of snapshots) {
      const snapByColumn = columnMapOf(snap.registry, typeName, snap.version, foldInput)
      const snapRank = liveOrder.get(snap.version) ?? -1
      for (const [col, field] of snapByColumn) {
        const existing = historicalByColumn.get(col)
        if (!existing || snapRank > (liveOrder.get(existing.version) ?? -1)) {
          historicalByColumn.set(col, { version: snap.version, field })
        }
      }
    }

    // Genuinely new: a column no live snapshot ever exposed under any label.
    const newColumns = [...currentByColumn.entries()].filter(([col]) => !historicalByColumn.has(col))

    for (const [col, { version, field: oldField }] of historicalByColumn) {
      if (currentColumns.has(col)) continue // still exposed (directly or via a declared rename)
      if (droppedLabels.has(`${typeName}.${oldField.name}`)) continue // declared drop, by label

      // Exactly one message per ambiguous column: the first same-typed
      // candidate is enough to report the ambiguity, and there is only ever
      // one canonical label to name for this column.
      const match = newColumns.find(([, newField]) => newField.field_type === oldField.field_type)
      if (!match) continue // condition (c) needs a same-typed field to have appeared

      const [, newField] = match
      errors.push({
        file: 'schemas/versions/pending.json',
        code: 'AMBIGUOUS_RENAME',
        message:
          `Field "${oldField.name}" on "${typeName}" is exposed by ${version} but is gone from the ` +
          `current schema, and a new ${newField.field_type} field "${newField.name}" appeared. This is either a ` +
          `rename or a removal, and the two cannot be told apart.\n` +
          `  If it was renamed, add to schemas/versions/pending.json:\n` +
          `    { "type": "${typeName}", "from": "${oldField.name}", "to": "${newField.name}" }  (under "renames")\n` +
          `  If it was removed, add to schemas/versions/pending.json:\n` +
          `    "${typeName}.${oldField.name}"  (under "drops")`,
      })
    }
  }

  return errors
}

// ─── FIELD_TYPE_CHANGED_WHILE_LIVE ──────────────────────────────────────────
//
// A column a live snapshot still exposes must mean the same thing in current
// as it did there — an old API consumer pinned to that version reads the
// column expecting its old field_type. If the label was renamed but the
// column (fold-derived identity) is unchanged, this still applies; only the
// underlying field_type is compared.
function checkFieldTypeChangedWhileLive(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const errors: ParseError[] = []
  const foldInput = { live, history, pending, current: currentVersion }

  for (const typeName of allTypeNames(current, snapshots)) {
    const currentByColumn = columnMapOf(current, typeName, currentVersion, foldInput)

    for (const snap of snapshots) {
      if (!live.includes(snap.version)) continue

      const snapByColumn = columnMapOf(snap.registry, typeName, snap.version, foldInput)

      for (const [col, oldField] of snapByColumn) {
        const currentField = currentByColumn.get(col)
        if (!currentField) continue // dropped or ambiguous — not this check's concern
        if (currentField.field_type === oldField.field_type) continue

        errors.push({
          file: 'schemas/versions/history.json',
          code: 'FIELD_TYPE_CHANGED_WHILE_LIVE',
          message:
            `Column "${col}" on "${typeName}" is exposed by live version ${snap.version} as ` +
            `${oldField.field_type}, but the current schema now types it ${currentField.field_type}. ` +
            `A live version's contract cannot change type under its consumers — retire ${snap.version} first, ` +
            `or keep the field's type stable and introduce the change as a new column instead.`,
        })
      }
    }
  }

  return errors
}

// ─── UNRENAMEABLE_FIELD_KIND ────────────────────────────────────────────────
//
// The fold only makes sense for column-backed fields — a paragraph field (or
// any field union.ts's isColumnBacked rejects) has no column, so its label
// already IS its identity. A rename entry naming one is never meaningful:
// look the rename's endpoints up across every live registry (whichever side
// still exists tells us the field's kind) and flag it if what's found isn't
// column-backed.
function checkUnrenameableFieldKind(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  const { current, currentVersion, snapshots, history, pending } = input
  const errors: ParseError[] = []

  const registries: SchemaRegistry[] = [current, ...snapshots.map((s) => s.registry)]

  const findByEitherLabel = (type: string, from: string, to: string): ParsedField | undefined => {
    for (const registry of registries) {
      const found = findFieldByLabel(registry, type, from) ?? findFieldByLabel(registry, type, to)
      if (found) return found
    }
    return undefined
  }

  const check = (entry: { type: string; from: string; to: string }, file: string, after: string): void => {
    const field = findByEitherLabel(entry.type, entry.from, entry.to)
    if (!field || isColumnBacked(field)) return // not found is RENAME_CHAIN_BROKEN's concern, not this one's

    errors.push({
      file,
      code: 'UNRENAMEABLE_FIELD_KIND',
      message:
        `Rename after ${after} maps "${entry.from}" → "${entry.to}" on "${entry.type}", but that field is a ` +
        `${field.field_type} field with no backing column. Only column-backed fields can be renamed across ` +
        `versions — a ${field.field_type} field's label already is its identity. Remove the entry.`,
    })
  }

  for (const r of history.renames) check(r, 'schemas/versions/history.json', r.after)
  for (const r of pending.renames) check(r, 'schemas/versions/pending.json', currentVersion)

  return errors
}

// ─── VERSION_RETENTION_UNSUPPORTED ──────────────────────────────────────────
//
// Retention has a boundary, and this check is the boundary made loud.
// `buildUnionRegistry` retains columns only within content and taxonomy types
// that CURRENT still defines: unionTypeMap iterates current's map, and
// paragraph_types is passed through untouched. So without this check:
//
//   - a type a live version exposes but current deleted vanishes from the
//     union while `projections[thatVersion].types` still exposes it — the two
//     halves of one model disagreeing about the same live version; and
//   - a paragraph type's field removed from current takes its column out of
//     the union although a live version still serves it.
//
// Whether paragraph tables participate in versioning at all is a design
// question the spec never settled (it restricted RENAMES to column-backed
// fields but said nothing about paragraph types' own columns), and it is
// settled deliberately in 2b/2e rather than improvised here. Until then a
// project in one of these shapes gets a refusal naming the recourse, never a
// union that quietly omits live storage — which is what would drop a column
// still being served the next time db codegen ran.
//
// The code is its own: nothing is malformed and no rename is involved, so the
// rename codes would misdirect, and VERSION_SNAPSHOT_INVALID would blame a
// snapshot that parsed perfectly. This says what is true — the model cannot
// carry what this live version needs, in this release.
function checkUnretainableLiveSurface(input: {
  current: SchemaRegistry
  snapshots: VersionSnapshot[]
}): ParseError[] {
  const { current, snapshots } = input
  const errors: ParseError[] = []

  const missingType = (version: string, typeName: string, kind: string): ParseError => ({
    file: `schemas/versions/${version}`,
    code: 'VERSION_RETENTION_UNSUPPORTED',
    message:
      `Live version ${version} exposes ${kind} "${typeName}", which the current schema no longer ` +
      `defines. The union registry retains individual columns, not whole types, so ${version}'s ` +
      `storage for "${typeName}" would not be carried. Restore the type to the current schema, or ` +
      `retire ${version} first.`,
  })

  for (const snap of snapshots) {
    for (const typeName of Object.keys(snap.registry.content_types)) {
      if (!current.content_types[typeName]) errors.push(missingType(snap.version, typeName, 'content type'))
    }
    for (const typeName of Object.keys(snap.registry.taxonomy_types)) {
      if (!current.taxonomy_types[typeName]) errors.push(missingType(snap.version, typeName, 'taxonomy type'))
    }

    // Paragraph types are compared by raw column name, with no fold: a rename
    // of a paragraph type's own field is not honoured anywhere in this module,
    // so folding here would invent a mapping the union does not implement.
    for (const [typeName, snapType] of Object.entries(snap.registry.paragraph_types)) {
      const currentType = current.paragraph_types[typeName]
      if (!currentType) {
        errors.push(missingType(snap.version, typeName, 'paragraph type'))
        continue
      }
      const currentColumns = new Set(
        currentType.fields.filter(isColumnBacked).map((f) => f.db_column!.column_name)
      )
      for (const f of snapType.fields) {
        if (!isColumnBacked(f)) continue
        const col = f.db_column!.column_name
        if (currentColumns.has(col)) continue
        errors.push({
          file: `schemas/versions/${snap.version}`,
          code: 'VERSION_RETENTION_UNSUPPORTED',
          message:
            `Live version ${snap.version} exposes column "${col}" on paragraph type "${typeName}", ` +
            `which the current schema no longer defines. Paragraph types do not take part in column ` +
            `retention, so that column would not be carried into the union registry. Restore the field ` +
            `to the current schema, or retire ${snap.version} first.`,
        })
      }
    }
  }

  return errors
}

// ─── VERSION_MODEL_INCONSISTENT ─────────────────────────────────────────────
//
// A structural invariant checked AFTER construction, on the built model rather
// than on its inputs: within one type, one column is backed by exactly one
// field, and one projection exposes one column under exactly one label.
//
// Nothing upstream guaranteed this. The rename fold could collapse two labels
// onto one column — that is how the pre-windowing shift bug produced a union
// with two fields carrying column `subtitle` and a projection serving it under
// two labels, and it still returned `ok: true`. The inputs are now validated
// well enough that no known path reaches here, which is exactly why the check
// belongs: it converts the whole class of "two labels, one column" defect from
// silent to loud, whatever future input shape or codegen consumer produces it.
//
// The code is deliberately NOT one of the rename codes: the cause may be a
// rename chain, a snapshot, or a bug in this module, so a message telling the
// author to fix a rename entry would frequently be wrong. VERSION_MODEL_INCONSISTENT
// says what is known — the model this module built does not hold together.
// Runs after construction, unlike validateVersionModel, which runs on the
// inputs before anything is built.
export function validateModelStructure(input: {
  union: SchemaRegistry
  projections: Record<string, VersionProjection>
}): ParseError[] {
  const { union, projections } = input
  const errors: ParseError[] = []

  const typeMaps = [union.content_types, union.taxonomy_types]
  for (const map of typeMaps) {
    for (const [typeName, type] of Object.entries(map)) {
      const byColumn = new Map<string, string>()
      for (const f of type.fields) {
        if (!isColumnBacked(f)) continue
        const col = f.db_column!.column_name
        const owner = byColumn.get(col)
        if (owner !== undefined) {
          errors.push({
            // Attributed to pending.json, the file an author edits — as
            // AMBIGUOUS_RENAME is — though a hand-edited history.json can
            // equally be the cause, which the message names.
            file: 'schemas/versions/pending.json',
            code: 'VERSION_MODEL_INCONSISTENT',
            message:
              `The union registry gives "${typeName}" two fields backed by column "${col}" ` +
              `("${owner}" and "${f.name}"). One column backs exactly one field — a column cannot ` +
              `store two fields' values. Check this type's renames in pending.json and history.json: two ` +
              `labels folding to one column is what produces this.`,
          })
          continue
        }
        byColumn.set(col, f.name)
      }
    }
  }

  for (const [version, projection] of Object.entries(projections)) {
    for (const [typeName, type] of Object.entries(projection.types)) {
      const byColumn = new Map<string, string>()
      for (const f of type.fields) {
        const owner = byColumn.get(f.column_name)
        if (owner !== undefined) {
          errors.push({
            file: 'schemas/versions/pending.json',
            code: 'VERSION_MODEL_INCONSISTENT',
            message:
              `Version ${version}'s projection of "${typeName}" exposes column "${f.column_name}" under ` +
              `two labels ("${owner}" and "${f.exposed_as}"). One column is exposed once per version — ` +
              `serving it twice would give two API fields the same underlying value. Check this type's ` +
              `renames in pending.json and history.json.`,
          })
          continue
        }
        byColumn.set(f.column_name, f.exposed_as)
      }
    }
  }

  return errors
}

// ─── validateVersionModel ────────────────────────────────────────────────────

export function validateVersionModel(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): ParseError[] {
  return [
    ...checkAmbiguousRenames(input),
    ...checkFieldTypeChangedWhileLive(input),
    ...checkUnrenameableFieldKind(input),
    ...checkUnretainableLiveSurface(input),
  ]
}

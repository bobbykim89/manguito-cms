import type { SchemaRegistry } from '../parser/validate.js'
import type { PendingChanges, VersionHistory, VersionProjection, VersionSnapshot } from './types.js'
import { columnOf } from './fold.js'
import { isColumnBacked } from './union.js'

// What each live version exposes: per type, each column and the label THAT
// version exposes it under. The current version's projection is the identity
// only when no rename applies to it (the zero-config case, with no
// pending.json rename in effect) — that's why the api layer needs no special
// case for an unversioned project. A pending rename still in effect between
// cuts makes even the current version's projection diverge from identity.
export function buildProjections(input: {
  current: SchemaRegistry
  currentVersion: string
  snapshots: VersionSnapshot[]
  live: string[]
  history: VersionHistory
  pending: PendingChanges
}): Record<string, VersionProjection> {
  const { current, currentVersion, snapshots, live, history, pending } = input
  const byVersion: Array<{ version: string; registry: SchemaRegistry }> = [
    ...snapshots,
    { version: currentVersion, registry: current },
  ]

  // Both files' fallbacks, pending winning on a shared key. The pending window
  // is exactly when a fallback is needed: the field is already out of the
  // working schema, so every row written from now on puts null in a column an
  // older live version still serves. Reading only history.fallbacks made a
  // fallback declared alongside a `drops` entry — the pairing the spec's own
  // pending.json example shows — silently inert until the next cut.
  const fallbacks: Record<string, unknown> = { ...history.fallbacks, ...pending.fallbacks }

  const out: Record<string, VersionProjection> = {}

  for (const { version, registry } of byVersion) {
    const types: VersionProjection['types'] = {}

    for (const [typeName, type] of [
      ...Object.entries(registry.content_types),
      ...Object.entries(registry.taxonomy_types),
    ]) {
      const fields = type.fields.filter(isColumnBacked).map((f) => {
        const column_name = columnOf({
          label: f.name, type: typeName, version,
          live, history, pending, current: currentVersion,
        })
        const fallback = fallbacks[`${typeName}.${column_name}`]
        // `fallback` is omitted entirely rather than set undefined, so the
        // identity case deep-equals cleanly in tests and over the wire.
        return fallback === undefined
          ? { column_name, exposed_as: f.name }
          : { column_name, exposed_as: f.name, fallback }
      })
      types[typeName] = { fields }
    }

    out[version] = { version, types }
  }

  return out
}

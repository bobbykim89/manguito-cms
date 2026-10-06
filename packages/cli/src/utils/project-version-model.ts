import {
  loadVersionSnapshots,
  computeVersionModel,
  type Result,
  type ResolvedSchemaConfig,
  type SchemaRegistry,
  type VersionModel,
  type VersionSnapshot,
} from '@bobbykim/manguito-cms-core'

/**
 * The project's version model: its snapshots, then the model computed from
 * them and the working registry. Every command that needs the model comes
 * through here (validate, build, dev and the version:* commands), so no two
 * commands can disagree about which schemas are valid. That disagreement is
 * how validate came to pass schemas build rejected.
 *
 * Returns errors instead of printing or exiting. validate collects them with
 * every other error it found; build, dev and the version commands print them
 * and stop. The model is computed only once the snapshots loaded: a model
 * built from part of the snapshot set would report errors that are not real.
 */
export function loadProjectVersionModel(
  schema: ResolvedSchemaConfig,
  registry: SchemaRegistry
): Result<{ snapshots: VersionSnapshot[]; model: VersionModel }> {
  const snapshots = loadVersionSnapshots(schema, registry)
  if (!snapshots.ok) return snapshots
  const model = computeVersionModel({ current: registry, snapshots: snapshots.value })
  if (!model.ok) return model
  return { ok: true, value: { snapshots: snapshots.value, model: model.value } }
}

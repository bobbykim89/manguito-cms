import type { MediaRepository, ParsedField } from '@bobbykim/manguito-cms-core'

// ─── Media reference tracking ─────────────────────────────────────────────────
//
// Reconciles media.reference_count on a content write. reference_count counts
// *content items* that reference a media row (see CONTEXT.md "Orphaned media"
// and docs/adr/api/0007), not reference slots — so a media id used by several
// fields/paragraphs of one item counts once, and an id moved between slots in
// one write is a no-op.
//
// A write produces a MediaDelta of the ids it gains and loses. Top-level field
// deltas are computed here (pure); paragraph deltas are produced by the paragraph
// persistence path and merged in. The merged delta is applied once.

export type MediaDelta = {
  added: string[]
  removed: string[]
}

// A media field holds a raw id string (not a resolved { id, url } object) on the
// content/paragraph row. Empty string and non-strings mean "no media".
function extractMediaId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// Media ids gained and lost between two content states for the top-level media
// fields. Unifies all three writes:
//   create — before = null            (no prior ids; set fields are added)
//   update — before/after are rows     (a field absent from `after` is untouched)
//   delete — after = null              (every current id is removed)
export function topLevelMediaDelta(
  mediaFields: ParsedField[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): MediaDelta {
  const added: string[] = []
  const removed: string[] = []

  for (const f of mediaFields) {
    // On a partial update, a media field not present in the patch body is untouched.
    // (after === null is a delete — every field is in scope.)
    if (after !== null && !(f.name in after)) continue

    const oldId = before ? extractMediaId(before[f.name]) : null
    const newId = after ? extractMediaId(after[f.name]) : null
    if (newId === oldId) continue
    if (oldId) removed.push(oldId)
    if (newId) added.push(newId)
  }

  return { added, removed }
}

// Combine the top-level delta with each paragraph field's delta into one delta.
export function mergeMediaDeltas(...deltas: MediaDelta[]): MediaDelta {
  return {
    added: deltas.flatMap((d) => d.added),
    removed: deltas.flatMap((d) => d.removed),
  }
}

// Apply a delta to reference counts, per content item:
//   - dedup each side (an id referenced by many slots counts once)
//   - cancel ids that are both added and removed (moved between slots → no-op)
//   - skip the repo call when a side is empty
export async function applyMediaReferenceDelta(
  delta: MediaDelta,
  mediaRepo: MediaRepository
): Promise<void> {
  const added = new Set(delta.added)
  const removed = new Set(delta.removed)

  const netAdd = [...added].filter((id) => !removed.has(id))
  const netRemove = [...removed].filter((id) => !added.has(id))

  if (netAdd.length > 0) await mediaRepo.incrementReferenceCount(netAdd)
  if (netRemove.length > 0) await mediaRepo.decrementReferenceCount(netRemove)
}

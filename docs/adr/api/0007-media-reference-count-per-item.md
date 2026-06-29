---
status: accepted
---

# media.reference_count counts content items, not reference slots

A media row's `reference_count` is the number of **content items** that reference it, not the number of field/paragraph slots pointing at it. So the media reference tracking module reconciles each content write exactly once: it dedups the media ids a write adds and removes, and cancels any id that is both added and removed in the same write (a media id moved between two slots of one item is a no-op). A media item is orphaned — eligible for cleanup — when no content item references it (`reference_count = 0`), which only holds under the per-item rule.

## Considered Options

- **Per reference slot** (every field/paragraph occurrence increments) — rejected: it contradicts the documented meaning ("how many content items reference this media"), and it lets one content item drive `reference_count` above 1, so a media row can read as non-orphaned after every referencing item is gone. The earlier code did this incidentally by incrementing top-level and paragraph media in separate calls.

## Consequences

- Reconciliation must see the whole write before applying — `topLevelMediaDelta` (top-level fields) and the paragraph persistence deltas are merged, then `applyMediaReferenceDelta` dedups/cancels and issues at most one increment and one decrement.
- This is hard to reverse once data accumulates: counts in the DB reflect the per-item rule, so switching to per-slot later would require a backfill. A future reader tempted to "fix" the dedup back to per-occurrence should reopen this ADR instead.

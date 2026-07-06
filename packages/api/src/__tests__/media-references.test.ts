import { describe, it, expect, vi } from 'vitest'
import type { MediaRepository, ParsedField } from '@bobbykim/manguito-cms-core'
import {
  topLevelMediaDelta,
  mergeMediaDeltas,
  applyMediaReferenceDelta,
  type MediaDelta,
} from '../media-references'

// One image field named "cover".
const coverField: ParsedField = {
  name: 'cover',
  label: 'Cover',
  field_type: 'image',
  required: false,
  nullable: true,
  order: 0,
  validation: { required: false, allowed_mime_types: ['image/jpeg'] },
  db_column: {
    column_name: 'cover',
    column_type: 'uuid',
    nullable: true,
    foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
  },
  ui_component: { component: 'file-upload', accepted_mime_types: ['image/*'] },
}

const bannerField: ParsedField = { ...coverField, name: 'banner', db_column: { ...coverField.db_column!, column_name: 'banner' } }
const fields = [coverField, bannerField]

// ─── topLevelMediaDelta — create / update / delete in one shape ───────────────

describe('topLevelMediaDelta', () => {
  it('create (before = null) — every set media id is added, nothing removed', () => {
    const d = topLevelMediaDelta(fields, null, { cover: 'media-a' })
    expect(d).toEqual({ added: ['media-a'], removed: [] })
  })

  it('create — a media field left unset contributes nothing', () => {
    const d = topLevelMediaDelta(fields, null, { cover: '', banner: 'media-b' })
    expect(d).toEqual({ added: ['media-b'], removed: [] })
  })

  it('update — replacing an id removes the old and adds the new', () => {
    const d = topLevelMediaDelta(fields, { cover: 'media-old' }, { cover: 'media-new' })
    expect(d).toEqual({ added: ['media-new'], removed: ['media-old'] })
  })

  it('update — resending the same id is a no-op', () => {
    const d = topLevelMediaDelta(fields, { cover: 'media-a' }, { cover: 'media-a' })
    expect(d).toEqual({ added: [], removed: [] })
  })

  it('update — clearing a field only removes the old id', () => {
    const d = topLevelMediaDelta(fields, { cover: 'media-old' }, { cover: '' })
    expect(d).toEqual({ added: [], removed: ['media-old'] })
  })

  it('update — a field absent from the patch body is untouched', () => {
    const d = topLevelMediaDelta(fields, { cover: 'media-old' }, { banner: 'media-b' })
    expect(d).toEqual({ added: ['media-b'], removed: [] })
  })

  it('delete (after = null) — every current media id is removed', () => {
    const d = topLevelMediaDelta(fields, { cover: 'media-a', banner: 'media-b' }, null)
    expect(d).toEqual({ added: [], removed: ['media-a', 'media-b'] })
  })
})

// ─── mergeMediaDeltas ─────────────────────────────────────────────────────────

describe('mergeMediaDeltas', () => {
  it('concatenates the added and removed lists of every delta', () => {
    const a: MediaDelta = { added: ['x'], removed: ['y'] }
    const b: MediaDelta = { added: ['z'], removed: [] }
    expect(mergeMediaDeltas(a, b)).toEqual({ added: ['x', 'z'], removed: ['y'] })
  })

  it('returns an empty delta when given nothing', () => {
    expect(mergeMediaDeltas()).toEqual({ added: [], removed: [] })
  })
})

// ─── applyMediaReferenceDelta — per content item: dedup, cancel, guard ────────

function mockRepo() {
  return {
    incrementReferenceCount: vi.fn(async () => {}),
    decrementReferenceCount: vi.fn(async () => {}),
  } as unknown as MediaRepository & {
    incrementReferenceCount: ReturnType<typeof vi.fn>
    decrementReferenceCount: ReturnType<typeof vi.fn>
  }
}

describe('applyMediaReferenceDelta', () => {
  it('increments added and decrements removed', async () => {
    const repo = mockRepo()
    await applyMediaReferenceDelta({ added: ['new'], removed: ['old'] }, repo)
    expect(repo.incrementReferenceCount).toHaveBeenCalledWith(['new'])
    expect(repo.decrementReferenceCount).toHaveBeenCalledWith(['old'])
  })

  it('does not call the repo when a side is empty', async () => {
    const repo = mockRepo()
    await applyMediaReferenceDelta({ added: ['a'], removed: [] }, repo)
    expect(repo.incrementReferenceCount).toHaveBeenCalledWith(['a'])
    expect(repo.decrementReferenceCount).not.toHaveBeenCalled()
  })

  it('does nothing at all for an empty delta', async () => {
    const repo = mockRepo()
    await applyMediaReferenceDelta({ added: [], removed: [] }, repo)
    expect(repo.incrementReferenceCount).not.toHaveBeenCalled()
    expect(repo.decrementReferenceCount).not.toHaveBeenCalled()
  })

  it('per content item: a media id referenced by several slots increments once', async () => {
    const repo = mockRepo()
    await applyMediaReferenceDelta({ added: ['m', 'm', 'm'], removed: [] }, repo)
    expect(repo.incrementReferenceCount).toHaveBeenCalledWith(['m'])
  })

  it('cancels an id that is both added and removed in one write (moved between slots)', async () => {
    const repo = mockRepo()
    await applyMediaReferenceDelta({ added: ['m', 'kept'], removed: ['m', 'gone'] }, repo)
    expect(repo.incrementReferenceCount).toHaveBeenCalledWith(['kept'])
    expect(repo.decrementReferenceCount).toHaveBeenCalledWith(['gone'])
  })
})

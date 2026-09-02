import { describe, it, expect } from 'vitest'
import { computeVersionModel } from '../compute'
import { makeContentType, makeParagraphType, makeRegistry } from './fixtures'
import type { VersionSnapshot } from '../types'

function snapshot(version: string, schemas: Parameters<typeof makeRegistry>[0]): VersionSnapshot {
  return { version, registry: makeRegistry(schemas) }
}

function errorsOf(current: ReturnType<typeof makeRegistry>, snapshots: VersionSnapshot[]) {
  const result = computeVersionModel({ current, snapshots })
  if (result.ok) return []
  return result.errors.map((e) => ({ code: e.code, message: e.message }))
}

describe('VERSION_COLUMN_MISSING', () => {
  it('fires when a forgotten column override leaves a live version exposing nothing', () => {
    // v1 exposes column `blog_title`. Current renamed the field to `title` but
    // forgot `"column": "blog_title"`, so current's only column is `title` and
    // v1's column has vanished from the union.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    const err = errors.find((e) => e.code === 'VERSION_COLUMN_MISSING')
    expect(err).toBeDefined()
    // Both fixes must appear, verbatim enough to paste. 2a shipped an error
    // whose suggested fix did not suppress it; the two tests below prove each
    // of these actually does.
    expect(err!.message).toContain('"column": "blog_title"')
    expect(err!.message).toContain('"removed": true')
  })

  it('is suppressed by declaring the column — the first fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('is suppressed by a tombstone — the second fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_title', removed: true },
        ]),
      ]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('fires when current deleted a type a live version still exposes, naming the type', () => {
    // The derived model refused this with VERSION_RETENTION_UNSUPPORTED
    // because it could not reconstruct a deleted type. Stating retention turns
    // it into an ordinary completeness failure with an actionable fix.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'title' }]),
        makeContentType('content--old_thing', [{ name: 'x' }]),
      ])]
    )
    const err = errors.find((e) => e.code === 'VERSION_COLUMN_MISSING')
    expect(err).toBeDefined()
    expect(err!.message).toContain('content--old_thing')
  })

  it('does not fire for a field no live version ever exposed', () => {
    // A field added to current only. Nothing older exposes it, so there is
    // nothing to be complete about.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }, { name: 'subtitle' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'title' }])])]
    )
    expect(errors).toEqual([])
  })

  it('does not fire in the zero-config case', () => {
    const errors = errorsOf(makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]), [])
    expect(errors).toEqual([])
  })
})

describe('VERSION_COLUMN_MISSING — paragraph types', () => {
  // Paragraph types never appear in a VersionProjection (that boundary is
  // deliberately left undesigned), so these go straight at
  // checkUnionCompleteness's paragraph arm, which compares a snapshot's
  // paragraph_types directly against current's rather than through a
  // projection.

  it("fires when a live version's paragraph type loses a column from current", () => {
    // Same shape as the content-type case above: v1 exposes column
    // `blog_caption`. Current renamed the field to `caption` but forgot
    // "column": "blog_caption", so the column vanished from the union.
    const errors = errorsOf(
      makeRegistry([makeParagraphType('paragraph--photo_card', [{ name: 'caption' }])]),
      [snapshot('v1', [makeParagraphType('paragraph--photo_card', [{ name: 'blog_caption' }])])]
    )
    const err = errors.find((e) => e.code === 'VERSION_COLUMN_MISSING')
    expect(err).toBeDefined()
    expect(err!.message).toContain('"column": "blog_caption"')
    expect(err!.message).toContain('"removed": true')
  })

  it('is suppressed by declaring the column — the first fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([
        makeParagraphType('paragraph--photo_card', [{ name: 'caption', column: 'blog_caption' }]),
      ]),
      [snapshot('v1', [makeParagraphType('paragraph--photo_card', [{ name: 'blog_caption' }])])]
    )
    expect(errors).toEqual([])
  })

  it('is suppressed by a tombstone — the second fix the message names', () => {
    const errors = errorsOf(
      makeRegistry([
        makeParagraphType('paragraph--photo_card', [
          { name: 'caption' },
          { name: 'blog_caption', removed: true },
        ]),
      ]),
      [snapshot('v1', [makeParagraphType('paragraph--photo_card', [{ name: 'blog_caption' }])])]
    )
    expect(errors).toEqual([])
  })

  it('fires when the whole paragraph type is gone from current, naming the type', () => {
    // The derived model refused this with VERSION_RETENTION_UNSUPPORTED
    // because it could not reconstruct a deleted paragraph type at all — it
    // never walked paragraph_types in the first place.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title' }])]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'title' }]),
        makeParagraphType('paragraph--old_card', [{ name: 'x' }]),
      ])]
    )
    const err = errors.find(
      (e) => e.code === 'VERSION_COLUMN_MISSING' && e.message.includes('paragraph--old_card')
    )
    expect(err).toBeDefined()
  })

  it('does not fire for a paragraph field no live version ever exposed', () => {
    // A field added to current's paragraph type only. Nothing older exposes
    // it, so there is nothing to be complete about.
    const errors = errorsOf(
      makeRegistry([
        makeParagraphType('paragraph--photo_card', [{ name: 'caption' }, { name: 'alt_text' }]),
      ]),
      [snapshot('v1', [makeParagraphType('paragraph--photo_card', [{ name: 'caption' }])])]
    )
    expect(errors).toEqual([])
  })

  it('does not fire for a non-column-backed field inside a paragraph type', () => {
    // A paragraph type's own `paragraph` field has no column at all (the
    // association lives on the child's own row), so there is nothing to
    // retain and nothing to report even though current does not define it.
    const errors = errorsOf(
      makeRegistry([makeParagraphType('paragraph--gallery', [{ name: 'caption' }])]),
      [snapshot('v1', [
        makeParagraphType('paragraph--gallery', [
          { name: 'caption' },
          { name: 'nested', type: 'paragraph', ref: 'paragraph--ghost', rel: 'one-to-many' },
        ]),
      ])]
    )
    expect(errors).toEqual([])
  })
})

describe('ORPHANED_TOMBSTONE', () => {
  it('fires for a tombstone no live version exposes', () => {
    // The residue of a retirement: v1's directory was deleted, but the
    // tombstone retaining its column was not. It is a column nothing can read.
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_desc', type: 'text/rich', removed: true },
        ]),
      ]),
      []
    )
    const err = errors.find((e) => e.code === 'ORPHANED_TOMBSTONE')
    expect(err).toBeDefined()
    expect(err!.message).toContain('blog_desc')
  })

  it('does not fire while a live version still exposes the column', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [
          { name: 'title' },
          { name: 'blog_desc', type: 'text/rich', removed: true },
        ]),
      ]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }]),
      ])]
    )
    expect(errors).toEqual([])
  })
})

describe('FIELD_TYPE_CHANGED_WHILE_LIVE', () => {
  it('fires when a live version exposes a column current now types differently', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', type: 'integer' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'title', type: 'text/plain' }])])]
    )
    const err = errors.find((e) => e.code === 'FIELD_TYPE_CHANGED_WHILE_LIVE')
    expect(err).toBeDefined()
    expect(err!.message).toContain('title')
  })

  it('matches by column, not by name, so a renamed field is still checked', () => {
    // v1 exposes column `blog_title` as text/plain. Current exposes the same
    // column as `title`, typed integer. Matching by NAME would miss it
    // entirely — `blog_title` no longer exists as a name.
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', type: 'integer', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title', type: 'text/plain' }])])]
    )
    expect(errors.map((e) => e.code)).toContain('FIELD_TYPE_CHANGED_WHILE_LIVE')
  })

  it('does not fire when the type is unchanged', () => {
    const errors = errorsOf(
      makeRegistry([makeContentType('content--blog_post', [{ name: 'title', column: 'blog_title' }])]),
      [snapshot('v1', [makeContentType('content--blog_post', [{ name: 'blog_title' }])])]
    )
    expect(errors).toEqual([])
  })
})

describe('errors accumulate', () => {
  it('reports every failure rather than stopping at the first', () => {
    const errors = errorsOf(
      makeRegistry([
        makeContentType('content--blog_post', [{ name: 'title' }]),
        makeContentType('content--other', [{ name: 'a' }]),
      ]),
      [snapshot('v1', [
        makeContentType('content--blog_post', [{ name: 'blog_title' }]),
        makeContentType('content--other', [{ name: 'old_a' }]),
      ])]
    )
    expect(errors.filter((e) => e.code === 'VERSION_COLUMN_MISSING')).toHaveLength(2)
  })
})

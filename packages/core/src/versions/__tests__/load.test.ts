import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadVersionModel } from '../load'
import { makeContentType, makeRegistry } from './fixtures'
import type { ResolvedSchemaConfig } from '../../config/types'

let dir: string

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-versions-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function config(): ResolvedSchemaConfig {
  return {
    base_path: dir,
    folders: {
      content_types: 'content-types',
      paragraph_types: 'paragraph-types',
      taxonomy_types: 'taxonomy-types',
      enum_types: 'enum-types',
    },
  }
}

/** Writes a minimal, valid content-type snapshot file for content--post with one text field. */
function writeSnapshot(versionDir: string, fieldLabel: string): void {
  const typesDir = path.join(versionDir, 'content-types')
  fs.mkdirSync(typesDir, { recursive: true })
  fs.writeFileSync(
    path.join(typesDir, 'content--post.json'),
    JSON.stringify({
      name: 'content--post', label: 'Post', type: 'content-type',
      default_base_path: 'x', only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: [{ name: fieldLabel, label: fieldLabel, type: 'text/plain', required: false }],
          },
        },
      ],
    })
  )
}

describe('loadVersionModel', () => {
  it('returns a single-version identity model when versions/ is absent', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v1')
    expect(r.value.live).toEqual(['v1'])
    expect(r.value.union).toBe(current)
  })

  it('discovers a snapshot directory and derives v2 as current', () => {
    const v1 = path.join(dir, 'versions', 'v1', 'content-types')
    fs.mkdirSync(v1, { recursive: true })
    fs.writeFileSync(
      path.join(v1, 'content--post.json'),
      // ContentTypeRawSchema requires fields wrapped in >=1 tab (see fixtures.ts) —
      // a flat fields array, as the plan's draft of this fixture had it, fails
      // Zod validation with "expected object, received undefined" at fields[0].tab.
      JSON.stringify({
        name: 'content--post', label: 'Post', type: 'content-type',
        default_base_path: 'x', only_one: false,
        fields: [
          {
            tab: {
              name: 'primary_tab',
              label: 'Primary',
              fields: [{ name: 'a', label: 'a', type: 'text/plain', required: false }],
            },
          },
        ],
      })
    )
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v2')
    expect(r.value.live).toEqual(['v1', 'v2'])
  })

  // Fix round 1, finding 1: config.folders is a real, supported override
  // (config/types.ts's SchemaFolders, exercised by defineConfig.test.ts) — a
  // snapshot must be read using THOSE folder names, not the four hardcoded
  // defaults. Getting this wrong doesn't error: a missing folder is legal (a
  // snapshot may lack a type), so a wrong implementation silently reads the
  // renamed folder as empty. The discriminator is direct: assert the
  // projection for v1 actually contains content--post's field, which is only
  // possible if the snapshot file — sitting under the renamed folder — was
  // found and parsed at all.
  it('reads a snapshot using a non-default folder name from config.folders', () => {
    const customConfig: ResolvedSchemaConfig = {
      base_path: dir,
      folders: {
        content_types: 'items', // renamed from the default 'content-types'
        paragraph_types: 'paragraph-types',
        taxonomy_types: 'taxonomy-types',
        enum_types: 'enum-types',
      },
    }
    const v1 = path.join(dir, 'versions', 'v1', 'items')
    fs.mkdirSync(v1, { recursive: true })
    fs.writeFileSync(
      path.join(v1, 'content--post.json'),
      JSON.stringify({
        name: 'content--post', label: 'Post', type: 'content-type',
        default_base_path: 'x', only_one: false,
        fields: [
          {
            tab: {
              name: 'primary_tab',
              label: 'Primary',
              fields: [{ name: 'a', label: 'a', type: 'text/plain', required: false }],
            },
          },
        ],
      })
    )
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(customConfig, current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v2')
    expect(r.value.projections['v1']?.types['content--post']?.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
    ])
  })

  // Decision 5 calls this out explicitly: 'v10' sorts before 'v2' lexicographically,
  // so a discovery routine that sorts directory names as strings rather than by
  // their numeric part would order live as ['v10', 'v2', 'v11'] here — visibly wrong.
  it('sorts discovered snapshots by NUMERIC version, not lexicographically', () => {
    writeSnapshot(path.join(dir, 'versions', 'v2'), 'a')
    writeSnapshot(path.join(dir, 'versions', 'v10'), 'a')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.live).toEqual(['v2', 'v10', 'v11'])
    expect(r.value.current).toBe('v11')
  })

  it('reports VERSION_SNAPSHOT_INVALID for an unparseable snapshot file', () => {
    const v1 = path.join(dir, 'versions', 'v1', 'content-types')
    fs.mkdirSync(v1, { recursive: true })
    fs.writeFileSync(path.join(v1, 'content--post.json'), '{ not valid json')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_SNAPSHOT_INVALID')
  })

  it('reads a renamed field from a snapshot and projects both names over one column', () => {
    // The declarative replacement for the deleted pending.json test: the
    // snapshot's own schema file carries the old name, and current declares
    // `column` to keep the storage put. Nothing is folded and no declaration
    // file is involved.
    writeSnapshot(path.join(dir, 'versions', 'v1'), 'old_title')

    const current = makeRegistry([
      makeContentType('content--post', [{ name: 'title', column: 'old_title' }]),
    ])

    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.value.current).toBe('v2')
    expect(r.value.projections['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'old_title', exposed_as: 'old_title' },
    ])
    expect(r.value.projections['v2']!.types['content--post']!.fields).toEqual([
      { column_name: 'old_title', exposed_as: 'title' },
    ])
  })

  it('reports VERSION_COLUMN_MISSING when current forgot the column override', () => {
    // The same tree with the override missing. This is the failure a real
    // author hits, reached the way they reach it — through loadVersionModel,
    // not by hand-building a model.
    writeSnapshot(path.join(dir, 'versions', 'v1'), 'old_title')

    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])

    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('VERSION_COLUMN_MISSING')
  })
})

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

  // The brief's own draft of this test only asserted r.ok === true with no
  // snapshot in play — a version that never read pending.json at all (using
  // the empty shape unconditionally) would pass it too, since an unused
  // fallback declaration changes nothing observable. Strengthened here so a
  // wrong implementation visibly fails: a v1 snapshot uses the OLD label
  // ('blog_title'), current uses the NEW one ('title'), and only a rename
  // declared in pending.json — actually read off disk — resolves them to the
  // same column and avoids AMBIGUOUS_RENAME.
  it('reads pending.json when present and applies a declared rename', () => {
    const v1 = path.join(dir, 'versions', 'v1', 'content-types')
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
              fields: [{ name: 'blog_title', label: 'blog_title', type: 'text/plain', required: false }],
            },
          },
        ],
      })
    )
    fs.writeFileSync(
      path.join(dir, 'versions', 'pending.json'),
      JSON.stringify({
        renames: [{ type: 'content--post', from: 'blog_title', to: 'title' }],
        drops: [],
        fallbacks: {},
      })
    )
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.current).toBe('v2')
  })

  // Final-review I1. pending.json is the one file a human edits, and omitting
  // a key they are not using is the likeliest mistake. Casting the raw parsed
  // JSON to the type made every one of these THROW out of the fold
  // ("pending.drops is not iterable") — a crash rather than a Result, from an
  // expected condition. Each shape must come back as a collected ParseError
  // naming the offending key.
  describe('malformed pending.json / history.json shapes', () => {
    function writeVersionsFile(name: string, body: string): void {
      fs.mkdirSync(path.join(dir, 'versions'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'versions', name), body)
    }

    function load() {
      const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
      return loadVersionModel(config(), current)
    }

    const cases: Array<{ label: string; file: string; body: string; key?: string }> = [
      {
        label: 'pending.json with renames but no drops or fallbacks',
        file: 'pending.json',
        body: JSON.stringify({ renames: [{ type: 'content--post', from: 'a', to: 'b' }] }),
        key: 'drops',
      },
      { label: 'an empty pending.json object', file: 'pending.json', body: '{}', key: 'renames' },
      { label: 'a null pending.json', file: 'pending.json', body: 'null' },
      { label: 'an array pending.json', file: 'pending.json', body: '[]' },
      {
        label: 'a pending rename missing its `to`',
        file: 'pending.json',
        body: JSON.stringify({ renames: [{ type: 'content--post', from: 'a' }], drops: [], fallbacks: {} }),
        key: 'renames.0.to',
      },
      { label: 'an empty history.json object', file: 'history.json', body: '{}', key: 'renames' },
      {
        label: 'a history.json with null fallbacks',
        file: 'history.json',
        body: JSON.stringify({ renames: [], drops: [], fallbacks: null }),
        key: 'fallbacks',
      },
    ]

    for (const { label, file, body, key } of cases) {
      it(`reports ${label} rather than throwing`, () => {
        writeVersionsFile(file, body)
        const r = load()
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect(r.errors.map((e) => e.code)).toContain('FILE_PARSE_ERROR')
        if (key !== undefined) {
          expect(r.errors.some((e) => e.path === key)).toBe(true)
          expect(r.errors.some((e) => e.message.includes(`"${key}"`))).toBe(true)
        }
        expect(r.errors[0]!.file).toContain(file)
      })
    }

    it('accepts a fully-specified pending.json with empty containers', () => {
      writeVersionsFile('pending.json', JSON.stringify({ renames: [], drops: [], fallbacks: {} }))
      writeVersionsFile('history.json', JSON.stringify({ renames: [], drops: [], fallbacks: {} }))
      const r = load()
      expect(r.ok).toBe(true)
    })

    it('names the missing key and how to write it', () => {
      writeVersionsFile('pending.json', '{}')
      const r = load()
      expect(r.ok).toBe(false)
      if (r.ok) return
      const keys = r.errors.map((e) => e.path)
      expect(keys).toContain('renames')
      expect(keys).toContain('drops')
      expect(keys).toContain('fallbacks')
      expect(r.errors[0]!.message).toContain('Write [] or {}')
    })
  })

  // Mirrors decision 6: pending.json/history.json are optional when absent,
  // but a file that EXISTS and fails to parse is a real error that must
  // surface, not be swallowed into the empty shape.
  it('surfaces a parse error for a malformed history.json rather than defaulting it away', () => {
    fs.mkdirSync(path.join(dir, 'versions'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'versions', 'history.json'), '{ not valid json')
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const r = loadVersionModel(config(), current)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => e.code)).toContain('FILE_PARSE_ERROR')
  })
})

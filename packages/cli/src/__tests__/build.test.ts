import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent, Stats } from 'node:fs'

vi.mock('node:fs')

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { needsRebuild } from '../commands/build.js'

const CWD = '/fake/cwd'
const SENTINEL = `${CWD}/dist/generated/schema.ts`
const INSTALLED = { '@bobbykim/manguito-cms-db': '0.3.0' }

function makeDirent(name: string, isDir = false): Dirent {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as unknown as Dirent
}

function makeStats(mtimeMs: number): Stats {
  return { mtimeMs } as unknown as Stats
}

describe('needsRebuild', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns true when dist/generated/schema.ts does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(await needsRebuild(CWD)).toBe(true)
    expect(vi.mocked(existsSync)).toHaveBeenCalledWith(SENTINEL)
  })

  it('returns true when a schema file mtime is newer than schema.ts mtime', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockImplementation((filePath) =>
      makeStats(String(filePath).endsWith('schema.ts') ? 1000 : 2000),
    )
    vi.mocked(readdirSync).mockReturnValue(
      [makeDirent('post.json')] as unknown as ReturnType<typeof readdirSync>,
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(INSTALLED))
    expect(await needsRebuild(CWD, { installed: INSTALLED })).toBe(true)
  })

  it('returns false when schema.ts mtime is newer than all schema files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockImplementation((filePath) =>
      makeStats(String(filePath).endsWith('schema.ts') ? 2000 : 1000),
    )
    vi.mocked(readdirSync).mockReturnValue(
      [makeDirent('post.json')] as unknown as ReturnType<typeof readdirSync>,
    )
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(INSTALLED))
    expect(await needsRebuild(CWD, { installed: INSTALLED })).toBe(false)
  })

  describe('manguito version record', () => {
    // schema.ts newer than every schema file, so only the record can force a rebuild
    function currentSchemaTs() {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(statSync).mockImplementation((filePath) =>
        makeStats(String(filePath).endsWith('schema.ts') ? 2000 : 1000),
      )
      vi.mocked(readdirSync).mockReturnValue(
        [makeDirent('post.json')] as unknown as ReturnType<typeof readdirSync>,
      )
    }

    it('returns true when the version record is missing', async () => {
      // MUTATION: treating a missing record as current returns false here
      currentSchemaTs()
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      expect(await needsRebuild(CWD, { installed: INSTALLED })).toBe(true)
    })

    it('returns true when the record names a different version', async () => {
      // MUTATION: ignoring the record returns false here
      currentSchemaTs()
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ '@bobbykim/manguito-cms-db': '0.2.1' }),
      )
      expect(await needsRebuild(CWD, { installed: INSTALLED })).toBe(true)
    })

    it('returns true when only the running cli version differs from the record', async () => {
      // MUTATION: comparing the record without its running-cli key (the
      // node_modules packages only) misses a newer bundled cli (false). The
      // recording side is covered in installed-versions.test.ts.
      currentSchemaTs()
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...INSTALLED, 'running-cli': '0.11.3' }),
      )
      expect(
        await needsRebuild(CWD, { installed: { ...INSTALLED, 'running-cli': '0.11.4' } }),
      ).toBe(true)
    })

    it('returns false when the record matches the installed versions', async () => {
      // MUTATION: always returning true when a record exists fails this case
      currentSchemaTs()
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(INSTALLED))
      expect(await needsRebuild(CWD, { installed: INSTALLED })).toBe(false)
    })
  })

  it('checks schemaDir instead of schemas/ when one is given', async () => {
    // MUTATION: ignoring schemaDir and walking <cwd>/schemas sees only the old
    // file there (mtime 1000) and returns false
    const CUSTOM = '/fake/cwd/content/schema'
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockImplementation((filePath) => {
      const p = String(filePath)
      return makeStats(p.endsWith('schema.ts') ? 1500 : p.startsWith(CUSTOM) ? 2000 : 1000)
    })
    vi.mocked(readdirSync).mockImplementation(((dir: unknown) =>
      [makeDirent(String(dir).startsWith(CUSTOM) ? 'new.json' : 'old.json')]) as never)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(INSTALLED))
    expect(await needsRebuild(CWD, { installed: INSTALLED, schemaDir: CUSTOM })).toBe(true)
  })

  it('returns true when schemas/ is empty and the artifact does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(await needsRebuild(CWD)).toBe(true)
  })
})

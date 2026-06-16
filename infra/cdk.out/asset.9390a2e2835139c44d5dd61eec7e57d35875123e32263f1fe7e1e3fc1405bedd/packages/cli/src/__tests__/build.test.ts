import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dirent, Stats } from 'node:fs'

vi.mock('node:fs')

import { existsSync, statSync, readdirSync } from 'node:fs'
import { needsRebuild } from '../commands/build.js'

const CWD = '/fake/cwd'
const SENTINEL = `${CWD}/dist/generated/schema.ts`

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
    expect(await needsRebuild(CWD)).toBe(true)
  })

  it('returns false when schema.ts mtime is newer than all schema files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockImplementation((filePath) =>
      makeStats(String(filePath).endsWith('schema.ts') ? 2000 : 1000),
    )
    vi.mocked(readdirSync).mockReturnValue(
      [makeDirent('post.json')] as unknown as ReturnType<typeof readdirSync>,
    )
    expect(await needsRebuild(CWD)).toBe(false)
  })

  it('returns true when schemas/ is empty and the artifact does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(await needsRebuild(CWD)).toBe(true)
  })
})

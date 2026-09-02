import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copySnapshotFolders, retireSnapshotDir } from '../commands/version-fs.js'

let root: string
const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-cut-'))
  fs.mkdirSync(path.join(root, 'content-types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'content-types', 'content--post.json'), '{"a":1}')
  fs.mkdirSync(path.join(root, 'taxonomy-types'), { recursive: true })
  fs.writeFileSync(path.join(root, 'taxonomy-types', 'taxonomy--tag.yaml'), 'a: 1')
  // Root-level files that must NOT be copied — a snapshot holds only type folders.
  fs.writeFileSync(path.join(root, 'roles.json'), '{}')
  fs.writeFileSync(path.join(root, 'routes.json'), '{}')
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('copySnapshotFolders', () => {
  it('copies the type folders that exist, including .yaml files', () => {
    const toDir = path.join(root, 'versions', 'v1')
    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'content-types', 'content--post.json'))).toBe(true)
    expect(fs.existsSync(path.join(toDir, 'taxonomy-types', 'taxonomy--tag.yaml'))).toBe(true)
  })

  it('does not copy roles.json or routes.json', () => {
    // Neither is versioned: core assembles every snapshot with CURRENT's
    // roles and routes. They live at the schema root, not in a type folder.
    const toDir = path.join(root, 'versions', 'v1')
    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'roles.json'))).toBe(false)
    expect(fs.existsSync(path.join(toDir, 'routes.json'))).toBe(false)
  })

  it('skips a type folder that does not exist rather than failing', () => {
    // The sandbox has no enum-types folder in some projects; a missing folder
    // contributes zero files, which is core's rule for snapshots too.
    const toDir = path.join(root, 'versions', 'v1')
    expect(() => copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })).not.toThrow()
    expect(fs.existsSync(path.join(toDir, 'enum-types'))).toBe(false)
  })

  it('honours a renamed folder from config.folders', () => {
    fs.mkdirSync(path.join(root, 'ct'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ct', 'content--post.json'), '{"a":1}')
    const toDir = path.join(root, 'versions', 'v1')

    copySnapshotFolders({ fromRoot: root, toDir, folders: { ...FOLDERS, content_types: 'ct' } })

    expect(fs.existsSync(path.join(toDir, 'ct', 'content--post.json'))).toBe(true)
  })

  it('ignores files with an unsupported extension', () => {
    fs.writeFileSync(path.join(root, 'content-types', 'notes.txt'), 'x')
    const toDir = path.join(root, 'versions', 'v1')

    copySnapshotFolders({ fromRoot: root, toDir, folders: FOLDERS })

    expect(fs.existsSync(path.join(toDir, 'content-types', 'notes.txt'))).toBe(false)
  })
})

describe('retireSnapshotDir', () => {
  it('removes the snapshot directory', () => {
    const versionsDir = path.join(root, 'versions')
    fs.mkdirSync(path.join(versionsDir, 'v1', 'content-types'), { recursive: true })
    fs.writeFileSync(path.join(versionsDir, 'v1', 'content-types', 'a.json'), '{}')

    retireSnapshotDir(versionsDir, 'v1')

    expect(fs.existsSync(path.join(versionsDir, 'v1'))).toBe(false)
  })

  it('leaves nothing that snapshot discovery would read', () => {
    // The rename step uses a name that cannot match /^v\d+$/, so even if the
    // delete failed the leftover is inert rather than a half-deleted version.
    const versionsDir = path.join(root, 'versions')
    fs.mkdirSync(path.join(versionsDir, 'v1'), { recursive: true })

    retireSnapshotDir(versionsDir, 'v1')

    const remaining = fs.readdirSync(versionsDir).filter((e) => /^v\d+$/.test(e))
    expect(remaining).toEqual([])
  })
})

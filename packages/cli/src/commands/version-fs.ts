import fs from 'node:fs'
import path from 'node:path'
import type { SchemaFolders } from '@bobbykim/manguito-cms-core'

const SUPPORTED = new Set(['.json', '.yaml', '.yml'])

/**
 * Copies the four schema type folders into a snapshot directory.
 *
 * Only the type folders — `roles.json` and `routes.json` sit at the schema
 * root and are deliberately excluded, because neither is versioned: core
 * assembles every snapshot with CURRENT's roles and routes.
 *
 * A missing type folder contributes zero files rather than failing, matching
 * core's rule for reading a snapshot.
 */
export function copySnapshotFolders(input: {
  fromRoot: string
  toDir: string
  folders: SchemaFolders
}): void {
  const { fromRoot, toDir, folders } = input

  for (const folder of Object.values(folders)) {
    const src = path.join(fromRoot, folder)
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue

    const dest = path.join(toDir, folder)
    fs.mkdirSync(dest, { recursive: true })

    for (const entry of fs.readdirSync(src)) {
      if (!SUPPORTED.has(path.extname(entry).toLowerCase())) continue
      fs.copyFileSync(path.join(src, entry), path.join(dest, entry))
    }
  }
}

/**
 * Retires a snapshot by renaming it out of discovery's way first, then
 * deleting the renamed directory.
 *
 * The rename is atomic and the new name cannot match /^v\d+$/, so the version
 * is gone as far as snapshot discovery is concerned the instant it succeeds.
 * If the delete then fails, what is left behind is inert junk rather than a
 * half-deleted version that would parse as valid but incomplete.
 */
export function retireSnapshotDir(versionsDir: string, version: string): void {
  const from = path.join(versionsDir, version)
  const staging = path.join(versionsDir, `.${version}.removing`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.renameSync(from, staging)
  fs.rmSync(staging, { recursive: true, force: true })
}

/**
 * Writes a snapshot whole or not at all: clears any stale staging directory
 * left by a previous crash, copies the schema folders into it, and renames it
 * into place as `versionsDir/version`. On any throw, the staging directory is
 * removed before rethrowing, so a failed copy leaves neither a `.version.tmp`
 * nor a `versionsDir/version` behind.
 *
 * The staging name deliberately does not match /^v\d+$/, so a leftover from a
 * crash is invisible to snapshot discovery instead of being read as a broken
 * version — and a fresh call always clears it first, so a stale `.version.tmp`
 * from an earlier crash never contributes files to the new snapshot.
 */
export function writeSnapshotAtomically(input: {
  fromRoot: string
  versionsDir: string
  version: string
  folders: SchemaFolders
}): void {
  const { fromRoot, versionsDir, version, folders } = input
  const target = path.join(versionsDir, version)
  const staging = path.join(versionsDir, `.${version}.tmp`)

  fs.rmSync(staging, { recursive: true, force: true })
  try {
    copySnapshotFolders({ fromRoot, toDir: staging, folders })
    fs.renameSync(staging, target)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

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

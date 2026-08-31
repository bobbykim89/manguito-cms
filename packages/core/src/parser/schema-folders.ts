import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SchemaFolders } from '../config/types.js'
import type { SchemaType } from './loader.js'

// ─── Folder → SchemaType mapping ──────────────────────────────────────────────
//
// Shared between loader.ts's walkSchemaDirectory (a live, hand-maintained
// schema root — every configured folder must exist) and versions/load.ts's
// snapshot walker (a frozen historical artifact — a missing type folder just
// means zero schemas of that type). Both need the same folder-key ↔
// schema-type mapping; extracted here so a fifth folder type only needs one
// edit, not two kept in sync by hand.

// The four schema folder keys — excludes 'roles' which is handled separately.
export type SchemaFolderKey = keyof SchemaFolders

// Maps each schema folder key to the expected schema type.
export const FOLDER_KEY_TO_SCHEMA_TYPE: Record<SchemaFolderKey, SchemaType> = {
  content_types: 'content-type',
  paragraph_types: 'paragraph-type',
  taxonomy_types: 'taxonomy-type',
  enum_types: 'enum-type',
}

// ─── Small fs helpers ─────────────────────────────────────────────────────────

export function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

export function isSupportedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ext === '.json' || ext === '.yaml' || ext === '.yml'
}

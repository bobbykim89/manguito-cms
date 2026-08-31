import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Result, ParseError, SchemaFile } from '../parser/loader.js'
import { loadSchemaFile } from '../parser/loader.js'
import { FOLDER_KEY_TO_SCHEMA_TYPE, directoryExists, isSupportedExtension } from '../parser/schema-folders.js'
import type { SchemaFolderKey } from '../parser/schema-folders.js'
import { parseSchema } from '../parser/parseSchema.js'
import type { ParsedSchema } from '../parser/parseSchema.js'
import { buildSchemaRegistry } from '../parser/validate.js'
import type { SchemaRegistry } from '../parser/validate.js'
import type { ResolvedSchemaConfig, SchemaFolders } from '../config/types.js'
import { computeVersionModel } from './compute.js'
import type { PendingChanges, VersionHistory, VersionModel, VersionSnapshot } from './types.js'

// ─── Empty shapes ─────────────────────────────────────────────────────────────

const EMPTY_PENDING: PendingChanges = { renames: [], drops: [], fallbacks: {} }
const EMPTY_HISTORY: VersionHistory = { renames: [], drops: [], fallbacks: {} }

// ─── Snapshot discovery ───────────────────────────────────────────────────────

/** Directories under versions/ matching /^v\d+$/, sorted by numeric part ascending. */
function discoverSnapshotDirs(versionsDir: string): Array<{ version: string; dir: string }> {
  const entries = fs.readdirSync(versionsDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => ({ version: e.name, n: Number.parseInt(e.name.slice(1), 10) }))
    .sort((a, b) => a.n - b.n)
    .map(({ version }) => ({ version, dir: path.join(versionsDir, version) }))
}

// ─── Walking a single snapshot's type folders ────────────────────────────────
//
// A snapshot directory contains only the type folders it had schemas for at
// cut time — unlike a live schema root, a missing type folder is not an error
// here, it just contributes zero files. This is deliberately NOT
// walkSchemaDirectory: that function requires every configured folder to
// exist (SCHEMA_FOLDER_NOT_FOUND otherwise), which is the right rule for a
// live, hand-maintained schema tree and the wrong rule for a frozen snapshot.
//
// `folders` is CURRENT's resolved config.folders, not a hardcoded default —
// a snapshot mirrors whatever folder names the live schema tree uses today,
// including a renamed one. Hardcoding the four default names here would make
// every snapshot read as silently empty the moment a project renames a folder.
function walkSnapshotFolders(dir: string, folders: SchemaFolders): Result<SchemaFile[]> {
  const files: SchemaFile[] = []
  const errors: ParseError[] = []

  for (const [folderKey, schemaType] of Object.entries(FOLDER_KEY_TO_SCHEMA_TYPE) as Array<
    [SchemaFolderKey, SchemaFile['schema_type']]
  >) {
    const folderPath = path.join(dir, folders[folderKey])
    if (!directoryExists(folderPath)) continue

    let entries: string[]
    try {
      entries = fs.readdirSync(folderPath)
    } catch {
      entries = []
    }

    for (const entry of entries) {
      if (!isSupportedExtension(entry)) continue
      const filePath = path.join(folderPath, entry)
      const result = loadSchemaFile(filePath)
      if (!result.ok) {
        errors.push(...result.errors)
        continue
      }
      files.push({ path: filePath, raw: result.value, schema_type: schemaType })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: files }
}

/** Wraps any underlying failure for one snapshot as VERSION_SNAPSHOT_INVALID, preserving the real message. */
function wrapAsSnapshotInvalid(version: string, errors: ParseError[]): ParseError[] {
  return errors.map((e) => ({
    file: e.file,
    code: 'VERSION_SNAPSHOT_INVALID' as const,
    message: `Snapshot ${version} failed to load: ${e.message}`,
    ...(e.path !== undefined ? { path: e.path } : {}),
  }))
}

/**
 * Parses one snapshot directory into a VersionSnapshot. Assembled with
 * CURRENT's routes and roles — neither is versioned, a snapshot directory
 * holds only type folders. Never runs validateCrossReferences: a snapshot was
 * already validated when it was cut, and re-validating it against current's
 * routes.json would flag untouched history the moment a base path is removed.
 */
function loadSnapshot(
  version: string,
  dir: string,
  folders: SchemaFolders,
  current: SchemaRegistry
): Result<VersionSnapshot> {
  const walked = walkSnapshotFolders(dir, folders)
  if (!walked.ok) return { ok: false, errors: wrapAsSnapshotInvalid(version, walked.errors) }

  const schemas: ParsedSchema[] = []
  const errors: ParseError[] = []

  for (const file of walked.value) {
    const parsed = parseSchema(file.raw, file.schema_type, file.path)
    if (!parsed.ok) {
      errors.push(...parsed.errors)
      continue
    }
    schemas.push(parsed.schema)
  }

  if (errors.length > 0) return { ok: false, errors: wrapAsSnapshotInvalid(version, errors) }

  const registry = buildSchemaRegistry(schemas, current.routes, current.roles)
  return { ok: true, value: { version, registry } }
}

// ─── Optional JSON files (pending.json / history.json) ───────────────────────
//
// Absent means the empty shape. A file that EXISTS but fails to parse is a
// real error — loadSchemaFile already produces FILE_PARSE_ERROR for that, so
// it is surfaced rather than swallowed.
function loadOptionalJson<T>(filePath: string, fallback: T): Result<T> {
  if (!fs.existsSync(filePath)) return { ok: true, value: fallback }
  const result = loadSchemaFile(filePath)
  if (!result.ok) return result
  return { ok: true, value: result.value as T }
}

// ─── loadVersionModel ─────────────────────────────────────────────────────────

/**
 * Reads `versions/` under config.base_path — snapshot directories,
 * pending.json, history.json — and hands the assembled input to
 * computeVersionModel. Absent `versions/` means no history has been cut yet:
 * an identity model at v1, computed with empty snapshots/history/pending.
 */
export function loadVersionModel(config: ResolvedSchemaConfig, current: SchemaRegistry): Result<VersionModel> {
  const versionsDir = path.join(config.base_path, 'versions')

  if (!directoryExists(versionsDir)) {
    return computeVersionModel({ current, snapshots: [], history: EMPTY_HISTORY, pending: EMPTY_PENDING })
  }

  const pendingResult = loadOptionalJson<PendingChanges>(path.join(versionsDir, 'pending.json'), EMPTY_PENDING)
  if (!pendingResult.ok) return pendingResult

  const historyResult = loadOptionalJson<VersionHistory>(path.join(versionsDir, 'history.json'), EMPTY_HISTORY)
  if (!historyResult.ok) return historyResult

  const snapshots: VersionSnapshot[] = []
  const errors: ParseError[] = []

  for (const { version, dir } of discoverSnapshotDirs(versionsDir)) {
    const result = loadSnapshot(version, dir, config.folders, current)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    snapshots.push(result.value)
  }

  if (errors.length > 0) return { ok: false, errors }

  return computeVersionModel({
    current,
    snapshots,
    history: historyResult.value,
    pending: pendingResult.value,
  })
}

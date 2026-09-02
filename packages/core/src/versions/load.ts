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
import type { VersionModel, VersionSnapshot } from './types.js'

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

// ─── loadVersionSnapshots & loadVersionModel ──────────────────────────────────

/**
 * Every snapshot under `versions/`, oldest first by NUMERIC version.
 *
 * Split out of loadVersionModel so a caller can reach a snapshot's registry.
 * `VersionModel` deliberately does not carry them — it holds `current`,
 * `live`, `union` and `projections`, and is passed around and consumed by db
 * codegen, so bolting N full registries onto it would make every consumer
 * pay for data only the CLI's diff needs.
 *
 * Absent `versions/` is not an error: it means nothing has been cut yet.
 */
export function loadVersionSnapshots(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionSnapshot[]> {
  const versionsDir = path.join(config.base_path, 'versions')
  if (!directoryExists(versionsDir)) return { ok: true, value: [] }

  const snapshots: VersionSnapshot[] = []
  const errors: ParseError[] = []

  for (const { version, dir } of discoverSnapshotDirs(versionsDir)) {
    // config.folders, never hardcoded names — a snapshot mirrors whatever
    // folder names the live schema tree uses today, including a renamed one.
    const result = loadSnapshot(version, dir, config.folders, current)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    snapshots.push(result.value)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: snapshots }
}

/**
 * Reads the snapshot directories under `versions/` and hands them to
 * computeVersionModel. Absent `versions/` means nothing has been cut yet: an
 * identity model at v1.
 */
export function loadVersionModel(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionModel> {
  const snapshots = loadVersionSnapshots(config, current)
  if (!snapshots.ok) return snapshots
  return computeVersionModel({ current, snapshots: snapshots.value })
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ResolvedSchemaConfig } from '../config/types'

// ─── Result type ──────────────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ParseError[] }

// ─── ParseError ───────────────────────────────────────────────────────────────

export type ParseErrorCode =
  | 'INVALID_SCHEMA_TYPE'
  | 'INVALID_FIELD_TYPE'
  | 'UNKNOWN_BASE_PATH'
  | 'UNKNOWN_REF'
  | 'INVALID_REF_TARGET'
  | 'DUPLICATE_FIELD_NAME'
  | 'DUPLICATE_SCHEMA_NAME'
  | 'INVALID_MACHINE_NAME'
  | 'CIRCULAR_REFERENCE'
  | 'MISSING_REQUIRED_FIELD'
  | 'MAX_SIZE_EXCEEDS_GLOBAL_LIMIT'
  | 'SCHEMA_DIR_NOT_FOUND'
  | 'SCHEMA_FOLDER_NOT_FOUND'
  | 'DUPLICATE_SCHEMA_FOLDER'
  | 'ROUTES_FILE_NOT_FOUND'
  | 'FILE_READ_ERROR'
  | 'FILE_PARSE_ERROR'
  | 'DUPLICATE_HIERARCHY_LEVEL'
  | 'UNKNOWN_PERMISSION'
  | 'INVALID_PERMISSION'

export type ParseError = {
  file: string
  code: ParseErrorCode
  message: string
  path?: string
}

// ─── SchemaType / SchemaFile ──────────────────────────────────────────────────

export type SchemaType =
  | 'content-type'
  | 'paragraph-type'
  | 'taxonomy-type'
  | 'enum-type'

export type SchemaFile = {
  path: string
  raw: unknown
  schema_type: SchemaType
}

// ─── Folder → SchemaType mapping ──────────────────────────────────────────────

// The four schema folder keys — excludes 'roles' which is handled separately.
type SchemaFolderKey = 'content_types' | 'paragraph_types' | 'taxonomy_types' | 'enum_types'

// Maps each schema folder key to the expected schema type.
const FOLDER_KEY_TO_SCHEMA_TYPE: Record<SchemaFolderKey, SchemaType> = {
  content_types: 'content-type',
  paragraph_types: 'paragraph-type',
  taxonomy_types: 'taxonomy-type',
  enum_types: 'enum-type',
}

// The filename prefix (before '--') that identifies each schema type.
const SCHEMA_TYPE_TO_PREFIX: Record<SchemaType, string> = {
  'content-type': 'content',
  'paragraph-type': 'paragraph',
  'taxonomy-type': 'taxonomy',
  'enum-type': 'enum',
}

// ─── loadSchemaFile ───────────────────────────────────────────────────────────

/**
 * Reads a single JSON or YAML schema file and returns the raw parsed object.
 * Supported extensions: .json, .yaml, .yml
 * Never throws — file system and parse errors are returned as Result failures.
 */
export function loadSchemaFile(filePath: string): Result<unknown> {
  let raw: string

  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          file: filePath,
          code: 'FILE_READ_ERROR',
          message: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    }
  }

  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.json') {
    try {
      return { ok: true, value: JSON.parse(raw) as unknown }
    } catch (err) {
      return {
        ok: false,
        errors: [
          {
            file: filePath,
            code: 'FILE_PARSE_ERROR',
            message: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  }

  if (ext === '.yaml' || ext === '.yml') {
    try {
      return { ok: true, value: parseYaml(raw) as unknown }
    } catch (err) {
      return {
        ok: false,
        errors: [
          {
            file: filePath,
            code: 'FILE_PARSE_ERROR',
            message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  }

  return {
    ok: false,
    errors: [
      {
        file: filePath,
        code: 'FILE_PARSE_ERROR',
        message: `Unsupported file extension "${ext}" — expected .json, .yaml, or .yml`,
      },
    ],
  }
}

// ─── walkSchemaDirectory ──────────────────────────────────────────────────────

/**
 * Walks each schema folder defined in config and collects all schema files.
 * For each file:
 *   - Validates that the filename prefix matches the folder's expected schema type.
 *   - Reads and parses the file content via loadSchemaFile.
 *
 * Collects all errors rather than stopping at the first failure.
 * Returns { ok: false, errors } only when structural problems prevent loading;
 * individual file errors are accumulated and returned together.
 */
export function walkSchemaDirectory(
  config: ResolvedSchemaConfig
): Result<SchemaFile[]> {
  const errors: ParseError[] = []
  const files: SchemaFile[] = []

  // ── Validate base_path exists ──────────────────────────────────────────────

  if (!directoryExists(config.base_path)) {
    return {
      ok: false,
      errors: [
        {
          file: config.base_path,
          code: 'SCHEMA_DIR_NOT_FOUND',
          message: `Schema base directory does not exist: ${config.base_path}`,
        },
      ],
    }
  }

  // ── Validate no two folders resolve to the same absolute path ──────────────

  const resolvedFolderPaths = new Map<string, SchemaFolderKey>()

  for (const folderKey of Object.keys(FOLDER_KEY_TO_SCHEMA_TYPE) as SchemaFolderKey[]) {
    const folderName = config.folders[folderKey]
    const absFolder = path.resolve(config.base_path, folderName)
    const existing = resolvedFolderPaths.get(absFolder)

    if (existing !== undefined) {
      errors.push({
        file: absFolder,
        code: 'DUPLICATE_SCHEMA_FOLDER',
        message: `Folders "${existing}" and "${folderKey}" resolve to the same path: ${absFolder}`,
      })
    } else {
      resolvedFolderPaths.set(absFolder, folderKey)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  // ── Walk each schema folder ────────────────────────────────────────────────

  for (const [folderKey, schemaType] of Object.entries(
    FOLDER_KEY_TO_SCHEMA_TYPE
  ) as [SchemaFolderKey, SchemaType][]) {
    const folderName = config.folders[folderKey]
    const folderPath = path.resolve(config.base_path, folderName)

    if (!directoryExists(folderPath)) {
      errors.push({
        file: folderPath,
        code: 'SCHEMA_FOLDER_NOT_FOUND',
        message: `Schema folder does not exist: ${folderPath} (configured as "${folderName}")`,
      })
      continue
    }

    const entries = readDirEntries(folderPath)
    const expectedPrefix = SCHEMA_TYPE_TO_PREFIX[schemaType]

    for (const entry of entries) {
      if (!isSupportedExtension(entry)) continue

      const filePath = path.join(folderPath, entry)
      const baseName = path.basename(entry, path.extname(entry))

      // ── Validate filename prefix matches the folder ──────────────────────
      if (!hasCorrectPrefix(baseName, expectedPrefix)) {
        errors.push({
          file: filePath,
          code: 'INVALID_MACHINE_NAME',
          message:
            `File "${entry}" in folder "${folderName}" does not match the expected ` +
            `"${expectedPrefix}--<name>" prefix for ${schemaType} schemas. ` +
            `Did you put this file in the wrong folder?`,
        })
        continue
      }

      // ── Load and parse the file ──────────────────────────────────────────
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function readDirEntries(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath)
  } catch {
    return []
  }
}

function isSupportedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ext === '.json' || ext === '.yaml' || ext === '.yml'
}

/**
 * Validates that a basename (filename without extension) starts with the
 * expected type prefix followed by '--'.
 * e.g. "content--blog_post" with prefix "content" → true
 *      "paragraph--photo_card" with prefix "content" → false
 */
function hasCorrectPrefix(baseName: string, expectedPrefix: string): boolean {
  return baseName.startsWith(`${expectedPrefix}--`)
}

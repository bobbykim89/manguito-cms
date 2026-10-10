import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { writeSnapshotAtomically } from '../../src/commands/version-fs.js'

// The scaffolder's own roles.json and routes.json: real, valid files, kept in
// step with what `create-manguito` ships rather than hand-written here.
const TEMPLATES = path.resolve(__dirname, '../../../create-manguito/src/templates/schemas')

/** `config.schema.folders` as `defineConfig` defaults it. */
export const FOLDERS = {
  content_types: 'content-types',
  paragraph_types: 'paragraph-types',
  taxonomy_types: 'taxonomy-types',
  enum_types: 'enum-types',
}

export type TempProject = {
  root: string
  /** Absolute `schema.base_path`. */
  schemas: string
  /** Writes `content-types/<name>.json` with one tab holding `fields`. */
  writeType(name: string, fields: object[], basePath?: string): void
  cleanup(): void
}

export function makeTempProject(): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manguito-cli-'))
  const schemas = path.join(root, 'schemas')
  // The parser rejects a project missing any of the four folders, even empty.
  for (const folder of Object.values(FOLDERS)) {
    fs.mkdirSync(path.join(schemas, folder), { recursive: true })
  }
  fs.copyFileSync(path.join(TEMPLATES, 'roles.json.template'), path.join(schemas, 'roles.json'))
  fs.copyFileSync(path.join(TEMPLATES, 'routes.json.template'), path.join(schemas, 'routes.json'))

  return {
    root,
    schemas,
    writeType(name, fields, basePath = 'posts') {
      fs.writeFileSync(
        path.join(schemas, FOLDERS.content_types, `${name}.json`),
        JSON.stringify({
          name,
          label: name,
          type: 'content-type',
          default_base_path: basePath,
          only_one: false,
          fields: [{ tab: { name: 'main', label: 'Main', fields } }],
        })
      )
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

/** Freezes the project's current schema folders as `version`, via the real writer. */
export function snapshot(project: TempProject, version: string): void {
  writeSnapshotAtomically({
    fromRoot: project.schemas,
    versionsDir: path.join(project.schemas, 'versions'),
    version,
    folders: FOLDERS,
  })
}

export type Run = { exitCode: number | null; stdout: string; stderr: string }

class ExitSignal extends Error {}

/**
 * Runs a command handler, capturing stdout, stderr and any process.exit.
 * `process.exit` is turned into a thrown signal so the handler stops exactly
 * where the real process would, and the code is recorded rather than lost.
 */
export async function run(fn: () => Promise<unknown>): Promise<Run> {
  let stdout = ''
  let stderr = ''
  let exitCode: number | null = null
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0
    throw new ExitSignal()
  }) as never)
  try {
    await fn()
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e
  } finally {
    out.mockRestore()
    err.mockRestore()
    exit.mockRestore()
  }
  return { exitCode, stdout, stderr }
}

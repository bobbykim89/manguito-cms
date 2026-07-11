import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PromptAdapter } from './prompt.js'

// scaffold.ts lives at the package root of src/, so the templates sit beside it
// at src/templates in source and dist/templates in the tsup bundle.
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates')

function printGuidedError(message: string, hint?: string): void {
  process.stderr.write(`✖ ${message}\n`)
  if (hint !== undefined) {
    process.stderr.write(`  ${hint}\n`)
  }
}

function printSuccess(message: string): void {
  process.stdout.write(`✔ ${message}\n`)
}

export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

// Per-adapter scaffold substitutions. Each choice supplies the import line, the
// `storage:` factory call, and the .env.example variables — kept together so the
// generated config, its import, and its env stay in sync. Note: with the
// scaffold tsconfig's noUncheckedIndexedAccess, S3's required bucket/region must
// use `!`, while Cloudinary/local options are optional and don't.
type StorageTemplate = { import: string; factory: string; env: string }

const STORAGE_ADAPTERS: Record<string, StorageTemplate> = {
  'Local filesystem': {
    import: `import { createLocalAdapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createLocalAdapter({ upload_dir: process.env['STORAGE_LOCAL_UPLOAD_DIR'] })`,
    env: `# Local filesystem storage (files persist under this directory; defaults to ./uploads)\n# STORAGE_LOCAL_UPLOAD_DIR=./uploads`,
  },
  'Amazon S3': {
    import: `import { createS3Adapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createS3Adapter({\n    bucket: process.env['STORAGE_S3_BUCKET']!,\n    region: process.env['STORAGE_S3_REGION']!,\n  })`,
    env: `STORAGE_S3_BUCKET=\nSTORAGE_S3_REGION=`,
  },
  Cloudinary: {
    import: `import { createCloudinaryAdapter } from '@bobbykim/manguito-cms-api/storage'`,
    factory: `createCloudinaryAdapter({\n    cloud_name: process.env['CLOUDINARY_CLOUD_NAME'],\n    access_key_id: process.env['CLOUDINARY_API_KEY'],\n    secret_access_key: process.env['CLOUDINARY_API_SECRET'],\n  })`,
    env: `CLOUDINARY_CLOUD_NAME=\nCLOUDINARY_API_KEY=\nCLOUDINARY_API_SECRET=`,
  },
}

export async function scaffold(
  name: string | undefined,
  deps: { prompt: PromptAdapter; targetDir?: string }
): Promise<void> {
  const cwd = deps.targetDir ?? process.cwd()
  const usesCwd = name === undefined || name === '.'
  const targetDir = usesCwd ? cwd : join(cwd, name!)
  const displayName = usesCwd ? '.' : name!

  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir)
    if (entries.length > 0) {
      printGuidedError(
        `Directory "${displayName}" already exists and is not empty.`,
        'Choose a different name, or run `npm create @bobbykim/manguito` inside an empty directory.'
      )
      return
    }
  }

  process.stdout.write('Manguito CMS — New Project\n\n')

  const projectName = await deps.prompt.input('Project name:', name)

  const adapterChoice = await deps.prompt.select('Storage adapter:', [
    'Local filesystem',
    'Amazon S3',
    'Cloudinary',
  ])

  const storage = STORAGE_ADAPTERS[adapterChoice] ?? STORAGE_ADAPTERS['Local filesystem']!

  const vars = {
    projectName,
    storageImport: storage.import,
    storageAdapter: storage.factory,
    storageEnv: storage.env,
  }
  const templateFiles = walkTemplates(TEMPLATES_DIR)

  for (const templatePath of templateFiles) {
    const relPath = relative(TEMPLATES_DIR, templatePath)
    const outputRelPath = relPath.replace(/\.template$/, '')
    const outputPath = join(targetDir, outputRelPath)

    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, renderTemplate(readFileSync(templatePath, 'utf8'), vars), 'utf8')
  }

  // paragraph-types has no template files — create the dir with a .gitkeep
  const paragraphTypesDir = join(targetDir, 'schemas', 'paragraph-types')
  mkdirSync(paragraphTypesDir, { recursive: true })
  writeFileSync(join(paragraphTypesDir, '.gitkeep'), '', 'utf8')

  printSuccess('Project scaffolded.')

  process.stdout.write('\nNext steps:\n')
  if (!usesCwd) {
    process.stdout.write(`  cd ${name}\n`)
  }
  process.stdout.write('  cp .env.example .env\n')
  process.stdout.write('  # Fill in DB_URL and AUTH_SECRET in .env\n')
  process.stdout.write('  pnpm install\n')
  process.stdout.write('  pnpm dev\n')
}

function walkTemplates(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTemplates(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

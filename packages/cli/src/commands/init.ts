import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { renderTemplate } from '../utils/template.js'
import { printGuidedError, printSuccess } from '../utils/error.js'
import { loadEnvFile } from '../utils/env.js'
import { createPromptAdapter, type PromptAdapter } from '../utils/prompt.js'

const _filename = fileURLToPath(import.meta.url)
const _dirname = dirname(_filename)
// In the tsup bundle, __dirname is dist/. In source (tests), it's src/commands/.
const TEMPLATES_DIR =
  basename(_dirname) === 'commands'
    ? join(_dirname, '..', 'templates')
    : join(_dirname, 'templates')

export function registerInit(program: Command): void {
  program
    .command('init [name]')
    .description('Scaffold a new Manguito CMS project')
    .option('--env <path>', 'path to .env file to load')
    .action(async (name: string | undefined, options: { env?: string }) => {
      loadEnvFile(options.env)
      await runInit(name, { prompt: createPromptAdapter() })
    })
}

export async function runInit(
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
        'Choose a different name, or run `manguito init` inside an empty directory.'
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

  const adapterMap: Record<string, string> = {
    'Local filesystem': 'local',
    'Amazon S3': 's3',
    Cloudinary: 'cloudinary',
  }
  const storageAdapter = adapterMap[adapterChoice]!

  const vars = { projectName, storageAdapter }
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

  const fileCount = templateFiles.length + 1

  process.stdout.write('\n')
  printSuccess(`Created ${displayName}/`)
  printSuccess(`Scaffolded ${fileCount} files`)

  process.stdout.write('\nNext steps:\n')
  if (!usesCwd) {
    process.stdout.write(`  cd ${name}\n`)
  }
  process.stdout.write('  cp .env.example .env\n')
  process.stdout.write('  # Set DB_URL (and storage credentials) in .env\n')
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

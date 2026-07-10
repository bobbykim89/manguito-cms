import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PromptAdapter } from '../src/utils/prompt.js'

vi.mock('../src/utils/env.js', () => ({ loadEnvFile: vi.fn() }))

import { runInit } from '../src/commands/init.js'

function makePrompt(projectName = 'test-project', adapterChoice = 'Local filesystem'): PromptAdapter {
  return {
    input: vi.fn().mockResolvedValue(projectName),
    password: vi.fn().mockResolvedValue(''),
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue(adapterChoice),
  }
}

describe('runInit', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'manguito-init-test-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('aborts with guided error and writes no files when target directory is non-empty', async () => {
    // Make the target dir non-empty
    writeFileSync(join(tempDir, 'existing-file.txt'), 'content')

    await runInit(undefined, { prompt: makePrompt(), targetDir: tempDir })

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not empty'))
    // Only the pre-existing file should be present — init wrote nothing
    const entries = readdirSync(tempDir)
    expect(entries).toEqual(['existing-file.txt'])
  })

  it('writes all expected scaffold files to targetDir', async () => {
    const prompt = makePrompt('my-project')
    await runInit('my-project', { prompt, targetDir: tempDir })

    const projectDir = join(tempDir, 'my-project')

    const expectedFiles = [
      'manguito.config.ts',
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.env.example',
      'README.md',
      'schemas/roles.json',
      'schemas/routes.json',
      'schemas/content-types/blog-post.json',
      'schemas/taxonomy-types/tag.json',
      'schemas/paragraph-types/.gitkeep',
    ]

    for (const file of expectedFiles) {
      expect(existsSync(join(projectDir, file)), `expected ${file} to exist`).toBe(true)
    }
  })

  it('substitutes projectName into rendered config', async () => {
    const prompt = makePrompt('acme-blog', 'Amazon S3')
    await runInit('acme-blog', { prompt, targetDir: tempDir })

    const configContent = readFileSync(
      join(tempDir, 'acme-blog', 'manguito.config.ts'),
      'utf8'
    )
    expect(configContent).toContain("name: 'acme-blog'")
  })

  it('scaffolds @types/node so the config typechecks (process.env)', async () => {
    const prompt = makePrompt('types-test')
    await runInit('types-test', { prompt, targetDir: tempDir })

    const pkg = JSON.parse(
      readFileSync(join(tempDir, 'types-test', 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.['@types/node']).toBeDefined()
  })

  it('leaves no unrendered {{placeholders}} in scaffold output', async () => {
    const prompt = makePrompt('ph-test', 'Cloudinary')
    await runInit('ph-test', { prompt, targetDir: tempDir })

    const projectDir = join(tempDir, 'ph-test')
    for (const file of ['manguito.config.ts', '.env.example']) {
      const content = readFileSync(join(projectDir, file), 'utf8')
      expect(content, `${file} still has a placeholder`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each([
    {
      choice: 'Local filesystem',
      factory: 'createLocalAdapter(',
      others: ['createS3Adapter', 'createCloudinaryAdapter'],
      envVar: 'STORAGE_LOCAL_UPLOAD_DIR',
    },
    {
      choice: 'Amazon S3',
      factory: 'createS3Adapter(',
      others: ['createLocalAdapter', 'createCloudinaryAdapter'],
      envVar: 'STORAGE_S3_BUCKET',
    },
    {
      choice: 'Cloudinary',
      factory: 'createCloudinaryAdapter(',
      others: ['createLocalAdapter', 'createS3Adapter'],
      envVar: 'CLOUDINARY_CLOUD_NAME',
    },
  ])(
    'wires a real $factory call and matching env vars for $choice',
    async ({ choice, factory, others, envVar }) => {
      const prompt = makePrompt('store-test', choice)
      await runInit('store-test', { prompt, targetDir: tempDir })

      const projectDir = join(tempDir, 'store-test')
      const config = readFileSync(join(projectDir, 'manguito.config.ts'), 'utf8')
      const env = readFileSync(join(projectDir, '.env.example'), 'utf8')

      // storage is a real factory call, not a bare identifier like `storage: s3,`
      expect(config).toContain(`storage: ${factory}`)
      // the chosen factory is imported
      expect(config).toContain(`import { ${factory.replace('(', '')} }`)
      // the other adapters are NOT imported (only the chosen one)
      for (const other of others) {
        expect(config, `${other} should not be imported`).not.toContain(other)
      }
      // the .env.example carries the env var(s) for the chosen adapter
      expect(env).toContain(envVar)
    }
  )

  it('strips the .template extension from output filenames', async () => {
    const prompt = makePrompt('strip-test')
    await runInit('strip-test', { prompt, targetDir: tempDir })

    const projectDir = join(tempDir, 'strip-test')

    // No file should end with .template
    function hasTemplateFiles(dir: string): boolean {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (hasTemplateFiles(join(dir, entry.name))) return true
        } else if (entry.name.endsWith('.template')) {
          return true
        }
      }
      return false
    }

    expect(hasTemplateFiles(projectDir)).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PromptAdapter } from '../src/prompt.js'

import { scaffold } from '../src/scaffold.js'

function makePrompt(projectName = 'test-project', adapterChoice = 'Local filesystem'): PromptAdapter {
  return {
    input: vi.fn().mockResolvedValue(projectName),
    select: vi.fn().mockResolvedValue(adapterChoice),
  }
}

describe('scaffold', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'create-manguito-test-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('aborts with a guided error and writes nothing when the target dir is non-empty', async () => {
    writeFileSync(join(tempDir, 'existing-file.txt'), 'content')

    await scaffold(undefined, { prompt: makePrompt(), targetDir: tempDir })

    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not empty'))
    expect(readdirSync(tempDir)).toEqual(['existing-file.txt'])
  })

  it('writes all expected scaffold files to targetDir', async () => {
    await scaffold('my-project', { prompt: makePrompt('my-project'), targetDir: tempDir })

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
    await scaffold('acme-blog', { prompt: makePrompt('acme-blog', 'Amazon S3'), targetDir: tempDir })
    const config = readFileSync(join(tempDir, 'acme-blog', 'manguito.config.ts'), 'utf8')
    expect(config).toContain("name: 'acme-blog'")
  })

  it('scaffolds @types/node so the config typechecks (process.env)', async () => {
    await scaffold('types-test', { prompt: makePrompt('types-test'), targetDir: tempDir })
    const pkg = JSON.parse(
      readFileSync(join(tempDir, 'types-test', 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies?.['@types/node']).toBeDefined()
  })

  it('leaves no unrendered {{placeholders}} in scaffold output', async () => {
    await scaffold('ph-test', { prompt: makePrompt('ph-test', 'Cloudinary'), targetDir: tempDir })
    const projectDir = join(tempDir, 'ph-test')
    for (const file of ['manguito.config.ts', '.env.example']) {
      const content = readFileSync(join(projectDir, file), 'utf8')
      expect(content, `${file} still has a placeholder`).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it.each([
    { choice: 'Local filesystem', factory: 'createLocalAdapter(', others: ['createS3Adapter', 'createCloudinaryAdapter'], envVar: 'STORAGE_LOCAL_UPLOAD_DIR' },
    { choice: 'Amazon S3', factory: 'createS3Adapter(', others: ['createLocalAdapter', 'createCloudinaryAdapter'], envVar: 'STORAGE_S3_BUCKET' },
    { choice: 'Cloudinary', factory: 'createCloudinaryAdapter(', others: ['createLocalAdapter', 'createS3Adapter'], envVar: 'CLOUDINARY_CLOUD_NAME' },
  ])('wires a real $factory call and matching env vars for $choice', async ({ choice, factory, others, envVar }) => {
    await scaffold('store-test', { prompt: makePrompt('store-test', choice), targetDir: tempDir })

    const projectDir = join(tempDir, 'store-test')
    const config = readFileSync(join(projectDir, 'manguito.config.ts'), 'utf8')
    const env = readFileSync(join(projectDir, '.env.example'), 'utf8')

    expect(config).toContain(`storage: ${factory}`)
    expect(config).toContain(`import { ${factory.replace('(', '')} }`)
    for (const other of others) {
      expect(config, `${other} should not be imported`).not.toContain(other)
    }
    expect(env).toContain(envVar)
  })
})

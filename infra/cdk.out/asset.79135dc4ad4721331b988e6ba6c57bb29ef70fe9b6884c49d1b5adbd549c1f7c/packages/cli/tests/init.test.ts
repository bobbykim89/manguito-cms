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
      'roles.json',
      'routes.json',
      'schemas/content-types/blog-post.json',
      'schemas/taxonomy-types/tag.json',
      'schemas/paragraph-types/.gitkeep',
    ]

    for (const file of expectedFiles) {
      expect(existsSync(join(projectDir, file)), `expected ${file} to exist`).toBe(true)
    }
  })

  it('substitutes projectName and storageAdapter in rendered file content', async () => {
    const prompt = makePrompt('acme-blog', 'Amazon S3')
    await runInit('acme-blog', { prompt, targetDir: tempDir })

    const projectDir = join(tempDir, 'acme-blog')
    const configContent = readFileSync(join(projectDir, 'manguito.config.ts'), 'utf8')
    const envContent = readFileSync(join(projectDir, '.env.example'), 'utf8')

    expect(configContent).toContain('acme-blog')
    expect(configContent).toContain('s3')
    expect(envContent).toContain('s3')
  })

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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from '../utils/env.js'

const TEMP_ENV_VAR = 'MANGUITO_TEST_ENV_VAR'
const TEMP_ENV_VALUE = 'test-value-12345'

describe('loadEnvFile', () => {
  let tempFile: string

  beforeEach(() => {
    tempFile = join(tmpdir(), `manguito-env-test-${Date.now()}.env`)
    delete process.env[TEMP_ENV_VAR]
  })

  afterEach(() => {
    try { unlinkSync(tempFile) } catch { /* already deleted or never created */ }
    delete process.env[TEMP_ENV_VAR]
    vi.restoreAllMocks()
  })

  it('loads variables into process.env from a valid file', () => {
    writeFileSync(tempFile, `${TEMP_ENV_VAR}=${TEMP_ENV_VALUE}\n`)
    loadEnvFile(tempFile)
    expect(process.env[TEMP_ENV_VAR]).toBe(TEMP_ENV_VALUE)
  })

  it('does nothing when filePath is undefined', () => {
    loadEnvFile(undefined)
    expect(process.env[TEMP_ENV_VAR]).toBeUndefined()
  })

  it('prints a guided error and calls process.exit(1) when file does not exist', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`)
    })

    expect(() => loadEnvFile('/nonexistent/path/missing.env')).toThrow('process.exit(1)')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/^✖/))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

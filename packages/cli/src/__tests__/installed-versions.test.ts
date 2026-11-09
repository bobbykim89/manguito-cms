import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { installedManguitoVersions } from '../commands/build.js'

const SANDBOX = resolve(__dirname, '../../../../apps/sandbox')

describe('installedManguitoVersions', () => {
  // MUTATION: resolving `<pkg>/package.json` directly throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED (the packages' exports omit it), the package
  // is skipped, and its key goes missing from the result.
  it('finds every manguito package installed for the sandbox, with a version', () => {
    const versions = installedManguitoVersions(SANDBOX)
    expect(Object.keys(versions).sort()).toEqual([
      '@bobbykim/manguito-cms-admin',
      '@bobbykim/manguito-cms-api',
      '@bobbykim/manguito-cms-cli',
      '@bobbykim/manguito-cms-core',
      '@bobbykim/manguito-cms-db',
      'running-cli',
    ])
    for (const version of Object.values(versions)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  // MUTATION: not recording the running cli leaves 'running-cli' out of the result.
  it("records the running cli's own version under running-cli", () => {
    const own = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }
    expect(installedManguitoVersions(SANDBOX)['running-cli']).toBe(own.version)
  })
})

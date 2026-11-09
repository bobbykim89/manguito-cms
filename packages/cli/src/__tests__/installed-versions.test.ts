import { describe, it, expect } from 'vitest'
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
    ])
    for (const version of Object.values(versions)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    }
  })
})

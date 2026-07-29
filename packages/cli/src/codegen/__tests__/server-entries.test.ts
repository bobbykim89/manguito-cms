import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('server-entries codegen template', () => {
  // The generated template string should thread config.api.graphql into createCmsApp
  // so built/deployed servers mount /graphql when a graphql config is present.
  it('server-entries template threads graphql config', () => {
    const src = readFileSync(join(__dirname, '../server-entries.ts'), 'utf8')
    expect(src).toContain('config.api.graphql')
    expect(src).toContain('graphql: config.api.graphql')
  })
})

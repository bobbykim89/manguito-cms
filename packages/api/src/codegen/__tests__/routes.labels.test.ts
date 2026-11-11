import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { generateRoutes } from '../routes'
import { makeCardinalityFixture } from '../../__tests__/relation-cardinality.fixture'

// #68: a type's label is free text, and every route description quotes it.
const LABEL = `Author's "Note" \\ draft`

function registryWithLabel(label: string) {
  const fx = makeCardinalityFixture('rclb')
  const registry = structuredClone(fx.registry)
  registry.content_types[fx.names.post]!.label = label
  registry.taxonomy_types[fx.names.tag]!.label = label
  return registry
}

function syntaxErrors(code: string): string[] {
  const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'routes.ts' })
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('generated routes quote a type label safely', () => {
  it('stays valid TypeScript when the label holds quotes and a backslash', () => {
    // MUTATION: interpolate the label into single quotes (`description: '${label} not found'`).
    // The apostrophe in "Author's" then ends the string and the file no longer parses.
    expect(syntaxErrors(generateRoutes(registryWithLabel(LABEL)))).toEqual([])
  })

  it('keeps the label text exact in every description', () => {
    // MUTATION: strip or replace the apostrophe instead of escaping it. The file
    // parses, but the docs no longer show the label the author wrote.
    const code = generateRoutes(registryWithLabel(LABEL))
    const descriptions = [...code.matchAll(/description: (".*"),$/gm)].map((m) => JSON.parse(m[1]!) as string)
    const labelled = descriptions.filter((d) => d.includes('Note'))
    // Content and taxonomy routes each describe their type several times.
    expect(labelled.length).toBeGreaterThan(10)
    for (const d of labelled) expect(d).toContain(LABEL)
    for (const text of [LABEL, `List of ${LABEL}`, `${LABEL} not found`, `${LABEL} created`, `${LABEL} updated`, `${LABEL} deleted`]) {
      expect(descriptions).toContain(text)
    }
  })
})

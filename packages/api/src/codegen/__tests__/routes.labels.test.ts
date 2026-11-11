import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { buildSchemaRegistry, type ParsedContentType } from '@bobbykim/manguito-cms-core'
import { generateRoutes } from '../routes'
import { makeCardinalityFixture, parseOrThrow } from '../../__tests__/relation-cardinality.fixture'

// #68: a type's label, and a singleton's base path, are free text that the
// generated routes quote.
const LABEL = `Author's "Note" \\ draft`

function registryWithLabel(label: string) {
  const fx = makeCardinalityFixture('rclb')
  const registry = structuredClone(fx.registry)
  registry.content_types[fx.names.post]!.label = label
  registry.taxonomy_types[fx.names.tag]!.label = label
  return registry
}

// A singleton takes its item path from `default_base_path`, which core accepts
// as any non-empty string.
function singletonRegistry(label: string, basePath: string) {
  const about = parseOrThrow(
    {
      name: 'content--rclb_about',
      label,
      type: 'content-type',
      default_base_path: basePath,
      only_one: true,
      fields: [{ tab: { name: 'main', label: 'Main', fields: [{ name: 'body', label: 'Body', type: 'text/plain', required: false }] } }],
    },
    'content-type',
  )
  return buildSchemaRegistry([about], { base_paths: [] }, { roles: [], valid_permissions: [] })
}

function syntaxErrors(code: string): string[] {
  const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'routes.ts' })
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

function descriptionsOf(code: string): string[] {
  return [...code.matchAll(/description: (".*"),$/gm)].map((m) => JSON.parse(m[1]!) as string)
}

describe('generated routes quote a type label safely', () => {
  it('stays valid TypeScript when the label holds quotes and a backslash', () => {
    // MUTATION: interpolate the label into single quotes (`description: '${label} not found'`).
    // The apostrophe in "Author's" then ends the string and the file no longer parses.
    expect(syntaxErrors(generateRoutes(registryWithLabel(LABEL)))).toEqual([])
  })

  it('keeps the label text exact in every description', () => {
    // MUTATION: strip or replace the apostrophe in one description instead of
    // escaping it. The file parses, but that description loses the label.
    const descriptions = descriptionsOf(generateRoutes(registryWithLabel(LABEL)))
    const labelled = descriptions.filter((d) => d.includes('Note'))
    // Content and taxonomy routes each describe their type several times.
    expect(labelled.length).toBeGreaterThan(10)
    for (const d of labelled) expect(d).toContain(LABEL)
    for (const text of [LABEL, `List of ${LABEL}`, `${LABEL} not found`, `${LABEL} created`, `${LABEL} updated`, `${LABEL} deleted`]) {
      expect(descriptions).toContain(text)
    }
  })
})

describe('generated singleton routes quote the label and the base path safely', () => {
  const registry = singletonRegistry(LABEL, `author's`)
  const about = registry.content_types['content--rclb_about'] as ParsedContentType

  it('stays valid TypeScript when the label and the base path hold quotes', () => {
    // MUTATION: put a singleton path back in single quotes (`path: '${itemPath}'`).
    // The apostrophe in the base path then ends the string.
    expect(about.api.item_path).toContain(`author's`)
    expect(syntaxErrors(generateRoutes(registry))).toEqual([])
  })

  it('keeps the label exact in every singleton description, and the path exact', () => {
    // MUTATION: strip the apostrophe from one singleton description. That
    // description then no longer contains the label.
    const code = generateRoutes(registry)
    const labelled = descriptionsOf(code).filter((d) => d.includes('Note'))
    expect(labelled.length).toBeGreaterThan(3)
    for (const d of labelled) expect(d).toContain(LABEL)
    expect(code).toContain(`path: ${JSON.stringify(about.api.item_path)},`)
  })
})

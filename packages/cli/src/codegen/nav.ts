import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

function schemaBasePath(name: string): string {
  const segment = name.includes('--') ? name.slice(name.indexOf('--') + 2) : name
  return segment.replace(/_/g, '-')
}

export async function generateNav(
  registry: SchemaRegistry,
  targetDir: string
): Promise<void> {
  const contentTypes = Object.values(registry.content_types)
    .map((schema) => ({
      name: schema.name,
      label: schema.label,
      basePath: schema.default_base_path,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const taxonomyTypes = Object.values(registry.taxonomy_types)
    .map((schema) => ({
      name: schema.name,
      label: schema.label,
      basePath: schemaBasePath(schema.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const content = `export const nav = ${JSON.stringify({ contentTypes, taxonomyTypes }, null, 2)}\n`
  await writeFile(join(targetDir, 'nav.ts'), content, 'utf8')
}

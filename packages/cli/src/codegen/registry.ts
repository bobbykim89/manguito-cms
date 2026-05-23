import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

export async function generateSchemaRegistry(
  registry: SchemaRegistry,
  targetDir: string
): Promise<void> {
  const content = `export const schemaRegistry = ${JSON.stringify(registry, null, 2)} as const\n`
  await writeFile(join(targetDir, 'schema-registry.ts'), content, 'utf8')
}

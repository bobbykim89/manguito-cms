import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { generateFormComponent } from '@bobbykim/manguito-cms-admin/codegen'

export async function generateForms(
  registry: SchemaRegistry,
  formsDir: string
): Promise<void> {
  await mkdir(formsDir, { recursive: true })

  // Topological order: paragraph first (content forms may import them), then taxonomy, then content.
  const schemas = [
    ...Object.values(registry.paragraph_types),
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.content_types),
  ]

  for (const schema of schemas) {
    const content = generateFormComponent(schema)
    await writeFile(join(formsDir, `${schema.name}.vue`), content, 'utf8')
  }
}

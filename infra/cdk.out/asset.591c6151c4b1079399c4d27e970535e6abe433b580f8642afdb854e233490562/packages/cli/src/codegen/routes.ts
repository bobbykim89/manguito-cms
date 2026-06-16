import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { generateRoutes as apiGenerateRoutes } from '@bobbykim/manguito-cms-api/codegen'

export async function generateRoutes(
  registry: SchemaRegistry,
  targetDir: string
): Promise<void> {
  const content = apiGenerateRoutes(registry)
  await writeFile(join(targetDir, 'routes.ts'), content, 'utf8')
}

import { writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { ResolvedManguitoConfig } from '@bobbykim/manguito-cms-core'

export async function generateDrizzleConfig(
  config: ResolvedManguitoConfig,
  targetDir: string
): Promise<void> {
  const migrationsFolder = config.migrations?.folder ?? './migrations'
  const outPath = relative(resolve(targetDir), resolve(migrationsFolder)).replace(/\\/g, '/')

  const content = [
    `import { defineConfig } from 'drizzle-kit'`,
    ``,
    `export default defineConfig({`,
    `  schema: './schema.ts',`,
    `  out: '${outPath}',`,
    `  dialect: 'postgresql',`,
    `  dbCredentials: {`,
    `    url: process.env.DATABASE_URL!,`,
    `  },`,
    `})`,
  ].join('\n')

  await writeFile(join(targetDir, 'drizzle.config.ts'), content, 'utf8')
}

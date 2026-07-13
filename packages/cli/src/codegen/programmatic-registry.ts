import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

// Import specifier from the generated file (in targetDir) to a resolver file,
// normalised to a POSIX relative path with a .js extension (esbuild/tsup resolve
// the .js specifier back to the .ts source, matching how the config is imported).
function importSpecifier(targetDir: string, file: string): string {
  let rel = relative(targetDir, file).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel.replace(/\.ts$/, '.js')
}

export async function generateProgrammaticRegistry(
  files: string[],
  targetDir: string,
): Promise<void> {
  const sorted = [...files].sort()
  const imports = sorted
    .map((file, i) => `import def${i} from '${importSpecifier(targetDir, file)}'`)
    .join('\n')

  // Build the Map at runtime from each definition's own schema/field so the
  // generated file need not re-derive keys (keeping it robust to renames).
  const defs = sorted.map((_f, i) => `def${i}`)
  const entries = defs
    .map((d) => `  [\`\${${d}.schema}::\${${d}.field}\`, ${d}] as const`)
    .join(',\n')

  const typeImport =
    "import type { ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'"

  const body =
    sorted.length === 0
      ? `${typeImport}\n\nexport const programmaticResolvers = new Map<string, ProgrammaticFieldDefinition>()\n`
      : `${typeImport}\n${imports}\n\nexport const programmaticResolvers = new Map<string, ProgrammaticFieldDefinition>([\n${entries},\n])\n`

  await writeFile(join(targetDir, 'programmatic-registry.ts'), body, 'utf8')
}

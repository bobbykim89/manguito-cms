import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'
import { resolverKey, type ResolverMap } from '@bobbykim/manguito-cms-api'

const RESOLVER_EXTENSIONS = new Set(['.ts', '.mjs', '.js'])

function isProgrammaticFieldDefinition(v: unknown): v is ProgrammaticFieldDefinition {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v as { __manguito_programmatic?: unknown }).__manguito_programmatic === true &&
    typeof (v as { schema?: unknown }).schema === 'string' &&
    typeof (v as { field?: unknown }).field === 'string' &&
    typeof (v as { resolve?: unknown }).resolve === 'function'
  )
}

async function walkTsFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkTsFiles(full)))
    } else if (RESOLVER_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

export async function loadProgrammaticResolvers(cwd: string, dir: string): Promise<ResolverMap> {
  const abs = resolve(cwd, dir)
  const map: ResolverMap = new Map()
  if (!existsSync(abs)) return map

  for (const file of (await walkTsFiles(abs)).sort()) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
    const def = mod.default
    if (!isProgrammaticFieldDefinition(def)) {
      throw new Error(
        `✗ ${file} does not default-export a programmaticField(). ` +
          `Each resolver file must \`export default programmaticField({ schema, field }, resolver)\`.`,
      )
    }
    const key = resolverKey(def.schema, def.field)
    if (map.has(key)) {
      throw new Error(`✗ Duplicate programmatic resolver for ${key} (found again in ${file}).`)
    }
    map.set(key, def)
  }
  return map
}

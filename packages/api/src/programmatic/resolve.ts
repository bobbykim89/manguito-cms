import type {
  ProgrammaticFieldDefinition,
  ResolverContext,
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
} from '@bobbykim/manguito-cms-core'

export type ResolverMap = Map<string, ProgrammaticFieldDefinition>

const DEFAULT_TIMEOUT_MS = 5000
const LIST_CONCURRENCY = 10

export function resolverKey(schema: string, field: string): string {
  return `${schema}::${field}`
}

// ─── Boot-time binding validation ─────────────────────────────────────────────

// Startup guard (throws, like createCmsApp's storage/roles checks): every
// programmatic field must have exactly one resolver, and every resolver must
// target an existing programmatic field.
export function validateResolverBindings(
  registry: SchemaRegistry,
  resolvers: ResolverMap,
): void {
  const declared = new Set<string>()
  const schemas: Array<ParsedContentType | ParsedTaxonomyType> = [
    ...(Object.values(registry.content_types) as ParsedContentType[]),
    ...(Object.values(registry.taxonomy_types) as ParsedTaxonomyType[]),
  ]
  for (const schema of schemas) {
    for (const field of schema.fields) {
      if (field.field_type === 'programmatic') {
        declared.add(resolverKey(schema.name, field.name))
      }
    }
  }

  const missing: string[] = []
  for (const key of declared) if (!resolvers.has(key)) missing.push(key)

  const orphans: string[] = []
  for (const key of resolvers.keys()) if (!declared.has(key)) orphans.push(key)

  if (missing.length === 0 && orphans.length === 0) return

  const lines: string[] = ['✗ Programmatic field resolver bindings are invalid.']
  if (missing.length > 0) {
    lines.push('', '  Declared as `type: "programmatic"` but no resolver found:')
    for (const k of missing) lines.push(`    - ${k}  (add a programmaticField in src/programmatic)`)
  }
  if (orphans.length > 0) {
    lines.push('', '  Resolver has no matching programmatic field in the schema:')
    for (const k of orphans) lines.push(`    - ${k}`)
  }
  lines.push('', 'Exiting.')
  throw new Error(lines.join('\n'))
}

// ─── Runtime resolution ───────────────────────────────────────────────────────

function buildContext(row: Record<string, unknown>): ResolverContext {
  return {
    get: (name) => row[name],
    record: row,
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('resolver timeout')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// Runs one resolver against one row; never throws. Failure/timeout → fallback.
async function runOne(
  def: ProgrammaticFieldDefinition,
  row: Record<string, unknown>,
  onError: (message: string) => void,
): Promise<{ value: unknown; failed: boolean }> {
  const fallback = def.fallback ?? null
  try {
    const result = await withTimeout(
      Promise.resolve(def.resolve(buildContext(row))),
      def.timeout ?? DEFAULT_TIMEOUT_MS,
    )
    return { value: result === undefined ? null : result, failed: false }
  } catch (err) {
    onError(
      `⚠ programmatic field ${resolverKey(def.schema, def.field)} failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { value: fallback, failed: true }
  }
}

// Fixed-size worker pool.
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx]!)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
}

export function createProgrammaticResolver(
  resolvers: ResolverMap,
  options?: { onError?: (message: string) => void },
) {
  const onError =
    options?.onError ??
    ((message: string) => {
      process.stderr.write(message + '\n')
    })

  // Group definitions by schema once.
  const bySchema = new Map<string, ProgrammaticFieldDefinition[]>()
  for (const def of resolvers.values()) {
    const arr = bySchema.get(def.schema) ?? []
    arr.push(def)
    bySchema.set(def.schema, arr)
  }

  // Per-process cache. Key = schema::field::itemId.
  const cache = new Map<string, { value: unknown; expires: number }>()

  async function resolveField(
    def: ProgrammaticFieldDefinition,
    row: Record<string, unknown>,
  ): Promise<unknown> {
    const itemId = row['id'] !== undefined ? String(row['id']) : ''
    if (def.cache && itemId) {
      const key = `${resolverKey(def.schema, def.field)}::${itemId}`
      const now = Date.now()
      const hit = cache.get(key)
      if (hit && hit.expires > now) return hit.value
      const { value, failed } = await runOne(def, row, onError)
      if (!failed) cache.set(key, { value, expires: now + def.cache.ttl * 1000 })
      return value
    }
    const { value } = await runOne(def, row, onError)
    return value
  }

  async function resolveItem(
    schema: string,
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defs = bySchema.get(schema)
    if (!defs || defs.length === 0) return { ...row }
    const out: Record<string, unknown> = { ...row }
    await Promise.all(
      defs.map(async (def) => {
        out[def.field] = await resolveField(def, row)
      }),
    )
    return out
  }

  async function resolveList(
    schema: string,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const defs = (bySchema.get(schema) ?? []).filter((d) => d.on_list === true)
    if (defs.length === 0) return rows.map((r) => ({ ...r }))
    const out = rows.map((r) => ({ ...r }))
    const tasks: Array<{ rowIndex: number; def: ProgrammaticFieldDefinition }> = []
    for (let i = 0; i < rows.length; i++) {
      for (const def of defs) tasks.push({ rowIndex: i, def })
    }
    await runPool(tasks, LIST_CONCURRENCY, async ({ rowIndex, def }) => {
      out[rowIndex]![def.field] = await resolveField(def, rows[rowIndex]!)
    })
    return out
  }

  function hasSchema(schema: string): boolean {
    return bySchema.has(schema)
  }

  return { resolveItem, resolveList, hasSchema }
}

export type ProgrammaticResolver = ReturnType<typeof createProgrammaticResolver>

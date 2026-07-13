// Public primitive: authors declare a programmatic field's binding + behavior
// and its resolver in one call. Framework-agnostic — no downstream imports.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// Same-row read context. `get` is synchronous — the record is already loaded
// before any resolver runs, so there is no I/O behind it.
export type ResolverContext = {
  get(fieldName: string): unknown
  readonly record: Readonly<Record<string, unknown>>
}

export type Resolver = (
  ctx: ResolverContext,
) => JsonValue | null | Promise<JsonValue | null>

export type ProgrammaticFieldOptions = {
  schema: string
  field: string
  cache?: { ttl: number }
  on_list?: boolean
  fallback?: JsonValue | null
  timeout?: number
}

export type ProgrammaticFieldDefinition = ProgrammaticFieldOptions & {
  readonly __manguito_programmatic: true
  resolve: Resolver
}

export function programmaticField(
  options: ProgrammaticFieldOptions,
  resolve: Resolver,
): ProgrammaticFieldDefinition {
  return { ...options, resolve, __manguito_programmatic: true }
}

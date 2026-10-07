import type { FieldChange, SchemaChange } from '@bobbykim/manguito-cms-core'

// One line per changed field. The marker carries the kind so a long report
// stays scannable; the text after it carries the consequence, because the
// author's question is "what am I committing to", not "what is the kind".
function formatField(change: FieldChange): string {
  switch (change.kind) {
    case 'added':
      return `  + ${change.name}  ${change.field_type}  new`
    case 'renamed':
      return `  ~ ${change.to_name}  was "${change.from_name}"  → column ${change.column}`
    case 'tombstoned': {
      const fallback =
        change.fallback === undefined ? '' : `, fallback ${JSON.stringify(change.fallback)}`
      return `  ⊘ ${change.name}  tombstoned  → column ${change.column} retained${fallback}`
    }
    case 'restored':
      return `  ↺ ${change.name}  restored  → column ${change.column} exposed again`
  }
}

/**
 * The change report body, without a trailing newline. Pure — the caller
 * prints it, so this is directly assertable in a test.
 */
export function formatSchemaChange(change: SchemaChange): string {
  const header =
    change.from === null
      ? `Working schema — nothing has been created yet, so ${change.to} would be the first version`
      : `Working schema vs ${change.from} (highest snapshot) — would become ${change.to}`

  if (change.identical) {
    return `${header}\n\nNo column added, renamed, tombstoned or restored.`
  }

  const blocks = change.types.map((type) => {
    const label = type.status === 'added' ? `${type.type}  (new type)` : type.type
    if (type.fields.length === 0) return `${label}\n  (no changes)`
    return [label, ...type.fields.map(formatField)].join('\n')
  })

  return [header, '', ...blocks].join('\n')
}

// One count per kind, summed across types, so a version's line says how far
// behind current it is without the per-field detail `version:diff` gives.
function driftSummary(change: SchemaChange): string {
  const counts = { renamed: 0, tombstoned: 0, added: 0, restored: 0 }
  for (const type of change.types) {
    for (const field of type.fields) counts[field.kind]++
  }
  const parts: string[] = []
  if (counts.renamed > 0) parts.push(`${counts.renamed} renamed`)
  // "removed" is what an author did; "tombstoned" is how the schema records it.
  if (counts.tombstoned > 0) parts.push(`${counts.tombstoned} removed`)
  if (counts.added > 0) parts.push(`${counts.added} added`)
  if (counts.restored > 0) parts.push(`${counts.restored} restored`)
  if (parts.length > 0) return `${parts.join(', ')} since`
  if (change.identical) return 'identical to current'
  // Not identical, yet no column changed: a type was added whose fields are
  // all column-less (paragraph, programmatic or many-to-many). Say so rather
  // than call it identical.
  const newTypes = change.types.filter((t) => t.status === 'added').length
  return `${newTypes} new type${newTypes === 1 ? '' : 's'} since`
}

/**
 * The `version:list` body, without a trailing newline. `older` is every live
 * snapshot, oldest first, each compared with the working schema. Empty means
 * nothing has been created: the newest snapshot can never be retired, so a
 * project with any snapshot always has at least one here.
 */
export function formatVersionList(input: {
  prefix: string
  current: string
  older: Array<{ version: string; change: SchemaChange }>
}): string {
  const { prefix, current, older } = input
  if (older.length === 0) {
    return (
      `No versions created yet. Your working schema is ${current}, served at ${prefix}/${current} and ${prefix}.\n` +
      'Run `manguito version:create` before making a breaking change.'
    )
  }

  const rows: Array<[string, string, string]> = [
    ...older.map((o): [string, string, string] => [o.version, `${prefix}/${o.version}`, driftSummary(o.change)]),
    [current, `${prefix}/${current}`, `current — also ${prefix}`],
  ]
  const nameWidth = Math.max(...rows.map((r) => r[0].length))
  const pathWidth = Math.max(...rows.map((r) => r[1].length))
  return [
    `Live versions (${rows.length}):`,
    ...rows.map(([name, url, note]) => `  ${name.padEnd(nameWidth)}  ${url.padEnd(pathWidth)}  ${note}`),
  ].join('\n')
}

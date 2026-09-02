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
      ? `Working schema — nothing has been cut yet, so ${change.to} would be the first version`
      : `Working schema vs ${change.from} (highest snapshot) — would become ${change.to}`

  if (change.identical) {
    return `${header}\n\nNo changes.`
  }

  const blocks = change.types.map((type) => {
    const label = type.status === 'added' ? `${type.type}  (new type)` : type.type
    if (type.fields.length === 0) return `${label}\n  (no changes)`
    return [label, ...type.fields.map(formatField)].join('\n')
  })

  return [header, '', ...blocks].join('\n')
}

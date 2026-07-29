// "content--blog_post" → "blog_post"; "category" → "category"
export function schemaSegment(machineName: string): string {
  const idx = machineName.indexOf('--')
  return idx === -1 ? machineName : machineName.slice(idx + 2)
}

function words(input: string): string[] {
  return input.split(/[_\s-]+/).filter(Boolean)
}

export function toPascalCase(input: string): string {
  return words(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// Deterministic English pluralization for the common cases; irregular plurals
// (person→people) are a known limitation — an optional per-type override can be
// added later if one is wrong.
export function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es'
  return word + 's'
}

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/
export function isValidGraphQLName(name: string): boolean {
  return GRAPHQL_NAME.test(name)
}

export function graphqlTypeName(machineName: string): string {
  return toPascalCase(schemaSegment(machineName))
}

export function singleQueryName(machineName: string): string {
  return toCamelCase(schemaSegment(machineName))
}

export function collectionQueryName(machineName: string): string {
  return pluralize(singleQueryName(machineName))
}

export function buildFieldNameMap(schemaNames: string[]): {
  toGraphql(schemaName: string): string
  toSchema(graphqlName: string): string
} {
  const toG = new Map<string, string>()
  const toS = new Map<string, string>()
  for (const name of schemaNames) {
    const g = toCamelCase(name)
    toG.set(name, g)
    toS.set(g, name)
  }
  return {
    toGraphql: (schemaName) => toG.get(schemaName) ?? toCamelCase(schemaName),
    toSchema: (graphqlName) => toS.get(graphqlName) ?? graphqlName,
  }
}

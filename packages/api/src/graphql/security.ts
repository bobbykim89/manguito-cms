import { EnvelopArmor } from '@escape.tech/graphql-armor'
import { NoSchemaIntrospectionCustomRule } from 'graphql'

// Depth + cost + alias + directive limits via GraphQL Armor. Returns { plugins } to
// spread into Yoga's `plugins` array.
//
// Note: the installed `@escape.tech/graphql-armor` (3.2.0) exports `EnvelopArmor`, a
// class whose `.protect()` returns `{ plugins }` — the standalone `EnvelopArmorPlugin`
// export is a function that returns a single plugin, not a class with `.protect()`.
export function buildArmorPlugin(options: { maxDepth: number; maxComplexity: number }): {
  plugins: unknown[]
} {
  const armor = new EnvelopArmor({
    maxDepth: { n: options.maxDepth },
    costLimit: { maxCost: options.maxComplexity },
    maxAliases: { n: 15 },
    maxDirectives: { n: 50 },
    blockFieldSuggestion: { enabled: true },
    // Armor enables maxTokens by default even when omitted from config; the plan
    // only asks for depth/cost/alias/directive/field-suggestion limits, so disable
    // it explicitly rather than silently shipping an extra, unspecified protection.
    maxTokens: { enabled: false },
  })
  return armor.protect()
}

// Disables introspection (and the __schema/__type meta-fields) in production by
// adding graphql's built-in validation rule when `enabled` is false.
export function introspectionPlugin(enabled: boolean): {
  onValidate(payload: { addValidationRule: (rule: unknown) => void }): void
} {
  return {
    onValidate({ addValidationRule }) {
      if (!enabled) addValidationRule(NoSchemaIntrospectionCustomRule)
    },
  }
}

// Browser-safe subpath entry: `@bobbykim/manguito-cms-core/cardinality`.
// The admin bundle runs in a browser and must not import core's main entry,
// which also exports Node-only code (the schema file loader, bcryptjs). This
// entry re-exports only the cardinality rule, which has no Node imports.
export { relationCardinality } from './registry/cardinality.js'
export type { Cardinality } from './registry/cardinality.js'

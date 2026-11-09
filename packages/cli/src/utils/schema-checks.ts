import {
  validateCrossReferences,
  type ParseError,
  type SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import { findConstraintNameCollisions } from '@bobbykim/manguito-cms-db'

/**
 * Every check across schemas that the CLI runs on a built registry: core's
 * cross-references, then the db package's Postgres constraint-name collisions.
 * Call this instead of either check so a call site cannot run one and forget
 * the other. Collisions are only reported once the references are sound.
 */
export function checkRegistry(
  registry: SchemaRegistry,
  maxFileSize: number | undefined,
): ParseError[] {
  const crossRefErrors = validateCrossReferences(registry, maxFileSize)
  if (crossRefErrors.length > 0) return crossRefErrors
  return findConstraintNameCollisions(registry)
}

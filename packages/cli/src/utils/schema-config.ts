import { resolve } from 'node:path'
import type { ResolvedManguitoConfig, ResolvedSchemaConfig } from '@bobbykim/manguito-cms-core'

/**
 * The schema config core expects, with `base_path` made absolute.
 *
 * `base_path` is authored relative (it defaults to './schemas'), and core
 * joins it directly — so passing the raw config works only while the process
 * cwd is the project root. Resolving it once here means core's reads and the
 * CLI's own writes under `versions/` agree on a single root, and lets a
 * handler be pointed at a temp directory in a test.
 */
export function resolveSchemaConfig(
  cwd: string,
  config: ResolvedManguitoConfig
): ResolvedSchemaConfig {
  return {
    base_path: resolve(cwd, config.schema.base_path),
    folders: config.schema.folders,
  }
}

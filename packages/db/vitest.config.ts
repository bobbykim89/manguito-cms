import { defineConfig, mergeConfig } from 'vitest/config'
import rootConfig from '../../vitest.config'

// Merge the root config so the shared globalSetup (which migrates + seeds the
// test database the integration suites depend on) still runs — a package-local
// config otherwise fully replaces the root one.
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // Integration tests share a single Postgres instance — run files
      // sequentially to prevent concurrent DDL operations from conflicting.
      fileParallelism: false,
    },
  }),
)

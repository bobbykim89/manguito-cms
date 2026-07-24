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
      testTimeout: 30_000,
      server: {
        deps: {
          // graphql-yoga's dependency chain (@envelop/core, @graphql-tools/*,
          // @whatwg-node/*) must resolve the same `graphql` module instance
          // that our own source imports, or graphql-js's isSchema()/
          // instanceOf() realm check rejects schemas built outside Yoga's
          // copy ("Cannot use GraphQLSchema from another module or realm").
          // All of them need to go through Vite's SSR pipeline together so
          // there is exactly one loaded copy of `graphql`.
          inline: [/graphql/, /@envelop/, /@whatwg-node/],
        },
      },
    },
  }),
)

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integration tests share a single Postgres instance — run files sequentially
    // to prevent concurrent DDL operations from conflicting with each other.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})

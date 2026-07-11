import { cpSync, rmSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  dts: false,
  clean: true,
  bundle: true,
  // Bundle the prompt library so the published package installs with no deps.
  noExternal: ['@inquirer/prompts'],
  // Bundled CJS deps use esbuild's __require shim; inject createRequire so it works.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'module';\nconst require = __cjsRequire(import.meta.url);",
  },
  // Copy templates next to the bundle. Must be idempotent — `cp -r` nests into
  // dist/templates/templates when the target already exists (turbo-cached dist).
  onSuccess: async () => {
    rmSync('dist/templates', { recursive: true, force: true })
    cpSync('src/templates', 'dist/templates', { recursive: true })
  },
})

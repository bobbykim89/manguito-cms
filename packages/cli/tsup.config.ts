import { cpSync, rmSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  shims: true,
  dts: false,
  clean: true,
  bundle: true,
  noExternal: [
    '@bobbykim/manguito-cms-core',
    '@bobbykim/manguito-cms-db',
    '@bobbykim/manguito-cms-api',
    '@bobbykim/manguito-cms-admin',
  ],
  // CJS deps bundled into ESM use esbuild's __require shim, which throws when
  // require() is undefined. Injecting createRequire at the top makes it work.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'module';\nconst require = __cjsRequire(import.meta.url);",
  },
  // Copy the scaffold templates next to the bundle. Must be idempotent: a shell
  // `cp -r src/templates dist/templates` nests into `dist/templates/templates`
  // when the target already exists (e.g. a turbo-cached dist), which shipped a
  // broken scaffolder in 0.1.1. Remove-then-copy via fs is portable and never
  // nests, regardless of prior dist state.
  onSuccess: async () => {
    rmSync('dist/templates', { recursive: true, force: true })
    cpSync('src/templates', 'dist/templates', { recursive: true })
  },
})

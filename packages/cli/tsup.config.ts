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
  // jsdom (pulled in transitively by the api's SVG sanitizer) must not be
  // bundled: it loads asset files (e.g. browser/default-stylesheet.css) via
  // runtime paths that break once inlined. Keep it a require resolved from
  // node_modules.
  external: ['jsdom'],
  // CJS deps bundled into ESM use esbuild's __require shim, which throws when
  // require() is undefined. Injecting createRequire at the top makes it work.
  banner: {
    js: "import { createRequire as __cjsRequire } from 'module';\nconst require = __cjsRequire(import.meta.url);",
  },
  onSuccess: 'cp -r src/templates dist/templates',
})

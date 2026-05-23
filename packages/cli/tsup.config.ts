import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  bundle: true,
  noExternal: [
    '@bobbykim/manguito-cms-core',
    '@bobbykim/manguito-cms-db',
    '@bobbykim/manguito-cms-api',
    '@bobbykim/manguito-cms-admin',
  ],
  onSuccess: 'cp -r src/templates dist/templates',
})

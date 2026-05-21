import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['codegen/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['vue'],
})

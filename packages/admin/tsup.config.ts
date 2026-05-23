import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'codegen/index': 'codegen/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.codegen.json',
  external: ['vue'],
})

import { defineConfig } from 'tsup'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('./package.json') as { version: string }

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/storage/index.ts',
    'src/runtime/index.ts',
    'src/codegen/index.ts',
    'src/graphql/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  define: {
    __API_VERSION__: JSON.stringify(version),
  },
})

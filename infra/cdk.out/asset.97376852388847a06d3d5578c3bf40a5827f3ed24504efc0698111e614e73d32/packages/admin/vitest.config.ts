import { defineConfig } from 'vitest/config'
import { defaultExclude } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  define: {
    __ADMIN_PREFIX__: '"/admin"',
    __API_PREFIX__: '"/api"',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: [...defaultExclude, '__tests__/views/**'],
  },
})

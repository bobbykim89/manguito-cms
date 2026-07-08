import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __ADMIN_PREFIX__: JSON.stringify('/admin'),
    __API_PREFIX__: JSON.stringify('/api'),
  },
  build: {
    // No inline module-preload polyfill — keeps script-src 'self' working
    // without an inline-script exception. Modern browsers preload modules
    // natively via <link rel="modulepreload">.
    modulePreload: { polyfill: false },
  },
})

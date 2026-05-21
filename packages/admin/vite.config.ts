import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __ADMIN_PREFIX__: JSON.stringify('/admin'),
    __API_PREFIX__: JSON.stringify('/api'),
  },
})

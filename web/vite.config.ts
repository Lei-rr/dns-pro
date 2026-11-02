import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// 版本以根 package.json 为唯一源；此处读取的 web/package.json 由 npm run version:sync 同步
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3022',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // vite 8 底层切换为 rolldown，manualChunks 仅支持函数形式
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(vue|vue-router|pinia)\//.test(id)) return 'vendor-vue'
          if (/node_modules\/(reka-ui|@lucide\/vue|class-variance-authority|clsx|tailwind-merge)\//.test(id)) return 'vendor-ui'
          if (/node_modules\/@tanstack\//.test(id)) return 'vendor-query'
          if (/node_modules\/@vueuse\//.test(id)) return 'vendor-utils'
        },
      },
    },
  },
})

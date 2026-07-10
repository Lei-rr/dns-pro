import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
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
        target: 'http://127.0.0.1:2022',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('ant-design-vue') || id.includes('@ant-design')) return 'vendor-antd'
            if (id.includes('vue-router')) return 'vendor-router'
            if (id.includes('pinia')) return 'vendor-pinia'
            if (id.includes('axios')) return 'vendor-axios'
            if (id.includes('@vue') || id.includes('/vue/')) return 'vendor-vue'
            return 'vendor-others'
          }
        },
      },
    },
  },
})

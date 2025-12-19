import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      }
    },
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // 100MB - 内联所有资源
  },
  base: './', // 使用相对路径
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

export default defineConfig({
  root:    resolve(__dirname, 'renderer'),
  plugins: [react()],
  build: {
    outDir:     resolve(__dirname, 'mobile-dist'),
    emptyOutDir: true
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'renderer/src') }
  }
})

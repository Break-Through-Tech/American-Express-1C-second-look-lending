import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development, /api calls are forwarded to the FastAPI server
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
})

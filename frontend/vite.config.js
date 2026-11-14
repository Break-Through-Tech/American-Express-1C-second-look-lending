import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, API calls, the guide and the API docs go to the FastAPI server
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000', '/guide': 'http://localhost:8000', '/docs': 'http://localhost:8000', '/openapi.json': 'http://localhost:8000' },
  },
})

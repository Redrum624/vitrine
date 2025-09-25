import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3005,
    strictPort: true,
    open: false // Don't open browser automatically since we're using Electron
  }
})
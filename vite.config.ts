import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Required for Electron file:// protocol
  server: {
    port: 3005,
    strictPort: true,
    open: false, // Don't open browser automatically since we're using Electron
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor libraries
          vendor: ['react', 'react-dom', 'zustand'],
          // UI components and icons
          ui: ['lucide-react'],
          // Services and utilities
          services: [
            './src/services/ImageProcessingPipeline',
            './src/services/ImageService',
            './src/services/RawImageService'
          ]
        }
      }
    },
    // Optimize chunk size limit
    chunkSizeWarningLimit: 600,
    // Enable source maps for production debugging
    sourcemap: true,
    // Minification options
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    }
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'lucide-react']
  }
})
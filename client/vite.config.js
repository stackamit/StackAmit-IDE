import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The same renderer is used for web mode (served by Vite/host) and Electron
// (loaded from dist/index.html over file://), so assets use a relative base.
// Web workers (Monaco) are emitted as bundled chunks — never loaded from a CDN.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls during development so the browser talks to our backend
    // (never to the execution provider directly).
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Forward WebSocket upgrades so local interactive runs work in dev.
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Monaco + its workers are large; raise the warning ceiling to avoid noise.
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Keep Monaco's worker chunks discrete so Electron can load them by path.
        manualChunks: {
          monaco: ['monaco-editor'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  // No manualChunks. A previous attempt grouped recharts/d3, xlsx and the
  // reports pages into three fixed chunks to "improve caching"; it did the
  // opposite. Forcing modules into a named chunk defeats Rollup's per-route
  // splitting, so the entry ended up statically importing both the recharts
  // and reports chunks — index.html modulepreloaded ~888 kB of charting and
  // reporting code on every route, including the POS, which uses neither.
  // Left to itself, Vite splits along the existing React.lazy() route
  // boundaries and those bytes load only when a report is actually opened.
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    globals: true,
  },
})

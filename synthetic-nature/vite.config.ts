import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // Frontend calls that use relative `/api/...` (e.g. /api/vault/session)
      // would otherwise hit the Vite origin and 404. Forward them to the
      // backend so one origin works in dev. Backend defaults to :5001 (see
      // .env PORT); override with VITE_BACKEND_ORIGIN when it runs elsewhere
      // (e.g. a Docker mapping on :5002) so a fresh clone isn't forced to edit
      // this file. Absolute URLs are unaffected.
      '/api': {
        target: process.env.VITE_BACKEND_ORIGIN || 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})


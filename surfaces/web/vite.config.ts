import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    // Dev-only convenience: the API is answered by `hb web`, not by Vite.
    proxy: { '/api': 'http://127.0.0.1:4771' },
  },
})

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: 3000 },
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    tailwindcss(),
    // TanStack Start in SPA mode: the whole app is client-driven (all WebRTC
    // runs in the browser; signaling lives in the NestJS server), so we ship a
    // prerendered shell + static client bundle. No server adapter needed —
    // deploys to any static host (Vercel) with a catch-all rewrite to the shell.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
})

import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: ['@pipecat-ai/small-webrtc-transport'] },
  plugins: [
    devtools(),
    nitro({
      // Avoid a circular dependency between Drizzle and bundled CommonJS helpers.
      traceDeps: ['drizzle-orm'],
      rollupConfig: { external: [/^@sentry\//] },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    host: true, // Listen on all local IP addresses
    allowedHosts: [
      // '.trycloudflare.com', // Allow all trycloudflare subdomains
      '.wingdo.net', // Allow all wingdo subdomains
    ],
  },
})

export default config

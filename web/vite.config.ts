import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Vite dev server proxies API + WebSocket traffic to the local-pilot
// backend so the frontend and backend can be developed on separate ports.
// In production the backend serves the built `web/dist` itself.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind 0.0.0.0 so it is reachable over the Tailscale node
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});

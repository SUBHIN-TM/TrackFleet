import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Served under /admin on the production domain; dev stays at the root.
  base: mode === 'production' ? '/admin/' : '/',
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    // Pin the HMR websocket explicitly. Without this the client can end up
    // building ws://localhost:undefined (esp. when the server binds IPv6-only),
    // which kills auto-reload and lets stale dep chunks pile up.
    hmr: { host: 'localhost', protocol: 'ws', port: 5174 },
  },
  // Keep a single copy of React and Emotion. Multiple copies make React's
  // internal dispatcher null -> "Cannot read properties of null (useState)".
  resolve: {
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
  },
  // Pre-bundle heavy deps up front so Vite doesn't re-optimize mid-session.
  // Mid-session re-optimization + a dead HMR socket is what left two React
  // bundles loaded at once (same chunk served under several ?v= hashes).
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      '@emotion/react',
      '@emotion/styled',
      '@mui/material',
      '@mui/icons-material',
      'axios',
      'recharts',
      'maplibre-gl',
      '@mapbox/polyline',
    ],
  },
}));

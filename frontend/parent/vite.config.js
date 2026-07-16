import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Served under /guardian on the production domain; dev stays at the root.
  base: mode === 'production' ? '/guardian/' : '/',
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5175,
    strictPort: true,
    hmr: { host: 'localhost', protocol: 'ws', port: 5175 },
  },
  resolve: {
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
  },
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
    ],
  },
}));

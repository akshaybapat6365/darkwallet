import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';

import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@ext': path.resolve(__dirname, 'src'),
      '@web': path.resolve(__dirname, '../../src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3001,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

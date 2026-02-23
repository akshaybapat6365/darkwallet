import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Force IPv4 loopback. On macOS, "localhost" may resolve to ::1 only, and
    // users following the README (`127.0.0.1:3000`) would get connection refused.
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**'],
  },
});

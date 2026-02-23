import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-extension',
  testMatch: '**/*.pw.ts',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e-extension/mock-server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

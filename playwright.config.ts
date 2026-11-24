import { defineConfig } from '@playwright/test';

// Test end-to-end della UI su una copia temporanea dei dati FITTIZI di esempio.
// Su Windows usa Edge già installato; altrove: npx playwright install chromium.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3299',
    channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    locale: 'it-IT',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: 'http://127.0.0.1:3299/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

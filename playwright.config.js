import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4173/english-flashcards/',
    ...devices['Pixel 7'],
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run build && SERVE_DIR=dist node scripts/serve.mjs',
    url: 'http://127.0.0.1:4173/english-flashcards/',
    reuseExistingServer: false
  }
});

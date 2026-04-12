import path from 'path';
import { defineConfig, devices } from '@playwright/test';

process.env.RAIC_SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const nodeBinDir = path.dirname(process.execPath);
const webServerPath = `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ''}`;

export default defineConfig({
  testDir: './e2e/tests',
  // E2E specs share a single dev server and JSON-backed data directories,
  // so parallel workers can trample each other's fixtures.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.CI ? 'corepack pnpm build && corepack pnpm start' : 'corepack pnpm dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === 'true',
    timeout: 120_000,
    env: {
      PATH: webServerPath,
      PORT: '3002',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      OPENAI_MODELS: '',
      TAVILY_API_KEY: '',
      RAIC_SECRET_ENCRYPTION_KEY: process.env.RAIC_SECRET_ENCRYPTION_KEY,
    },
  },
});

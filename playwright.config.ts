import path from 'path';
import { defineConfig, devices } from '@playwright/test';

process.env.RAIC_SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const nodeBinDir = path.dirname(process.execPath);
const webServerPath = `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ''}`;
const ciWebServerCommand =
  process.platform === 'win32'
    ? 'corepack pnpm build && corepack pnpm exec next start'
    : 'corepack pnpm build && node .next/standalone/server.js';
const useDevServer = process.env.PLAYWRIGHT_USE_DEV_SERVER === 'true';
const webServerCommand = useDevServer ? 'corepack pnpm dev' : ciWebServerCommand;

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
    command: webServerCommand,
    url: 'http://localhost:3002',
    reuseExistingServer: useDevServer && process.env.PLAYWRIGHT_REUSE_SERVER === 'true',
    timeout: 120_000,
    env: {
      PATH: webServerPath,
      HOSTNAME: '127.0.0.1',
      PORT: '3002',
      ALLOW_LOCAL_NETWORKS: '1',
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      OPENAI_MODELS: '',
      TAVILY_API_KEY: '',
      MIROFISH_BASE_URL: process.env.MIROFISH_BASE_URL ?? 'http://127.0.0.1:4101',
      MIROFISH_API_BASE_URL: process.env.MIROFISH_API_BASE_URL ?? 'http://127.0.0.1:4101',
      MIROFISH_API_KEY: process.env.MIROFISH_API_KEY ?? '',
      MIROFISH_EMBED_SECRET: process.env.MIROFISH_EMBED_SECRET ?? 'playwright-mirofish-secret',
      MIROFISH_MULTI_USER_ENABLED: process.env.MIROFISH_MULTI_USER_ENABLED ?? 'true',
      RAIC_SECRET_ENCRYPTION_KEY: process.env.RAIC_SECRET_ENCRYPTION_KEY,
    },
  },
});

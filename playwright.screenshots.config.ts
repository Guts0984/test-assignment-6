import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot tests of the key views: 3 browsers × light/dark. Baselines live in e2e/screenshots/__baselines__
 * and are produced inside the Playwright Docker image (fonts and anti-aliasing differ per OS), which is
 * also where CI runs them. To refresh after an intended visual change:
 *   pnpm test:screenshots:update
 */
export default defineConfig({
  testDir: './e2e/screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  snapshotPathTemplate: '{testDir}/__baselines__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.0005, animations: 'disabled' } },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'Europe/Kyiv',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
});

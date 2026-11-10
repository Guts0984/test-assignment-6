import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a RUNNING stack (`docker compose up`), reached through BASE_URL.
 * They are written to be run repeatedly on the same stack without a restart (§9: three runs in a row):
 * every test uses its own far-future week and removes whatever it created.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/screenshots/**'],
  fullyParallel: false,
  workers: 1, // one shared database: tests are isolated by data, run one at a time for stability
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Europe/Kyiv',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});

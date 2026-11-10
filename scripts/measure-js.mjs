#!/usr/bin/env node
/**
 * Measures the JavaScript a browser downloads to show the calendar (assignment §5, acceptance #14):
 * logs in, opens the calendar in Chromium and sums the gzip size of every script it fetched, both until
 * the page has loaded and after the app has gone idle (lazy chunks requested at start-up count too).
 *
 *   node scripts/measure-js.mjs [baseUrl] [--budget=200] [--json]
 */
import { chromium } from '@playwright/test';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:3000';
const budgetKb = Number(args.find((a) => a.startsWith('--budget='))?.split('=')[1] ?? 200);
const email = process.env.MEASURE_EMAIL ?? 'ana@example.com';
const password = process.env.SEED_USER_PASSWORD ?? process.env.MEASURE_PASSWORD ?? 'demo1234';
const path = process.env.MEASURE_PATH ?? '/calendar?view=week';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
await page.goto(`${base}/login`);
await page.fill('input[name=email]', email);
await page.fill('input[name=password]', password);
await page.click('button[type=submit]');
await page.waitForURL('**/calendar**');

// Fresh, cold load of the calendar page (new page = no JS cache from the login page).
const fresh = await context.newPage();
const scripts = new Map();
fresh.on('response', async (response) => {
  const req = response.request();
  if (req.resourceType() !== 'script' || !response.ok()) return;
  try {
    scripts.set(response.url(), gzipSync(await response.body(), { level: 9 }).length);
  } catch {
    /* redirects etc. */
  }
});
await fresh.goto(`${base}${path}`, { waitUntil: 'load' });
const atLoad = new Map(scripts);
await fresh.waitForLoadState('networkidle');
await fresh.waitForTimeout(1500);
await browser.close();

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const kb = (n) => (n / 1024).toFixed(1);
const rows = [...scripts.entries()].sort((a, b) => b[1] - a[1]);
if (args.includes('--json')) {
  console.log(
    JSON.stringify({
      atLoadBytes: sum(atLoad),
      idleBytes: sum(scripts),
      budgetKb,
      files: rows.length,
    }),
  );
} else {
  console.log(`scripts: ${rows.length}`);
  for (const [url, size] of rows.slice(0, 12))
    console.log(`${kb(size).padStart(7)} KB  ${url.replace(base, '')}`);
  console.log(`\nJS gzip at load event : ${kb(sum(atLoad))} KB`);
  console.log(`JS gzip after idle    : ${kb(sum(scripts))} KB   (budget ${budgetKb} KB)`);
}
if (sum(scripts) > budgetKb * 1024) {
  console.error(`OVER BUDGET by ${kb(sum(scripts) - budgetKb * 1024)} KB`);
  process.exit(1);
}

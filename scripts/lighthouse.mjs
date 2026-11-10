#!/usr/bin/env node
/**
 * Lighthouse CI with budgets (assignment §5/§8): performance >= 90, accessibility = 100, scripts <= 200 KB.
 * The calendar needs a session, so this signs in through the API first and hands Lighthouse the cookie.
 * Budgets and assertions live in lighthouserc.json.
 *
 *   node scripts/lighthouse.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3000';
const email = process.env.MEASURE_EMAIL ?? 'ana@example.com';
const password = process.env.SEED_USER_PASSWORD ?? process.env.MEASURE_PASSWORD ?? 'demo1234';

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`login failed: ${login.status}`);
  process.exit(1);
}
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

const urls = [
  `${base}/calendar?view=week`,
  `${base}/calendar?view=month`,
  `${base}/calendar?view=day`,
  `${base}/calendar?view=list`,
];
const args = [
  'exec',
  'lhci',
  'autorun',
  ...urls.map((u) => `--collect.url=${u}`),
  `--collect.settings.extraHeaders=${JSON.stringify({ Cookie: cookie })}`,
];
const result = spawnSync('pnpm', args, {
  stdio: 'inherit',
  env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? chromium.executablePath() },
});
process.exit(result.status ?? 1);

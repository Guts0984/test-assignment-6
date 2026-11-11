#!/usr/bin/env node
/**
 * Runs the Storybook interaction tests the reliable way: against a STATIC build served locally.
 * Against `pnpm storybook` (the dev server) the first stories trigger Vite's dependency optimisation,
 * which reloads the page in the middle of a test: that produced a burst of failures on a cold start and
 * a clean run the second time. A static build has nothing left to compile.
 *
 *   node scripts/test-storybook.mjs [--skip-build]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const dir = 'storybook-static';
const port = Number(process.env.STORYBOOK_PORT ?? 6006);
const env = { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' };

if (!process.argv.includes('--skip-build') || !existsSync(dir)) {
  const build = spawnSync('pnpm', ['exec', 'storybook', 'build'], { stdio: 'inherit', env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  let file = join(dir, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

// Asynchronous on purpose: a blocking spawn would stop THIS process, and with it the server above.
const status = await new Promise((resolve) => {
  const run = spawn(
    'pnpm',
    ['exec', 'test-storybook', '--url', `http://127.0.0.1:${port}`, '--maxWorkers=2'],
    { stdio: 'inherit', env },
  );
  run.on('exit', (code) => resolve(code ?? 1));
});
server.close();
process.exit(status);

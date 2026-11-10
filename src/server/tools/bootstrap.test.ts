// @vitest-environment node
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The container start script is an esbuild bundle of `bootstrap.ts`. If anything in its import
 * graph reaches the web framework (e.g. a barrel file re-exporting route handlers), the bundle
 * balloons and crashes at start-up in the slim runtime image. Docker CI catches that late and
 * slowly; this catches it in a second.
 */
describe('bootstrap bundle', () => {
  it('does not pull in Next.js or React', async () => {
    const result = await build({
      entryPoints: ['src/server/tools/bootstrap.ts'],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs);
    const web = inputs.filter((i) => /node_modules\/(\.pnpm\/)?(next|react|react-dom)[@/]/.test(i));
    expect(web, `web framework in the bootstrap bundle: ${web.slice(0, 3).join(', ')}`).toEqual([]);
    const bytes = result.outputFiles?.[0]?.contents.length ?? 0;
    expect(bytes).toBeLessThan(3_000_000);
  });
});

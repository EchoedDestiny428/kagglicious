// Bundles the renderer (JS, CSS, fonts) into dist/app. Main and preload run unbundled.
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist/app';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyFile('src/renderer/index.html', `${outdir}/index.html`);

const ctx = await esbuild.context({
  entryPoints: { renderer: 'src/renderer/app.js' },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  minify: !watch,
  sourcemap: 'linked',
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

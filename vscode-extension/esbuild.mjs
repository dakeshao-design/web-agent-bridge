import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: [path.join(__dirname, 'src/extension.ts')],
  bundle: true,
  outfile: path.join(__dirname, 'out/extension.js'),
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

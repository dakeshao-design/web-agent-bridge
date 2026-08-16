import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extRoot, '..');
const dest = path.join(extRoot, 'templates');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'config'), { recursive: true });
fs.mkdirSync(path.join(dest, 'scripts'), { recursive: true });

fs.copyFileSync(
  path.join(repoRoot, 'config', 'app.config.json'),
  path.join(dest, 'config', 'app.config.json')
);

for (const name of fs.readdirSync(path.join(repoRoot, 'scripts'))) {
  if (!name.endsWith('.js') && !name.endsWith('.md')) continue;
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', name),
    path.join(dest, 'scripts', name)
  );
}

console.log('[copy-templates] done ->', dest);

const markedSrc = path.join(extRoot, 'node_modules', 'marked', 'lib', 'marked.umd.js');
const markedDest = path.join(extRoot, 'media', 'marked.umd.js');
if (fs.existsSync(markedSrc)) {
  fs.copyFileSync(markedSrc, markedDest);
  console.log('[copy-templates] marked.umd.js -> media/');
}

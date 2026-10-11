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
fs.mkdirSync(path.join(dest, 'skills'), { recursive: true });
fs.mkdirSync(path.join(dest, 'plans'), { recursive: true });

fs.copyFileSync(
  path.join(repoRoot, 'config', 'app.config.json'),
  path.join(dest, 'config', 'app.config.json')
);

for (const name of ['bridge-default.js', 'bridge-readme.md']) {
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', name),
    path.join(dest, 'scripts', name)
  );
}

const skillReadme = path.join(repoRoot, 'skills', 'skill-readme.md');
if (fs.existsSync(skillReadme)) {
  fs.copyFileSync(skillReadme, path.join(dest, 'skills', 'skill-readme.md'));
}

fs.copyFileSync(
  path.join(repoRoot, 'plans', 'plan-prompt-template.md'),
  path.join(dest, 'plans', 'plan-prompt-template.md')
);

console.log('[copy-templates] done ->', dest);

const markedSrc = path.join(extRoot, 'node_modules', 'marked', 'lib', 'marked.umd.js');
const markedDest = path.join(extRoot, 'media', 'marked.umd.js');
if (fs.existsSync(markedSrc)) {
  fs.copyFileSync(markedSrc, markedDest);
  console.log('[copy-templates] marked.umd.js -> media/');
}

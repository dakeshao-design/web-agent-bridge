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

for (const name of ['app.config.json', '_agents-template.json']) {
  fs.copyFileSync(path.join(repoRoot, 'config', name), path.join(dest, 'config', name));
}
const agentsSrc = path.join(repoRoot, 'config', 'agents.json');
const agentsFallback = path.join(repoRoot, 'config', '_agents-template.json');
if (fs.existsSync(agentsSrc)) {
  fs.copyFileSync(agentsSrc, path.join(dest, 'config', 'agents.json'));
} else {
  fs.copyFileSync(agentsFallback, path.join(dest, 'config', 'agents.json'));
  console.warn('[copy-templates] 无 agents.json，使用 _agents-template.json');
}

for (const name of fs.readdirSync(path.join(repoRoot, 'scripts'))) {
  if (!name.endsWith('.js')) continue;
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', name),
    path.join(dest, 'scripts', name)
  );
}

console.log('[copy-templates] done ->', dest);

// marked UMD for webview
const markedSrc = path.join(extRoot, 'node_modules', 'marked', 'lib', 'marked.umd.js');
const markedDest = path.join(extRoot, 'media', 'marked.umd.js');
if (fs.existsSync(markedSrc)) {
  fs.copyFileSync(markedSrc, markedDest);
  console.log('[copy-templates] marked.umd.js -> media/');
}

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const isDev = process.argv.includes('--dev');
const port = process.env.AGENT_HOST_PORT || '9791';
const token = process.env.AGENT_HOST_TOKEN || 'dev-token';

const env = {
  ...process.env,
  AGENT_HOST: '1',
  AGENT_HOST_PORT: port,
  AGENT_HOST_TOKEN: token,
};

const cwd = path.join(root, 'packages/editor-app');
const args = isDev
  ? ['exec', 'tauri', 'dev']
  : ['exec', 'tauri', 'dev'];

console.log(`[agent-host] starting on http://127.0.0.1:${port}`);
const child = spawn('pnpm', args, {
  cwd,
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));

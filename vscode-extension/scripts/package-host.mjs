#!/usr/bin/env node
/**
 * 将 release 二进制复制为扩展内 agent-host.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const releaseDir = path.join(root, 'packages/editor-app/src-tauri/target/release');
const debugDir = path.join(root, 'packages/editor-app/src-tauri/target/debug');
const srcCandidates = [
  path.join(releaseDir, 'WABEditor.exe'),
  path.join(releaseDir, 'editor-app.exe'),
  path.join(debugDir, 'WABEditor.exe'),
  path.join(debugDir, 'editor-app.exe'),
];
const destDir = path.join(root, 'vscode-extension/bin');
const dest = path.join(destDir, 'agent-host.exe');

const src = srcCandidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error('[package-host] 未找到 WABEditor.exe / editor-app.exe，请先 tauri build');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[package-host]', src, '->', dest);

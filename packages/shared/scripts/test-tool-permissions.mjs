import assert from 'node:assert/strict';
import {
  mergeToolPermissions,
  getConfiguredPermission,
  resolveEffectivePermission,
  buildPermissionAskMessage,
  listToolsForPrompt,
  isPathInsideWorkspace,
} from '../dist/agent/toolPermissions.js';

const merged = mergeToolPermissions({ run_powershell: 'ask' });
assert.equal(getConfiguredPermission('read_file', merged), 'allow');
assert.equal(getConfiguredPermission('run_powershell', merged), 'ask');
assert.equal(getConfiguredPermission('write_file', undefined), 'allow');

assert.equal(isPathInsideWorkspace('C:/work/a/b.txt', 'C:/work/a'), true);
assert.equal(isPathInsideWorkspace('C:/other/x.txt', 'C:/work/a'), false);

const op = { action: 'write', path: 'C:/outside/x.txt' };
assert.equal(
  resolveEffectivePermission('write_file', op, 'C:/work/proj', { write_file: 'allow' }),
  'ask'
);
assert.equal(
  resolveEffectivePermission('write_file', op, 'C:/work/proj', { write_file: 'deny' }),
  'deny'
);

const msg = buildPermissionAskMessage('write_file', op);
assert.match(msg, /工具: write_file/);
assert.match(msg, /路径:/);

const deniedTools = listToolsForPrompt({ read_file: 'deny' });
assert.ok(!deniedTools.some((t) => t.name === 'read_file'));
assert.ok(deniedTools.some((t) => t.name === 'write_file'));

console.log('ok: toolPermissions');

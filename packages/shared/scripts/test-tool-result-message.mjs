import assert from 'node:assert/strict';
import {
  buildToolResultMessage,
  buildToolResultFromOperation,
} from '../dist/agent/toolResultMessage.js';
import { isToolCallAlreadyReported } from '../dist/agent/fileOperationsFingerprint.js';

const writeMsg = buildToolResultMessage('write_file', { path: 'src/a.ts', content: 'x' }, {
  ok: true,
  message: '写入完成',
});
assert.match(writeMsg, /^\[SYSTEM\]\nok `write_file`\npath: src\/a\.ts$/m);
assert.doesNotMatch(writeMsg, /message:/);
assert.doesNotMatch(writeMsg, /写入完成/);
assert.doesNotMatch(writeMsg, /```/);

const readMsg = buildToolResultMessage('read_file', { path: 'src/a.ts' }, {
  ok: true,
  message: '读取 3 行， 10 字符',
  content: 'line1\nline2\nline3',
});
assert.match(readMsg, /ok `read_file`/);
assert.match(readMsg, /path: src\/a\.ts/);
assert.match(readMsg, /\n\nline1\nline2\nline3$/);
assert.doesNotMatch(readMsg, /message:/);
assert.doesNotMatch(readMsg, /读取/);
assert.doesNotMatch(readMsg, /```/);

const editMsg = buildToolResultFromOperation(
  { action: 'edit_range', path: 'a.ts', start_line: 10, end_line: 12, content: 'x' },
  { ok: true, total_lines: 120, edited_range: '10-15' }
);
assert.match(editMsg, /ok `edit_file_range`/);
assert.match(editMsg, /path: a\.ts/);
assert.match(editMsg, /total_lines: 120/);
assert.match(editMsg, /edited_range: 10-15/);
assert.doesNotMatch(editMsg, /message:/);
assert.doesNotMatch(editMsg, /start_line:/);

const grepMsg = buildToolResultMessage(
  'grep',
  { path: 'src', pattern: 'foo', offset: '0' },
  {
    ok: true,
    message: '已返回 100 条匹配（offset=0），仍有更多结果。是否继续检索？继续请再次调用 grep，并设置 offset=100',
    content: 'a.ts:1:foo',
    more_offset: 100,
  }
);
assert.match(grepMsg, /more_offset: 100/);
assert.doesNotMatch(grepMsg, /是否继续检索/);
assert.match(grepMsg, /\n\na\.ts:1:foo$/);

const errMsg = buildToolResultMessage('read_file', { path: 'big.ts' }, {
  ok: false,
  message: '文件共 5000 行，超过上限 500 行。请使用 read_file_range 分段读取。',
});
assert.match(errMsg, /err `read_file`/);
assert.match(errMsg, /message: 文件共 5000 行/);

const callBlock = [
  'BEGIN_TOOL: write_file',
  'BEGIN_ARG: path',
  'src/a.ts',
  'END_ARG',
  'BEGIN_ARG: content',
  'hello world',
  'END_ARG',
  'END_TOOL',
].join('\n');
const report = buildToolResultFromOperation(
  { action: 'write', path: 'src/a.ts', content: 'hello world' },
  { ok: true, message: '写入完成' }
);
const transcript = `${callBlock}\n\n${report}`;
assert.equal(
  isToolCallAlreadyReported(transcript, [
    { action: 'write', path: 'src/a.ts', content: 'hello world' },
  ]),
  true
);

console.log('test-tool-result-message: ok');

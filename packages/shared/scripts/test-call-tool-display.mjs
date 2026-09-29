import assert from 'node:assert/strict';
import {
  formatCallToolDisplayLine,
  splitCallToolDisplayParts,
} from '../dist/agent/callToolDisplay.js';

assert.equal(
  formatCallToolDisplayLine('ls', ['.'], '成功'),
  'call-tool ls . 成功'
);
assert.equal(
  formatCallToolDisplayLine('read_file', ['./readme.md'], '进行中'),
  'call-tool read_file ./readme.md 进行中'
);

const fenced = [
  '先说明一下',
  '``````call-tool',
  'BEGIN_TOOL: ls',
  'BEGIN_ARG: path',
  '.',
  'END_ARG',
  'END_TOOL',
  '``````',
  '结束',
].join('\n');

const parts1 = splitCallToolDisplayParts(fenced, () => '成功');
assert.equal(parts1.length, 3);
assert.equal(parts1[0].kind, 'text');
assert.match(parts1[0].text, /先说明一下/);
assert.equal(parts1[1].kind, 'tool');
if (parts1[1].kind === 'tool') {
  assert.equal(parts1[1].summary, 'call-tool ls . 成功');
  assert.match(parts1[1].raw, /BEGIN_TOOL:\s*ls/);
  assert.equal(parts1[1].status, '成功');
}
assert.equal(parts1[2].kind, 'text');
assert.match(parts1[2].text, /结束/);

const noLang = [
  '```',
  'BEGIN_TOOL: read_file',
  'BEGIN_ARG: path',
  './readme.md',
  'END_ARG',
  'END_TOOL',
  '```',
].join('\n');

const parts2 = splitCallToolDisplayParts(noLang, () => '进行中');
assert.equal(parts2.length, 1);
assert.equal(parts2[0].kind, 'tool');
if (parts2[0].kind === 'tool') {
  assert.equal(parts2[0].summary, 'call-tool read_file ./readme.md 进行中');
}

const incomplete = [
  'BEGIN_TOOL: write_file',
  'BEGIN_ARG: path',
  'a.md',
  'END_ARG',
  'BEGIN_ARG: content',
  'hello',
].join('\n');

const parts3 = splitCallToolDisplayParts(incomplete);
assert.equal(parts3.length, 1);
assert.equal(parts3[0].kind, 'tool');
if (parts3[0].kind === 'tool') {
  assert.equal(parts3[0].summary, 'call-tool write_file a.md 进行中');
  assert.equal(parts3[0].status, '进行中');
  assert.ok(!parts3[0].raw.includes('END_TOOL'));
}

const withChrome = [
  'call-tool',
  '复制',
  '下载',
  'BEGIN_TOOL: ls',
  'BEGIN_ARG: path',
  '.',
  'END_ARG',
  'BEGIN_ARG: deep',
  'true',
  'END_ARG',
  'END_TOOL',
].join('\n');

const parts4 = splitCallToolDisplayParts(withChrome, () => '成功');
assert.equal(parts4.length, 1, 'chrome lines should be stripped');
assert.equal(parts4[0].kind, 'tool');
if (parts4[0].kind === 'tool') {
  assert.equal(parts4[0].summary, 'call-tool ls . true 成功');
}

const chromeKeepProse = [
  '请先看目录',
  'call-tool',
  '复制',
  'BEGIN_TOOL: ls',
  'BEGIN_ARG: path',
  '.',
  'END_ARG',
  'END_TOOL',
].join('\n');

const parts5 = splitCallToolDisplayParts(chromeKeepProse, () => '成功');
assert.equal(parts5.length, 2);
assert.equal(parts5[0].kind, 'text');
assert.match(parts5[0].text, /请先看目录/);
assert.ok(!/call-tool/.test(parts5[0].text));
assert.equal(parts5[1].kind, 'tool');

const longBetween = [
  'call-tool',
  '这是一段明显超过二十个字符的说明所以应当保留不被清除掉',
  'BEGIN_TOOL: ls',
  'BEGIN_ARG: path',
  '.',
  'END_ARG',
  'END_TOOL',
].join('\n');

const parts6 = splitCallToolDisplayParts(longBetween, () => '成功');
assert.ok(parts6.some((p) => p.kind === 'text' && /超过二十个字符/.test(p.text)));
assert.ok(parts6.some((p) => p.kind === 'tool'));

console.log('callToolDisplay ok');

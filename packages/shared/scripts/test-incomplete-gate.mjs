import assert from 'node:assert/strict';
import {
  hasIncompleteCallTool,
  isIncompleteFromLastConversation,
  IncompleteCallToolConfirm,
} from '../dist/agent/incompleteCallTool.js';

const incomplete = [
  'BEGIN_TOOL: write_file',
  'BEGIN_ARG: path',
  'a.md',
  'END_ARG',
  'BEGIN_ARG: content',
  'hello',
].join('\n');

const complete = [
  'BEGIN_TOOL: write_file',
  'BEGIN_ARG: path',
  'a.md',
  'END_ARG',
  'BEGIN_ARG: content',
  'hello',
  'END_ARG',
  'END_TOOL',
].join('\n');

assert.equal(hasIncompleteCallTool(incomplete), true);
assert.equal(hasIncompleteCallTool(complete), false);
assert.equal(isIncompleteFromLastConversation(incomplete, undefined), true);
assert.equal(isIncompleteFromLastConversation(incomplete, incomplete), true);
assert.equal(isIncompleteFromLastConversation(incomplete, complete), false);
assert.equal(isIncompleteFromLastConversation(incomplete, '普通回复'), false);

const reported = new Set();
let confirmed = 0;
const gate = new IncompleteCallToolConfirm();

gate.discover('a', incomplete, {
  isLastConversation: false,
  isLoading: false,
  alreadyReported: (k) => reported.has(k),
  markReported: (k) => reported.add(k),
  onConfirm: () => {
    confirmed += 1;
  },
  confirmMs: 50,
});
assert.equal(confirmed, 0);

gate.discover('a', incomplete, {
  isLastConversation: true,
  isLoading: true,
  alreadyReported: (k) => reported.has(k),
  markReported: (k) => reported.add(k),
  onConfirm: () => {
    confirmed += 1;
  },
  confirmMs: 50,
});
assert.equal(confirmed, 0);

await new Promise((r) => {
  gate.discover('a', incomplete, {
    isLastConversation: true,
    isLoading: false,
    alreadyReported: (k) => reported.has(k),
    markReported: (k) => reported.add(k),
    onConfirm: () => {
      confirmed += 1;
    },
    confirmMs: 80,
  });
  setTimeout(() => gate.onContentChange('a', incomplete + '\nmore'), 20);
  setTimeout(r, 150);
});
assert.equal(confirmed, 0, 'content change should cancel');

await new Promise((r) => {
  gate.discover('a', incomplete, {
    isLastConversation: true,
    isLoading: false,
    alreadyReported: (k) => reported.has(k),
    markReported: (k) => reported.add(k),
    onConfirm: () => {
      confirmed += 1;
    },
    confirmMs: 50,
  });
  setTimeout(r, 120);
});
assert.equal(confirmed, 1, 'stable incomplete should confirm');

console.log('ok: incomplete call-tool gate');

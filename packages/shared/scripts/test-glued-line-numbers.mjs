import assert from 'node:assert/strict';
import { parseCallToolBlocks, stripMarkdownLineNumbers } from '../dist/tools/parseCallTool.js';

const glued = [
  '```call-tool',
  '1BEGIN_TOOL: read_file_range',
  '2BEGIN_ARG: path',
  '3long-150.txt',
  '4END_ARG',
  '5BEGIN_ARG: start_line',
  '61',
  '7END_ARG',
  '8BEGIN_ARG: end_line',
  '9100',
  '10END_ARG',
  '11END_TOOL',
  '```',
].join('\n');

const stripped = stripMarkdownLineNumbers(glued);
assert.match(stripped, /BEGIN_ARG: start_line\n1\nEND_ARG/);
assert.match(stripped, /BEGIN_ARG: end_line\n100\nEND_ARG/);

const ops = parseCallToolBlocks(glued);
assert.equal(ops.length, 1);
assert.equal(ops[0].action, 'read_range');
assert.equal(ops[0].start_line, 1);
assert.equal(ops[0].end_line, 100);

const orphan = [
  'BEGIN_TOOL: read_file_range',
  'BEGIN_ARG: path',
  'long-150.txt',
  'END_ARG',
  'BEGIN_ARG: end_line',
  '9',
  '100',
  'END_ARG',
  'END_TOOL',
].join('\n');
assert.match(stripMarkdownLineNumbers(orphan), /BEGIN_ARG: end_line\n9\n100\nEND_ARG/);

console.log('ok: glued line-number strip');

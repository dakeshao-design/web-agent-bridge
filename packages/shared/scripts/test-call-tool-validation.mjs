import assert from 'node:assert/strict';
import * as shared from '../dist/index.js';

const text1 = [
  '```call-tool',
  'BEGIN_TOOL: no_such_tool',
  'BEGIN_ARG: path',
  'x.txt',
  'END_ARG',
  'END_TOOL',
  '```',
].join('\n');

const text2 = [
  '```call-tool',
  'BEGIN_TOOL: read_file',
  'BEGIN_ARG: path',
  'x.txt',
  'END_ARG',
  'BEGIN_ARG: foo',
  'bar',
  'END_ARG',
  'END_TOOL',
  '```',
].join('\n');

const text3 = [
  '```call-tool',
  'BEGIN_TOOL: read_file',
  'END_TOOL',
  '```',
].join('\n');

const issues1 = shared.findCallToolValidationIssues(text1);
assert.equal(issues1.unknownToolNames.includes('no_such_tool'), true);

const issues2 = shared.findCallToolValidationIssues(text2);
assert.equal(issues2.invalidArgs.includes('foo'), true);

const issues3 = shared.findCallToolValidationIssues(text3);
assert.equal(issues3.missingParameters.includes('path'), true);

const firstFailure = shared.buildToolCallValidationResult(issues3, undefined, {
  includeToolTable: false,
});
assert.ok(!firstFailure.includes('## 可用工具'));

const secondFailure = shared.buildToolCallValidationResult(issues3, undefined, {
  includeToolTable: true,
});
assert.match(secondFailure, /## 可用工具/);
assert.match(secondFailure, /read_file|write_file|ls/);

console.log('ok: call-tool validation');

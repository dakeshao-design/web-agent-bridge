import { parseBridgeScriptMeta } from '../dist/agent/parseBridgeScriptMeta.js';
import { buildAgentModePrompt } from '../dist/agent/agentModePrompt.js';
import assert from 'node:assert/strict';

function wrapHeader(extraLines) {
  return [
    '// ==BridgeScript==',
    '// @id            example',
    '// @name          Example',
    '// @url           https://example.com',
    '// @enabled       true',
    ...extraLines,
    '// ==/BridgeScript==',
  ].join('\n');
}

const multi = parseBridgeScriptMeta(
  wrapHeader(['// @sitePrompt line1', '// @sitePrompt line2'])
);
assert.equal(multi?.siteAgentPrompt, 'line1\nline2');

const single = parseBridgeScriptMeta(wrapHeader(['// @sitePrompt short tip']));
assert.equal(single?.siteAgentPrompt, 'short tip');

const blank = parseBridgeScriptMeta(wrapHeader(['// @sitePrompt', '// @sitePrompt   ']));
assert.equal(blank?.siteAgentPrompt, undefined);

const missing = parseBridgeScriptMeta(wrapHeader([]));
assert.equal(missing?.siteAgentPrompt, undefined);

const msg = buildAgentModePrompt(undefined, undefined, null, undefined, 'site-only');
assert.ok(msg.endsWith('site-only'));
assert.ok(!msg.includes('## 站点专用说明'));
assert.ok(msg.includes('本轮不要回复，等待用户输入。\n\nsite-only'));

console.log('ok: siteAgentPrompt');

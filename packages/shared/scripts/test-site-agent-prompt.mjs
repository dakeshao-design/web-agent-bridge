import { parseSiteAgentPromptFromBridgeScript } from '../dist/agent/fileLineLimit.js';
import { buildAgentModePrompt } from '../dist/agent/agentModePrompt.js';
import assert from 'node:assert/strict';

const src1 = [
  'const SITE_AGENT_PROMPT = `',
  'line1',
  'line2',
  '`;',
].join('\n');
assert.equal(parseSiteAgentPromptFromBridgeScript(src1), 'line1\nline2');

assert.equal(
  parseSiteAgentPromptFromBridgeScript('const SITE_AGENT_PROMPT = "short tip";'),
  'short tip'
);
assert.equal(
  parseSiteAgentPromptFromBridgeScript("const SITE_AGENT_PROMPT = 'x';"),
  'x'
);
assert.equal(
  parseSiteAgentPromptFromBridgeScript('const SITE_AGENT_PROMPT = `  `;'),
  undefined
);
assert.equal(parseSiteAgentPromptFromBridgeScript('const OTHER = 1;'), undefined);

const msg = buildAgentModePrompt(undefined, undefined, null, undefined, 'site-only');
assert.ok(msg.endsWith('site-only'));
assert.ok(!msg.includes('## 站点专用说明'));
assert.ok(msg.includes('本轮不要回复，等待用户输入。\n\nsite-only'));

console.log('ok: siteAgentPrompt');

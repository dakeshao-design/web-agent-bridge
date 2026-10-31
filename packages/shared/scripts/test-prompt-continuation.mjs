import assert from 'node:assert/strict';
import {
  getLatestSubstantivePrompt,
  isShortContinuationPrompt,
} from '../dist/agent/promptContinuation.js';
import { buildPromptResendReminder } from '../dist/agent/agentModePrompt.js';

const previousPrompt = '修复登录流程并补充测试';
const continuationPhrases = [
  '继续',
  '请继续',
  '请继续。',
  '继续吧',
  '接着做',
  '接着来',
  '往下继续',
  '继续处理',
  '继续完成',
  'continue',
  'please continue',
  'go on',
  'go on.',
  'keep going',
  'carry on',
  'proceed',
  'resume',
];

for (const phrase of continuationPhrases) {
  assert.equal(isShortContinuationPrompt(phrase), true, phrase);
  const prompt = getLatestSubstantivePrompt(previousPrompt, phrase);
  assert.equal(prompt, previousPrompt, phrase);
  assert.ok(buildPromptResendReminder(prompt).includes(previousPrompt), phrase);
}

assert.equal(isShortContinuationPrompt('  PLEASE CONTINUE!!  '), true);
assert.equal(getLatestSubstantivePrompt(previousPrompt, '继续重构认证模块'), '继续重构认证模块');
assert.equal(getLatestSubstantivePrompt(previousPrompt, '更新登录页样式'), '更新登录页样式');
assert.equal(getLatestSubstantivePrompt(undefined, '继续'), '继续');

console.log('ok: promptContinuation');
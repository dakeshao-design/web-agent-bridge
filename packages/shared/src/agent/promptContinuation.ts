const SHORT_CONTINUATION_PHRASES = new Set([
  '继续',
  '请继续',
  '继续吧',
  '接着做',
  '接着来',
  '往下继续',
  '继续处理',
  '继续完成',
  'continue',
  'please continue',
  'go on',
  'keep going',
  'carry on',
  'proceed',
  'resume',
]);

function normalizeContinuationPhrase(text: string): string {
  return text.trim().toLowerCase().replace(/\p{P}+$/gu, '').trim();
}

export function isShortContinuationPrompt(text: string): boolean {
  return SHORT_CONTINUATION_PHRASES.has(normalizeContinuationPhrase(text));
}

export function getLatestSubstantivePrompt(
  previousPrompt: string | undefined,
  incomingPrompt: string
): string {
  if (isShortContinuationPrompt(incomingPrompt) && previousPrompt?.trim()) {
    return previousPrompt;
  }
  return incomingPrompt;
}
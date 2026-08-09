/** PowerShell 长时间执行的进度间隔 */
export const POWERSHELL_PROGRESS_INTERVAL_MS = 100_000;

export type PowershellWaitDecision = 'continue' | 'terminate' | 'skip';

export function buildPowershellProgressMessage(params: {
  command: string;
  elapsedSec: number;
  newOutput: string;
}): string {
  const { command, elapsedSec, newOutput } = params;
  const body = newOutput.trim() ? newOutput : '(本间隔无新增输出)';
  return [
    '工具 `run_powershell` 仍在执行。',
    '',
    `command: ${command}`,
    `elapsed: ${elapsedSec}s`,
    '',
    '新增控制台输出:',
    '```',
    body,
    '```',
    '',
    '请选择:',
    '- 回复「继续等待」→ 继续等待',
    '- 回复「终止」→ 结束 PowerShell',
    '- 直接继续对话或调用其他工具 → 跳过等待（无需写「跳过等待」）',
  ].join('\n');
}

export function buildPowershellTerminatedResult(params: {
  content: string;
  reason: 'agent' | 'user';
}): { ok: false; message: string; content: string } {
  const message = params.reason === 'user' ? '用户终止终端' : '代理已终止';
  return {
    ok: false,
    message,
    content: params.content,
  };
}

export function buildPowershellFinalResult(params: {
  content: string;
  exitCode: number;
}): { ok: boolean; message: string; content: string } {
  return {
    ok: params.exitCode === 0,
    message: `exit code: ${params.exitCode}`,
    content: params.content,
  };
}

/** 根据 agent 回复判定等待决策 */
export function parsePowershellWaitDecision(text: string): PowershellWaitDecision {
  const raw = text ?? '';
  if (/BEGIN_TOOL|call-tool/i.test(raw)) {
    return 'skip';
  }

  const trimmed = raw.trim();
  const compact = trimmed.replace(/\s+/g, '');

  const continueHit =
    /继续等待|繼續等待|继续等|continue\s*wait/i.test(trimmed) ||
    /继续等待|繼續等待|继续等/.test(compact);
  const terminateHit =
    /终止powershell|終止powershell|终止终端|終止終端|终止进程|终止|terminate/i.test(trimmed) ||
    /终止|終止/.test(compact);

  if (continueHit && !terminateHit) return 'continue';
  if (terminateHit && !continueHit) return 'terminate';
  if (continueHit && terminateHit) {
    if (/继续等待|繼續等待|continue\s*wait/i.test(trimmed)) return 'continue';
    return 'terminate';
  }
  return 'skip';
}

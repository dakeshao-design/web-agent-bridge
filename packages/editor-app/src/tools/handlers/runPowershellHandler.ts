import { invoke } from '@tauri-apps/api/core';
import type { FileToolHandler } from '../types';

export type WaitOutcome = 'exited' | 'timeout' | 'killed';

type PollResult = {
  output: string;
  exited: boolean;
  exitCode: number | null;
  killed: boolean;
};

export interface PowershellSession {
  readonly id: string;
  getOutput(): string;
  isExited(): boolean;
  getExitCode(): number | null;
  wait(ms: number): Promise<WaitOutcome>;
  kill(): void;
  watchInBackground?(): void;
}

class TauriPowershellSession implements PowershellSession {
  readonly id: string;
  private output = '';
  private exitCode: number | null = null;
  private exited = false;
  private killedFlag = false;

  constructor(id: string) {
    this.id = id;
  }

  getOutput(): string {
    return this.output;
  }

  isExited(): boolean {
    return this.exited;
  }

  getExitCode(): number | null {
    return this.exitCode;
  }

  private async pollOnce(): Promise<PollResult> {
    const r = await invoke<PollResult>('poll_powershell', { id: this.id });
    this.output = r.output ?? '';
    this.exited = !!r.exited;
    this.exitCode = r.exitCode ?? null;
    this.killedFlag = !!r.killed;
    if (this.exited) {
      tauriRegistry.remove(this);
      void invoke('remove_powershell', { id: this.id }).catch(() => undefined);
    }
    return r;
  }

  wait(ms: number): Promise<WaitOutcome> {
    if (this.exited) {
      return Promise.resolve(this.killedFlag ? 'killed' : 'exited');
    }
    const finite = Number.isFinite(ms) && ms > 0 && ms < 2_147_483_647;
    const deadline = finite ? Date.now() + ms : null;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome: WaitOutcome) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(outcome);
      };
      const tick = async () => {
        try {
          const r = await this.pollOnce();
          if (r.exited) {
            finish(r.killed ? 'killed' : 'exited');
            return;
          }
          if (deadline !== null && Date.now() >= deadline) {
            finish('timeout');
          }
        } catch {
          finish('exited');
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), 400);
    });
  }

  kill(): void {
    this.killedFlag = true;
    void invoke('kill_powershell', { id: this.id }).catch(() => undefined);
  }

  /** skip 后仍监视结束并注销 */
  watchInBackground(): void {
    const timer = setInterval(() => {
      void this.pollOnce().then(() => {
        if (this.exited) clearInterval(timer);
      });
    }, 2000);
  }
}

class TauriPowershellRegistry {
  private sessions = new Set<PowershellSession>();

  add(session: PowershellSession): void {
    this.sessions.add(session);
  }

  remove(session: PowershellSession): void {
    this.sessions.delete(session);
  }

  async killAll(): Promise<number> {
    try {
      const n = await invoke<number>('kill_all_powershell');
      return n ?? 0;
    } catch {
      let n = 0;
      for (const s of [...this.sessions]) {
        if (!s.isExited()) {
          s.kill();
          n += 1;
        }
      }
      return n;
    }
  }

  runningCount(): number {
    let n = 0;
    for (const s of this.sessions) {
      if (!s.isExited()) n += 1;
    }
    return n;
  }
}

export const tauriRegistry = new TauriPowershellRegistry();

export async function startPowershellSession(
  command: string,
  cwd: string
): Promise<PowershellSession> {
  const id = await invoke<string>('start_powershell', {
    command,
    cwd: cwd || null,
  });
  const session = new TauriPowershellSession(id);
  tauriRegistry.add(session);
  return session;
}

export async function killAllPowershellSessions(): Promise<number> {
  return tauriRegistry.killAll();
}

type PowershellResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export const applyRunPowershell: FileToolHandler = async (op, ctx) => {
  const command = op.command?.trim();
  if (!command) {
    const message = 'command 为空';
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }

  const cwd = ctx.workspaceRoot.trim();
  if (!cwd) {
    const message = '工作区未打开';
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }

  const session = await startPowershellSession(command, cwd);
  const outcome = await session.wait(Number.POSITIVE_INFINITY);
  const content = session.getOutput();
  if (outcome === 'killed') {
    const message = '用户终止终端';
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message, content };
  }
  const exitCode = session.getExitCode() ?? 1;
  const message = `exit code: ${exitCode}`;
  const ok = exitCode === 0;
  ctx.addLogEntry(op, ok ? 'applied' : 'error', message);
  ctx.publishLastFileOp(op, ok ? 'applied' : 'error', message);
  return { ok, message, content };
};

/** 旧 invoke 互換（未使用可） */
export async function runPowershellOnce(
  command: string,
  cwd: string
): Promise<PowershellResult> {
  return invoke<PowershellResult>('run_powershell', { command, cwd });
}

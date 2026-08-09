import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFile } from 'node:child_process';
import type { FileToolHandler } from '../types';

export type WaitOutcome = 'exited' | 'timeout' | 'killed';

export interface PowershellSession {
  readonly id: string;
  getOutput(): string;
  isExited(): boolean;
  getExitCode(): number | null;
  wait(ms: number): Promise<WaitOutcome>;
  kill(): void;
}

type Waiter = {
  resolve: (outcome: WaitOutcome) => void;
  timer?: ReturnType<typeof setTimeout>;
};

class NodePowershellSession implements PowershellSession {
  readonly id: string;
  private output = '';
  private exitCode: number | null = null;
  private exited = false;
  private killed = false;
  private waiters: Waiter[] = [];
  private child: ChildProcessWithoutNullStreams;

  constructor(command: string, cwd: string) {
    this.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { cwd, windowsHide: true }
    );
    this.child.stdout.on('data', (d) => {
      this.output += String(d);
    });
    this.child.stderr.on('data', (d) => {
      this.output += String(d);
    });
    this.child.on('close', (code) => {
      this.exited = true;
      this.exitCode = code ?? 1;
      powershellRegistry.remove(this);
      this.flushWaiters(this.killed ? 'killed' : 'exited');
    });
    this.child.on('error', (err) => {
      this.output += String(err);
      this.exited = true;
      this.exitCode = 1;
      powershellRegistry.remove(this);
      this.flushWaiters(this.killed ? 'killed' : 'exited');
    });
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

  wait(ms: number): Promise<WaitOutcome> {
    if (this.exited) {
      return Promise.resolve(this.killed ? 'killed' : 'exited');
    }
    return new Promise((resolve) => {
      const waiter: Waiter = { resolve };
      if (Number.isFinite(ms) && ms > 0 && ms < 2_147_483_647) {
        waiter.timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve('timeout');
        }, ms);
      }
      this.waiters.push(waiter);
    });
  }

  kill(): void {
    if (this.exited) return;
    this.killed = true;
    const pid = this.child.pid;
    if (pid) {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
        try {
          this.child.kill();
        } catch {
          // 已结束
        }
      });
    } else {
      try {
        this.child.kill();
      } catch {
        // 已结束
      }
    }
  }

  private flushWaiters(outcome: WaitOutcome): void {
    const list = this.waiters.splice(0, this.waiters.length);
    for (const w of list) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(outcome);
    }
  }
}

class PowershellSessionRegistry {
  private sessions = new Set<PowershellSession>();

  add(session: PowershellSession): void {
    this.sessions.add(session);
  }

  remove(session: PowershellSession): void {
    this.sessions.delete(session);
  }

  killAll(): number {
    let n = 0;
    for (const s of [...this.sessions]) {
      if (!s.isExited()) {
        s.kill();
        n += 1;
      }
    }
    return n;
  }

  runningCount(): number {
    let n = 0;
    for (const s of this.sessions) {
      if (!s.isExited()) n += 1;
    }
    return n;
  }
}

export const powershellRegistry = new PowershellSessionRegistry();

export function startPowershellSession(command: string, cwd: string): PowershellSession {
  const session = new NodePowershellSession(command, cwd);
  powershellRegistry.add(session);
  return session;
}

export function killAllPowershellSessions(): number {
  return powershellRegistry.killAll();
}

export const applyRunPowershell: FileToolHandler = async (op, ctx) => {
  const command = op.command?.trim();
  if (!command) {
    const message = 'command 为空';
    ctx.addLogEntry(op, 'error', message);
    return { ok: false, message };
  }
  const cwd = ctx.workspaceRoot.trim();
  if (!cwd) {
    const message = '工作区未打开：请先打开文件夹作为工作区';
    ctx.addLogEntry(op, 'error', message);
    return { ok: false, message };
  }

  const session = startPowershellSession(command, cwd);
  const outcome = await session.wait(Number.POSITIVE_INFINITY);
  const content = session.getOutput();
  if (outcome === 'killed') {
    const message = '用户终止终端';
    ctx.addLogEntry(op, 'error', message);
    return { ok: false, message, content };
  }
  const exitCode = session.getExitCode() ?? 1;
  const message = `exit code: ${exitCode}`;
  const ok = exitCode === 0;
  ctx.addLogEntry(op, ok ? 'applied' : 'error', message);
  return { ok, message, content };
};

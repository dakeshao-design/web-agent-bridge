import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as http from 'node:http';
import * as fs from 'node:fs';

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 131 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export class AgentHostProcess {
  private child?: ChildProcess;
  private readonly token: string;
  private readonly sessionId: string;
  private readonly port: number;
  private readonly debugPort: number;
  private started = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('webAgentBridge');
    this.sessionId = vscode.env.sessionId || `vscode-${process.pid}-${Date.now()}`;
    this.token = cfg.get<string>('hostToken') || 'dev-token';
    this.port = this.resolveDynamicPort(cfg.get<number>('hostPort', 9791), 9791);
    this.debugPort = this.resolveDynamicPort(cfg.get<number>('debugPort', 9782), 9782);
  }

  getPort(): number {
    return this.port;
  }

  getDebugPort(): number {
    return this.debugPort;
  }

  getToken(): string {
    return this.token;
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureStarted(): Promise<void> {
    if (await this.healthOk()) {
      this.started = true;
      return;
    }
    await this.start();
    await this.waitHealthy(60000);
    this.started = true;
  }

  private resolveDynamicPort(configured: number | undefined, fallback: number): number {
    const base = Number.isFinite(configured) ? Number(configured) : fallback;
    const offset = hashString(this.sessionId) % 2000;
    const normalized = Math.max(1024, Math.min(base, 65535));
    const candidate = normalized + ((offset + 1) % 2000);
    return candidate > 65535 ? normalized + ((offset + 1) % (65535 - normalized)) : candidate;
  }

  private resolveHostCwd(): string {
    const repoEditor = path.resolve(this.context.extensionPath, '..', 'packages', 'editor-app');
    if (fs.existsSync(path.join(repoEditor, 'src-tauri'))) {
      return repoEditor;
    }
    const bundled = path.join(this.context.extensionPath, 'bin');
    return bundled;
  }

  private resolveHostCommand(cwd: string): { command: string; args: string[]; shell: boolean } {
    const releaseExe = path.join(cwd, 'src-tauri', 'target', 'release', 'WABEditor.exe');
    const debugExe = path.join(cwd, 'src-tauri', 'target', 'debug', 'WABEditor.exe');
    const bundledExe = path.join(this.context.extensionPath, 'bin', 'agent-host.exe');
    const inRepo = fs.existsSync(path.join(cwd, 'src-tauri'));

    // 仓库开发：优先本机较新的编译产物，避免旧 release / bin 缺路由或协议不兼容
    if (inRepo) {
      const releaseOk = fs.existsSync(releaseExe);
      const debugOk = fs.existsSync(debugExe);
      if (releaseOk && debugOk) {
        const releaseMtime = fs.statSync(releaseExe).mtimeMs;
        const debugMtime = fs.statSync(debugExe).mtimeMs;
        const newer = debugMtime >= releaseMtime ? debugExe : releaseExe;
        return { command: newer, args: [], shell: false };
      }
      if (releaseOk) {
        return { command: releaseExe, args: [], shell: false };
      }
      if (debugOk) {
        return { command: debugExe, args: [], shell: false };
      }
      if (fs.existsSync(bundledExe)) {
        return { command: bundledExe, args: [], shell: false };
      }
      return { command: 'pnpm', args: ['exec', 'tauri', 'dev'], shell: true };
    }

    if (fs.existsSync(bundledExe)) {
      return { command: bundledExe, args: [], shell: false };
    }
    throw new Error('未找到 Agent Host 可执行文件（bin/agent-host.exe）');
  }

  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cwd = this.resolveHostCwd();
      const env = {
        ...process.env,
        AGENT_HOST: '1',
        AGENT_HOST_PORT: String(this.port),
        AGENT_HOST_SESSION_ID: this.sessionId,
        AGENT_HOST_TOKEN: this.token,
      };

      let resolved: { command: string; args: string[]; shell: boolean };
      try {
        resolved = this.resolveHostCommand(cwd);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.child = spawn(resolved.command, resolved.args, {
        cwd: resolved.shell ? cwd : path.dirname(resolved.command),
        env,
        shell: resolved.shell,
        stdio: 'ignore',
        windowsHide: true,
      });

      this.child.on('error', (err) => reject(err));
      this.child.on('spawn', () => resolve());
      setTimeout(() => resolve(), 500);
    });
  }

  private async healthOk(): Promise<boolean> {
    try {
      const json = (await this.request('GET', '/health')) as { sessionId?: string };
      return !!json && json.sessionId === this.sessionId;
    } catch {
      return false;
    }
  }

  private async waitHealthy(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.healthOk()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Agent Host 在 ${timeoutMs}ms 内未就绪 (${this.baseUrl()})`);
  }

  request(method: string, apiPath: string, body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: apiPath,
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Host-Token': this.token,
            'X-Agent-Host-Session': this.sessionId,
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 15000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              const json = text ? JSON.parse(text) : {};
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(json.error || text || `HTTP ${res.statusCode}`));
              } else {
                resolve(json);
              }
            } catch {
              reject(new Error(text || `HTTP ${res.statusCode}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('request timeout'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async pollEvents(after: number): Promise<{ seq: number; events: Array<Record<string, unknown>> }> {
    const json = (await this.request('GET', `/events?after=${after}`)) as {
      events?: Array<Record<string, unknown>>;
    };
    const events = json.events || [];
    const last = events.length
      ? Number(events[events.length - 1].seq || after)
      : after;
    return { seq: last, events };
  }

  dispose(): void {
    if (this.child && !this.child.killed) {
      void this.request('POST', '/shutdown').catch(() => undefined);
      this.child.kill();
    }
    this.child = undefined;
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }
}

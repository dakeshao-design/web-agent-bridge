import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as http from 'node:http';
import * as fs from 'node:fs';

export class AgentHostProcess {
  private child?: ChildProcess;
  private readonly token: string;
  private readonly port: number;
  private started = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('webAgentBridge');
    this.token = cfg.get<string>('hostToken') || 'dev-token';
    this.port = cfg.get<number>('hostPort', 9791);
  }

  getPort(): number {
    return this.port;
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

  private resolveHostCwd(): string {
    const repoEditor = path.resolve(this.context.extensionPath, '..', 'packages', 'editor-app');
    if (fs.existsSync(path.join(repoEditor, 'src-tauri'))) {
      return repoEditor;
    }
    const bundled = path.join(this.context.extensionPath, 'bin');
    return bundled;
  }

  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cwd = this.resolveHostCwd();
      const env = {
        ...process.env,
        AGENT_HOST: '1',
        AGENT_HOST_PORT: String(this.port),
        AGENT_HOST_TOKEN: this.token,
      };

      const releaseDir = path.join(cwd, 'src-tauri', 'target', 'release');
      const debugDir = path.join(cwd, 'src-tauri', 'target', 'debug');
      const releaseExe = path.join(releaseDir, 'WABEditor.exe');
      const debugExe = path.join(debugDir, 'WABEditor.exe');
      const bundledExe = path.join(this.context.extensionPath, 'bin', 'agent-host.exe');

      let command: string;
      let args: string[] = [];

      if (fs.existsSync(bundledExe)) {
        command = bundledExe;
      } else if (fs.existsSync(releaseExe)) {
        command = releaseExe;
      } else if (fs.existsSync(debugExe)) {
        command = debugExe;
      } else {
        // 开发：用 pnpm tauri dev
        command = 'pnpm';
        args = ['exec', 'tauri', 'dev'];
      }

      this.child = spawn(command, args, {
        cwd: command === 'pnpm' ? cwd : path.dirname(command),
        env,
        shell: command === 'pnpm',
        stdio: 'ignore',
        windowsHide: true,
      });

      this.child.on('error', (err) => reject(err));
      this.child.on('spawn', () => resolve());
      setTimeout(() => resolve(), 500);
    });
  }

  private healthOk(): Promise<boolean> {
    return this.request('GET', '/events?after=0').then(
      () => true,
      () => false
    );
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

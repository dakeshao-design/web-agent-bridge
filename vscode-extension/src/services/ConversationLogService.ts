import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WORKSPACE_DATA_DIR } from '@my-agent-editor/shared';

type LogRole = 'user' | 'agent' | 'bridge-request' | 'bridge-response' | 'bridge-copy';
type BridgeDirection = 'request' | 'response' | 'copy';

interface SessionLogFiles {
  chat: string;
  runtime: string;
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sessionStamp(date: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  };
}

function appDataLogsDir(): string {
  const platform = os.platform();
  const base =
    platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'com.webagent.editor', 'logs');
}

export class ConversationLogService {
  private readonly sessions = new Map<string, SessionLogFiles>();
  private readonly appendQueues = new Map<string, Promise<void>>();
  private readonly lastChatEntry = new Map<string, { role: 'user' | 'agent'; content: string }>();
  private readonly lastBridgeEntry = new Map<string, { role: LogRole; content: string }>();
  /** 流式生长中待落盘的最新正文 */
  private readonly pendingGrowing = new Map<
    string,
    { role: 'user' | 'agent'; agentName: string; content: string }
  >();
  private readonly growingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly getWorkspaceRoot: () => string) {}

  async beginSession(agentId: string): Promise<void> {
    const { date, time } = sessionStamp(new Date());
    const names = {
      chat: `${agentId}-chat-${date}-${time}.log`,
      runtime: `${agentId}-runtime-${date}-${time}.log`,
    };
    const workspace = this.getWorkspaceRoot().trim();
    const dir = workspace
      ? path.join(workspace, WORKSPACE_DATA_DIR, 'logs')
      : appDataLogsDir();
    await fs.mkdir(dir, { recursive: true });
    this.sessions.set(agentId, {
      chat: path.join(dir, names.chat),
      runtime: path.join(dir, names.runtime),
    });
    this.clearGrowingState(agentId);
    this.lastChatEntry.delete(agentId);
    this.lastBridgeEntry.delete(agentId);
  }

  resetTargets(): void {
    for (const agentId of this.growingFlushTimers.keys()) {
      this.clearGrowingState(agentId);
    }
    this.sessions.clear();
    this.lastChatEntry.clear();
    this.lastBridgeEntry.clear();
  }

  async addChatEntry(
    role: 'user' | 'agent',
    agentId: string,
    agentName: string,
    content: string,
    opts?: { growing?: boolean }
  ): Promise<void> {
    const previous = this.lastChatEntry.get(agentId);
    if (previous?.role === role && previous.content.trim() === content.trim()) return;

    // 仅流式生长节流；稳定定稿与工具回传立即写完整正文
    if (opts?.growing === true) {
      this.pendingGrowing.set(agentId, { role, agentName, content });
      this.scheduleGrowingFlush(agentId);
      return;
    }

    this.clearGrowingState(agentId);
    await this.addEntry(role, agentId, agentName, content);
    this.lastChatEntry.set(agentId, { role, content });
  }

  private scheduleGrowingFlush(agentId: string): void {
    if (this.growingFlushTimers.has(agentId)) return;
    this.growingFlushTimers.set(
      agentId,
      setTimeout(() => {
        this.growingFlushTimers.delete(agentId);
        const pending = this.pendingGrowing.get(agentId);
        if (!pending) return;
        this.pendingGrowing.delete(agentId);
        void this.addEntry(pending.role, agentId, pending.agentName, pending.content)
          .then(() => {
            this.lastChatEntry.set(agentId, {
              role: pending.role,
              content: pending.content,
            });
          })
          .catch(() => undefined);
      }, 1000)
    );
  }

  private clearGrowingState(agentId: string): void {
    const timer = this.growingFlushTimers.get(agentId);
    if (timer) clearTimeout(timer);
    this.growingFlushTimers.delete(agentId);
    this.pendingGrowing.delete(agentId);
  }

  async addBridgeEntry(
    direction: BridgeDirection,
    agentId: string,
    agentName: string,
    content: string
  ): Promise<void> {
    const role: LogRole =
      direction === 'request'
        ? 'bridge-request'
        : direction === 'copy'
          ? 'bridge-copy'
          : 'bridge-response';
    const previous = this.lastBridgeEntry.get(agentId);
    if (previous?.role === role && previous.content.trim() === content.trim()) return;
    await this.addEntry(role, agentId, agentName, content);
    this.lastBridgeEntry.set(agentId, { role, content });
  }

  private async addEntry(
    role: LogRole,
    agentId: string,
    agentName: string,
    content: string
  ): Promise<void> {
    let files = this.sessions.get(agentId);
    if (!files) {
      await this.beginSession(agentId);
      files = this.sessions.get(agentId);
    }
    if (!files) throw new Error(`无法初始化 Agent 日志: ${agentId}`);

    const label =
      role === 'user'
        ? 'USER'
        : role === 'agent'
          ? 'AGENT'
          : role === 'bridge-request'
            ? 'BRIDGE-REQUEST'
            : role === 'bridge-copy'
              ? 'BRIDGE-COPY'
              : 'BRIDGE-RESPONSE';
    const block = `[${formatDate(new Date())}] [${label}] [${agentName}]\n${content}\n---\n`;
    await this.append(role.startsWith('bridge-') ? files.runtime : files.chat, block);
  }

  private async append(filePath: string, content: string): Promise<void> {
    const previous = this.appendQueues.get(filePath) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => fs.appendFile(filePath, content, 'utf8'));
    this.appendQueues.set(filePath, current);
    try {
      await current;
    } finally {
      if (this.appendQueues.get(filePath) === current) this.appendQueues.delete(filePath);
    }
  }
}

import { WORKSPACE_DATA_DIR } from '@my-agent-editor/shared';
import { exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { TauriFileService } from './TauriFileService';

export type ChatRole =
  | 'user'
  | 'agent'
  | 'bridge-request'
  | 'bridge-response'
  | 'bridge-copy'
  | 'shell';

export type BridgeCommDirection = 'request' | 'response' | 'copy';

export interface ShellLogMeta {
  command: string;
  exitCode: number;
  output: string;
  ok: boolean;
}

export interface ChatLogEntry {
  id: string;
  timestamp: Date;
  role: ChatRole;
  agentId: string;
  agentName: string;
  content: string;
  source?: string;
  meta?: ShellLogMeta;
}

const BRIDGE_ROLES: ReadonlySet<ChatRole> = new Set([
  'bridge-request',
  'bridge-response',
  'bridge-copy',
]);

function isBridgeRole(role: ChatRole): boolean {
  return BRIDGE_ROLES.has(role);
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sessionStamp(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  };
}

export class ConversationLogService {
  private static readonly MAX_UI_ENTRIES = 200;

  private entries: ChatLogEntry[] = [];
  private chatLogFilePath = '';
  private runtimeLogFilePath = '';
  private sessionAgentId = '';
  private initialized = false;

  constructor(private fileService: TauriFileService) {}

  getEntries(): ChatLogEntry[] {
    return this.entries;
  }

  /** 对话日志：应用层 user/agent/shell */
  getChatEntries(): ChatLogEntry[] {
    return this.entries.filter((e) => !isBridgeRole(e.role));
  }

  /** 运行日志：桥接层 request/response/copy */
  getRuntimeEntries(): ChatLogEntry[] {
    return this.entries.filter((e) => isBridgeRole(e.role));
  }

  getChatLogFilePath(): string {
    return this.chatLogFilePath;
  }

  getRuntimeLogFilePath(): string {
    return this.runtimeLogFilePath;
  }

  /** @deprecated 互換用；返回对话日志路径 */
  getLogFilePath(): string {
    return this.chatLogFilePath;
  }

  async beginSession(agentId: string): Promise<{ chat: string; runtime: string }> {
    const workspace = this.fileService.getWorkspaceRoot();
    const { date, time } = sessionStamp(new Date());
    const chatName = `${agentId}-chat-${date}-${time}.log`;
    const runtimeName = `${agentId}-runtime-${date}-${time}.log`;

    if (workspace) {
      const logDir = `${workspace}/${WORKSPACE_DATA_DIR}/logs`.replace(/\\/g, '/');
      this.chatLogFilePath = `${logDir}/${chatName}`;
      this.runtimeLogFilePath = `${logDir}/${runtimeName}`;
      await this.ensureDir(logDir);
    } else {
      this.chatLogFilePath = `logs/${chatName}`;
      this.runtimeLogFilePath = `logs/${runtimeName}`;
      await this.ensureDir('logs', BaseDirectory.AppData);
    }

    this.sessionAgentId = agentId;
    this.entries = [];
    this.initialized = true;
    return { chat: this.chatLogFilePath, runtime: this.runtimeLogFilePath };
  }

  /** 尚无会话文件时，按 agentId 建档 */
  async ensureSession(agentId: string): Promise<void> {
    if (this.initialized && this.chatLogFilePath && this.runtimeLogFilePath) {
      return;
    }
    await this.beginSession(agentId);
  }

  private async ensureDir(dir: string, baseDir?: BaseDirectory): Promise<void> {
    const dirExists = baseDir
      ? await exists(dir, { baseDir })
      : await exists(dir);
    if (!dirExists) {
      if (baseDir) {
        await mkdir(dir, { baseDir, recursive: true });
      } else {
        await mkdir(dir, { recursive: true });
      }
    }
  }

  formatBlock(entry: ChatLogEntry): string {
    const roleLabel =
      entry.role === 'user'
        ? 'USER'
        : entry.role === 'agent'
          ? 'AGENT'
          : entry.role === 'bridge-request'
            ? 'BRIDGE-REQUEST'
            : entry.role === 'bridge-copy'
              ? 'BRIDGE-COPY'
              : entry.role === 'shell'
                ? 'SHELL'
                : 'BRIDGE-RESPONSE';
    const sourcePart = entry.source ? ` (${entry.source})` : '';
    const header = `[${formatDate(entry.timestamp)}] [${roleLabel}] [${entry.agentName}]${sourcePart}`;
    return `${header}\n${entry.content}\n---\n`;
  }

  async addEntry(
    role: ChatRole,
    agentId: string,
    agentName: string,
    content: string,
    source?: string,
    meta?: ShellLogMeta
  ): Promise<ChatLogEntry> {
    await this.ensureSession(agentId);

    const entry: ChatLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      role,
      agentId,
      agentName,
      content,
      source,
      meta,
    };

    this.entries.push(entry);
    if (this.entries.length > ConversationLogService.MAX_UI_ENTRIES) {
      this.entries.splice(0, this.entries.length - ConversationLogService.MAX_UI_ENTRIES);
    }
    const block = this.formatBlock(entry);
    const path = isBridgeRole(role) ? this.runtimeLogFilePath : this.chatLogFilePath;
    await this.fileService.appendLog(path, block);

    return entry;
  }

  async addBridgeEntry(
    direction: BridgeCommDirection,
    agentId: string,
    agentName: string,
    content: string
  ): Promise<ChatLogEntry> {
    const role: ChatRole =
      direction === 'request'
        ? 'bridge-request'
        : direction === 'copy'
          ? 'bridge-copy'
          : 'bridge-response';
    const entries = this.entries;
    const last = entries[entries.length - 1];
    if (
      last &&
      last.role === role &&
      last.agentId === agentId &&
      last.content.trim() === content.trim()
    ) {
      return last;
    }
    return this.addEntry(role, agentId, agentName, content);
  }

  clear(): void {
    this.entries = [];
  }

  clearChatDisplay(): void {
    this.entries = this.entries.filter((e) => isBridgeRole(e.role));
  }

  clearRuntimeDisplay(): void {
    this.entries = this.entries.filter((e) => !isBridgeRole(e.role));
  }

  resetLogTarget(): void {
    this.initialized = false;
    this.chatLogFilePath = '';
    this.runtimeLogFilePath = '';
    this.sessionAgentId = '';
  }

  getSessionAgentId(): string {
    return this.sessionAgentId;
  }
}

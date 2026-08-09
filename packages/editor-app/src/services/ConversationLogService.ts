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

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `agent-chat-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
}

export class ConversationLogService {
  private static readonly MAX_UI_ENTRIES = 200;

  private entries: ChatLogEntry[] = [];
  private logFilePath = '';
  private initialized = false;

  constructor(private fileService: TauriFileService) {}

  getEntries(): ChatLogEntry[] {
    return this.entries;
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }

  async init(): Promise<string> {
    if (this.initialized) return this.logFilePath;

    const workspace = this.fileService.getWorkspaceRoot();
    const fileName = todayFileName();

    if (workspace) {
      const logDir = `${workspace}/${WORKSPACE_DATA_DIR}/logs`.replace(/\\/g, '/');
      this.logFilePath = `${logDir}/${fileName}`;
      await this.ensureDir(logDir);
    } else {
      this.logFilePath = `logs/${fileName}`;
      await this.ensureDir('logs', BaseDirectory.AppData);
    }

    this.initialized = true;
    return this.logFilePath;
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
    await this.init();

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
    await this.fileService.appendLog(this.logFilePath, block);

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

  resetLogTarget(): void {
    this.initialized = false;
    this.logFilePath = '';
  }
}

import type { AgentsConfig, AppConfig } from './types.js';
import { mergeToolPermissions } from '../agent/toolPermissions.js';
import {
  isSiteBridgeScriptFileName,
  parseBridgeScriptMeta,
} from '../agent/parseBridgeScriptMeta.js';

export type ConfigChangeCallback = (config: { agents: AgentsConfig; app: AppConfig }) => void;

export type BridgeScriptEntry = { relativePath: string; content: string };

export interface ConfigLoaderOptions {
  appConfigPath: string;
  fetchJson: (path: string) => Promise<string>;
  listBridgeScripts: () => Promise<BridgeScriptEntry[]>;
  /** 变更时回调；paths 仅作提示，实现方可忽略 */
  watch?: (paths: string[], onChange: () => void) => () => void;
}

export class ConfigLoader {
  private agents: AgentsConfig = { agents: [] };
  private app: AppConfig = {
    editor: { theme: 'one-dark', tabSize: 2, autoSave: false },
    agentBridge: { responsePollIntervalMs: 1000, responseStableCount: 3, maxContextFiles: 5 },
    fileBridge: {
      workspaceRoot: '',
      commandFormat: 'structured',
    },
    toolPermissions: mergeToolPermissions(),
  };
  private listeners: ConfigChangeCallback[] = [];
  private unwatch?: () => void;
  private options: ConfigLoaderOptions;
  private lastAppRaw = '';
  private lastAgentsFingerprint = '';

  constructor(options: ConfigLoaderOptions) {
    this.options = options;
  }

  async load(): Promise<void> {
    const appRaw = await this.options.fetchJson(this.options.appConfigPath);
    let agents: AgentsConfig = { agents: [] };
    let fingerprint = '';

    try {
      const scripts = await this.options.listBridgeScripts();
      const list = [];
      for (const entry of scripts) {
        const base = entry.relativePath.replace(/\\/g, '/').split('/').pop() || '';
        if (!isSiteBridgeScriptFileName(base)) continue;
        const meta = parseBridgeScriptMeta(entry.content, entry.relativePath.replace(/\\/g, '/'));
        if (meta) list.push(meta);
      }
      agents = { agents: list };
      fingerprint = scripts
        .map((s) => `${s.relativePath}\n${s.content}`)
        .sort()
        .join('\n---\n');
    } catch (err) {
      console.warn('[ConfigLoader] 桥接脚本加载失败，使用空列表。', err);
      agents = { agents: [] };
      fingerprint = '';
    }

    const unchanged =
      this.lastAppRaw === appRaw &&
      this.lastAgentsFingerprint === fingerprint &&
      this.lastAppRaw !== '';
    if (unchanged) {
      return;
    }

    const parsed = JSON.parse(appRaw) as AppConfig;
    this.app = {
      ...parsed,
      toolPermissions: mergeToolPermissions(parsed.toolPermissions),
    };
    this.agents = agents;
    this.lastAppRaw = appRaw;
    this.lastAgentsFingerprint = fingerprint;
    this.notify();
  }

  startWatch(): void {
    if (!this.options.watch) return;
    this.unwatch?.();
    this.unwatch = this.options.watch(
      [this.options.appConfigPath, 'scripts'],
      () => {
        this.load().catch(console.error);
      }
    );
  }

  stopWatch(): void {
    this.unwatch?.();
    this.unwatch = undefined;
  }

  onChange(callback: ConfigChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  getAgents(): AgentsConfig {
    return this.agents;
  }

  getAppConfig(): AppConfig {
    return this.app;
  }

  getEnabledAgents() {
    return this.agents.agents.filter((a) => a.enabled);
  }

  private notify(): void {
    const snapshot = { agents: this.agents, app: this.app };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

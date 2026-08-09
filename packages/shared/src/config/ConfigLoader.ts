import type { AgentsConfig, AppConfig } from './types.js';
import { mergeToolPermissions } from '../agent/toolPermissions.js';

export type ConfigChangeCallback = (config: { agents: AgentsConfig; app: AppConfig }) => void;

export interface ConfigLoaderOptions {
  agentsPath: string;
  appConfigPath: string;
  fetchJson: (path: string) => Promise<string>;
  watch?: (paths: string[], onChange: () => void) => () => void;
}

export class ConfigLoader {
  private agents: AgentsConfig = { agents: [] };
  private app: AppConfig = {
    editor: { theme: 'one-dark', tabSize: 2, autoSave: false },
    agentBridge: { responsePollIntervalMs: 500, responseStableCount: 3, maxContextFiles: 5 },
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
  private lastAgentsRaw = '';

  constructor(options: ConfigLoaderOptions) {
    this.options = options;
  }

  async load(): Promise<void> {
    const appRaw = await this.options.fetchJson(this.options.appConfigPath);
    let agentsRaw = '';
    let agents: AgentsConfig = { agents: [] };

    try {
      agentsRaw = await this.options.fetchJson(this.options.agentsPath);
      agents = JSON.parse(agentsRaw) as AgentsConfig;
    } catch (err) {
      // 正式版可不带 agents.json
      console.warn('[ConfigLoader] agents.json 加载失败，使用空列表。', err);
      agentsRaw = '';
      agents = { agents: [] };
    }

    const unchanged =
      this.lastAppRaw === appRaw && this.lastAgentsRaw === agentsRaw && this.lastAppRaw !== '';
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
    this.lastAgentsRaw = agentsRaw;
    this.notify();
  }

  startWatch(): void {
    if (!this.options.watch) return;
    this.unwatch?.();
    this.unwatch = this.options.watch(
      [this.options.agentsPath, this.options.appConfigPath],
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

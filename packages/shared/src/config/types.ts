export type AgentInputMode = 'fill' | 'type';
export type AgentTypeStrategy = 'keyboard' | 'exec' | 'paste';

/** 工具权限：允许 / 询问 / 禁止 */
export type ToolPermissionMode = 'allow' | 'ask' | 'deny';

export type ToolPermissionsConfig = Record<string, ToolPermissionMode>;

export interface AgentSelectors {
  /** JS 源码：() => HTMLElement | null */
  input?: string;
  /** JS 源码：() => HTMLElement | null */
  sendButton?: string;
  /** JS 源码：() => HTMLElement | null */
  responseContainer?: string;
  /** JS 源码：() => HTMLElement | null | boolean */
  loadingIndicator?: string;
  /** JS 源码：() => { key: number, text: string } | string | null */
  getLatestResponse?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** 省略时使用 injectScript 侧的 selectors */
  selectors?: AgentSelectors;
  injectScript: string;
  inputMode?: AgentInputMode;
  typeDelayMs?: number;
  typeStrategy?: AgentTypeStrategy;
  /** 从 *-bridge.js 的 READ_FILE_LINE_LIMIT 解析；未声明则无上限 */
  readFileLineLimit?: number;
  /** 从 *-bridge.js 的 WRITE_FILE_LINE_LIMIT 解析；提示用，工具侧不强制 */
  writeFileLineLimit?: number;
}

export interface AgentsConfig {
  agents: AgentConfig[];
}

export interface EditorConfig {
  theme: string;
  tabSize: number;
  autoSave: boolean;
}

export interface AgentBridgeConfig {
  responsePollIntervalMs: number;
  responseStableCount: number;
  maxContextFiles: number;
  autoApply?: boolean;
}

export interface FileBridgeConfig {
  workspaceRoot: string;
  commandFormat: 'structured' | 'markdown';
}

export interface AppConfig {
  editor: EditorConfig;
  agentBridge: AgentBridgeConfig;
  fileBridge: FileBridgeConfig;
  /** 按工具名的权限；缺省项用默认值合并 */
  toolPermissions?: ToolPermissionsConfig;
}

export interface AppSettings {
  agents: AgentsConfig;
  app: AppConfig;
}

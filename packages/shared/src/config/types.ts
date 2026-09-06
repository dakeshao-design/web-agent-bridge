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
  /** 点击发送后等待毫秒；未设置按 300。未 loading 且会话 key 未变则重试。头注释 @waitBeforeSend */
  waitBeforeSend?: number;
  /** 头注释 @newChatOnload；true 时页面 composer 就绪后通知 Host 注入 Agent 模式提示词。默认 false。有 newChatSession 则先调用 */
  newChatOnload?: boolean;
  /** 头注释 @readFileLineLimit；未声明则无上限 */
  readFileLineLimit?: number;
  /** 头注释 @writeFileLineLimit；提示用，工具侧不强制 */
  writeFileLineLimit?: number;
  /** 从 *-bridge.js 的 SITE_AGENT_PROMPT 解析；注入 Agent 模式提示词末尾 */
  siteAgentPrompt?: string;
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

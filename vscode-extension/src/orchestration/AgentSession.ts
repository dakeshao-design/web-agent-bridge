import * as vscode from 'vscode';
import {
  buildAgentModePrompt,
  buildIncompleteCallToolHint,
  buildPowershellFinalResult,
  buildPowershellProgressMessage,
  buildPowershellTerminatedResult,
  buildToolResultFromOperation,
  buildDeniedToolResult,
  buildPermissionAskMessage,
  buildUnknownToolResult,
  CallToolParser,
  ConfigLoader,
  callToolDisplayStatusKey,
  extractCallToolDisplayMeta,
  fileOperationsFingerprint,
  FileOperationParser,
  findUnknownCallToolNames,
  getToolByAction,
  hasIncompleteCallTool,
  isIncompleteFromLastConversation,
  IncompleteCallToolConfirm,
  isToolCallAlreadyReported,
  keyArgsFromToolArgs,
  mergeToolPermissions,
  buildSelectionMessage,
  parseFileLineLimitsFromBridgeScript,
  findLatestCallToolSource,
  POWERSHELL_PROGRESS_INTERVAL_MS,
  parsePowershellWaitDecision,
  resolveEffectivePermission,
  resolveToolNameForOperation,
  listToolsForSettings,
  findSkillByName,
  splitCallToolDisplayParts,
  SYSTEM_MARKER,
  USER_MARKER,
  type AgentConfig,
  type AgentStatus,
  type AppConfig,
  type AgentSkill,
  type CallToolDisplayStatus,
  type FileOperation,
  type ToolApplyResult,
  type ToolPermissionMode,
  type ToolPermissionsConfig,
  pollSnapshotFingerprint,
} from '@my-agent-editor/shared';
import type { ConfigService } from '../services/ConfigService';
import type { VscodeFileService } from '../services/VscodeFileService';
import type { AgentHostBridge } from '../services/AgentHostBridge';
import type { AgentHostProcess } from '../services/AgentHostProcess';
import { discoverSkills } from '../services/discoverSkills';
import { applyFileOperation } from '../tools/applyFileOperation';
import {
  killAllPowershellSessions,
  startPowershellSession,
  type PowershellSession,
} from '../tools/handlers/runPowershellHandler';
import type { LogStatus } from '../tools/types';

export type ChatEntry = {
  agentId: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  key?: string;
};

export type LogEntry = {
  id: string;
  action: string;
  path?: string;
  status: LogStatus;
  message?: string;
  at: number;
};

type UiListener = () => void;

type PendingDecision = {
  resolve: (text: string | null) => void;
};

export class AgentSession {
  private agents: AgentConfig[] = [];
  private toolPermissions: ToolPermissionsConfig = mergeToolPermissions();
  private activeAgentId: string | null = null;
  private statuses: Record<string, AgentStatus> = {};
  private chats: ChatEntry[] = [];
  private logs: LogEntry[] = [];
  private agentModeEnabled = false;
  private skills: AgentSkill[] = [];
  private onloadAgentModeDone = new Set<string>();
  /** 新会话后待与首条用户消息合并注入的 Agent */
  private pendingAgentModeInjection = new Set<string>();
  private parser = new FileOperationParser('structured');
  private callToolParser = new CallToolParser();
  private inflightToolOps = new Set<string>();
  private incompleteHints = new Set<string>();
  private unknownToolHints = new Set<string>();
  private incompleteConfirm = new IncompleteCallToolConfirm();
  /** call-tool 面板摘要状态 */
  private callToolDisplayStatus = new Map<string, CallToolDisplayStatus>();
  private listeners = new Set<UiListener>();
  private configWatch?: vscode.Disposable;
  private disposed = false;
  /** agentId → 等待进度确认 */
  private pendingDecisions = new Map<string, PendingDecision>();
  private waitingWatch = new Map<
    string,
    {
      fingerprint: string;
      changeSince: number;
    }
  >();
  private waitingPollTimer?: ReturnType<typeof setInterval>;
  /** 对话同步去重：agentId:role:key */
  private loggedChatKeys = new Set<string>();
  private loggedAgentTexts = new Map<string, string>();
  /** 自动打开的登录窗，就绪后才 hide */
  private autoOpenedLogin = new Set<string>();
  /** 登录探测世代号，递增即取消 */
  private loginProbeGen = new Map<string, number>();
  /** 首次建站：输入框未就绪前保持 waiting */
  private composerInitPending = new Set<string>();
  /** 输入框就绪等待世代号，递增即取消 */
  private composerInitGen = new Map<string, number>();
  /** WAB 侧栏视图是否可见 */
  private panelVisible = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigService,
    private readonly fileService: VscodeFileService,
    private readonly bridge: AgentHostBridge,
    private readonly host: AgentHostProcess
  ) {}

  /** 是否已打开工作区文件夹 */
  private hasWorkspace(): boolean {
    if (vscode.workspace.workspaceFolders?.length) return true;
    return !!this.fileService.getWorkspaceRoot().trim();
  }

  /** 自动初始化 Agent 站点需同时满足：工作区 + WAB 视图可见 */
  private canAutoInitAgentSites(): boolean {
    return this.panelVisible && this.hasWorkspace();
  }

  /** 侧栏可见性变化；满足条件时再启动 Host 并创建站点 */
  setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    if (visible) {
      void this.tryAutoInitAgentSites();
    }
  }

  onUiChange(listener: UiListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private lastAgentText(agentId: string): string {
    return (
      [...this.chats]
        .reverse()
        .find((c) => c.agentId === agentId && c.role === 'agent')?.text ?? ''
    );
  }

  private findLatestCallToolForAgent(agentId: string) {
    const texts = [...this.chats]
      .reverse()
      .filter((c) => c.agentId === agentId && c.role === 'agent')
      .map((c) => c.text);
    return findLatestCallToolSource(texts);
  }

  private setStatus(agentId: string, status: AgentStatus): void {
    // 找输入框完成前不允许回 idle
    if (status === 'idle' && this.composerInitPending.has(agentId)) return;
    if (this.statuses[agentId] === status) return;
    this.statuses[agentId] = status;
    if (status === 'waiting') {
      const watch = this.waitingWatch.get(agentId);
      if (watch) {
        watch.changeSince = Date.now();
      }
    }
    this.notify();
  }

  private startWaitingPoll(): void {
    if (this.waitingPollTimer) return;
    this.waitingPollTimer = setInterval(() => {
      void this.pollWaitingStatuses();
    }, 1000);
  }

  private async pollWaitingStatuses(): Promise<void> {
    const ids = new Set<string>([
      ...this.agents.map((a) => a.id),
      ...Object.keys(this.statuses),
    ]);
    for (const agentId of ids) {
      const status = this.statuses[agentId];
      if (status === 'error' || status === 'sending') continue;

      if (this.composerInitPending.has(agentId)) {
        this.setStatus(agentId, 'waiting');
        continue;
      }

      const hasInflight = [...this.inflightToolOps].some((k) =>
        k.startsWith(`${agentId}:`)
      );
      const hasPendingPs = this.pendingDecisions.has(agentId);
      if (hasInflight || hasPendingPs) {
        this.setStatus(agentId, 'waiting');
        continue;
      }

      const snap = await this.bridge.getPollSnapshot(agentId);
      const fingerprint = pollSnapshotFingerprint(snap);
      let watch = this.waitingWatch.get(agentId);
      if (!watch) {
        watch = {
          fingerprint,
          changeSince: snap.loading ? Date.now() : Date.now() - 10000,
        };
        this.waitingWatch.set(agentId, watch);
      } else if (fingerprint !== watch.fingerprint) {
        watch.fingerprint = fingerprint;
        watch.changeSince = Date.now();
      }

      if (snap.loading || Date.now() - watch.changeSince < 10000) {
        this.setStatus(agentId, 'waiting');
      } else if (status === 'waiting') {
        this.setStatus(agentId, 'idle');
      }
    }
  }

  getSnapshot() {
    return {
      agents: this.agents,
      activeAgentId: this.activeAgentId,
      statuses: { ...this.statuses },
      chats: this.chats
        .filter((c) => !c.text.trimStart().startsWith(SYSTEM_MARKER))
        .slice(-200)
        .map((c) => {
          if (c.role !== 'agent') return c;
          return {
            ...c,
            displayParts: splitCallToolDisplayParts(c.text, (name, keyArgs, raw) =>
              this.resolveCallToolDisplayStatus(c.agentId, name, keyArgs, raw)
            ),
          };
        }),
      logs: this.logs.slice(-100),
      agentModeEnabled: this.agentModeEnabled,
      hostReady: this.host.isStarted(),
      toolPermissions: { ...this.toolPermissions },
      toolsForSettings: listToolsForSettings(),
    };
  }

  private resolveCallToolDisplayStatus(
    agentId: string,
    toolName: string,
    keyArgs: string[],
    raw: string
  ): CallToolDisplayStatus {
    const ops = this.callToolParser.parse(raw);
    if (ops.length > 0) {
      const fpHit = this.callToolDisplayStatus.get(
        this.opDisplayStatusKey(agentId, ops)
      );
      if (fpHit) return fpHit;
    }
    const argsHit = this.callToolDisplayStatus.get(
      callToolDisplayStatusKey(agentId, toolName, keyArgs)
    );
    if (argsHit) return argsHit;
    if (!/\bEND_TOOL\b/i.test(raw)) return '进行中';
    return '成功';
  }

  private opDisplayStatusKey(agentId: string, ops: FileOperation[]): string {
    return `${agentId}\nfp:${fileOperationsFingerprint(ops)}`;
  }

  private setOpDisplayStatus(
    agentId: string,
    op: FileOperation,
    status: CallToolDisplayStatus
  ): void {
    const tool = getToolByAction(op.action);
    const toolName = tool?.name ?? op.action;
    const args = tool?.toArgs(op) ?? { path: op.path };
    const keyArgs = keyArgsFromToolArgs(toolName, args);
    const keys = [
      this.opDisplayStatusKey(agentId, [op]),
      callToolDisplayStatusKey(agentId, toolName, keyArgs),
    ];
    let changed = false;
    for (const key of keys) {
      if (this.callToolDisplayStatus.get(key) === status) continue;
      this.callToolDisplayStatus.set(key, status);
      changed = true;
    }
    if (changed) this.notify();
  }

  private setTextDisplayStatus(
    agentId: string,
    text: string,
    status: CallToolDisplayStatus
  ): void {
    let changed = false;
    const ops = this.callToolParser.parse(text);
    if (ops.length > 0) {
      const fpKey = this.opDisplayStatusKey(agentId, ops);
      const prev = this.callToolDisplayStatus.get(fpKey);
      // 聊天同步不得把成功/失败打回进行中
      if (!(status === '进行中' && (prev === '成功' || prev === '失败'))) {
        if (prev !== status) {
          this.callToolDisplayStatus.set(fpKey, status);
          changed = true;
        }
      }
    }
    for (const part of splitCallToolDisplayParts(text, () => status)) {
      if (part.kind !== 'tool') continue;
      const meta = extractCallToolDisplayMeta(part.raw);
      if (!meta) continue;
      const key = callToolDisplayStatusKey(agentId, meta.toolName, meta.keyArgs);
      const prev = this.callToolDisplayStatus.get(key);
      if (status === '进行中' && (prev === '成功' || prev === '失败')) continue;
      if (prev === status) continue;
      this.callToolDisplayStatus.set(key, status);
      changed = true;
    }
    if (changed) this.notify();
  }

  async saveToolPermissions(permissions: ToolPermissionsConfig): Promise<void> {
    const merged = mergeToolPermissions(permissions);
    const raw = await this.configService.readAppConfigRaw();
    const parsed = JSON.parse(raw) as AppConfig;
    const next: AppConfig = { ...parsed, toolPermissions: merged };
    await this.configService.writeAppConfigRaw(JSON.stringify(next, null, 2) + '\n');
    this.toolPermissions = merged;
    this.notify();
  }

  setToolPermissionDraft(toolName: string, mode: ToolPermissionMode): void {
    if (mode !== 'allow' && mode !== 'ask' && mode !== 'deny') return;
    this.toolPermissions = { ...this.toolPermissions, [toolName]: mode };
    this.notify();
  }

  async init(): Promise<void> {
    this.bridge.onResponse((agentId, text, key) =>
      this.handleAgentResponse(agentId, text, key)
    );
    this.bridge.onChatMessage((agentId, role, key, text) => {
      this.incompleteConfirm.onContentChange(agentId, text);
      if (!this.acceptSyncedChat(agentId, role, key, text)) {
        return;
      }
      // 转圈由 waiting 轮询根据 pollSnapshot 决定，聊天同步不主动置 idle
      this.notify();
    });
    this.bridge.onNewChatOnloadAgentMode(async (agentId) => {
      if (this.onloadAgentModeDone.has(agentId)) return;
      const agent = this.agents.find((a) => a.id === agentId);
      if (!agent?.newChatOnload) return;
      this.onloadAgentModeDone.add(agentId);
      this.markPendingAgentModeInjection(agentId);
    });
    this.bridge.onAgentClosed((agentId) => {
      this.cancelLoginProbe(agentId);
      this.cancelComposerInitWait(agentId);
    });
    this.bridge.startEventLoop();
    this.startWaitingPoll();

    await this.reloadAgents();
    this.configWatch = this.configService.watchConfig(() => {
      void this.reloadAgents();
    });
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.tryAutoInitAgentSites();
      })
    );
  }

  /** 有工作区且 WAB 可见时，按 autoStartHost 启动 Host 并创建活动 Agent */
  private async tryAutoInitAgentSites(): Promise<void> {
    if (!this.canAutoInitAgentSites()) return;
    const autoStart = vscode.workspace
      .getConfiguration('webAgentBridge')
      .get<boolean>('autoStartHost', true);
    if (!autoStart && !this.host.isStarted()) return;
    try {
      await this.host.ensureStarted();
      await this.ensureWebviews();
    } catch (err) {
      vscode.window.showWarningMessage(
        `Agent Host 未启动: ${err instanceof Error ? err.message : String(err)}。可稍后重试或手动运行 pnpm agent-host。`
      );
    }
  }

  async reloadAgents(): Promise<void> {
    const loader = new ConfigLoader({
      appConfigPath: this.configService.getAppConfigPath(),
      fetchJson: async (p) => {
        const uri = vscode.Uri.file(p);
        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(data);
      },
      listBridgeScripts: () => this.configService.listBridgeScripts(),
    });
    await loader.load();
    const app = loader.getAppConfig();
    this.toolPermissions = mergeToolPermissions(app.toolPermissions);
    this.parser = new FileOperationParser(app.fileBridge?.commandFormat || 'structured');
    if (app.fileBridge?.workspaceRoot) {
      this.fileService.setWorkspaceRoot(app.fileBridge.workspaceRoot);
    }

    this.agents = await this.attachFileLineLimits(loader.getEnabledAgents());
    if (!this.activeAgentId || !this.agents.some((a) => a.id === this.activeAgentId)) {
      this.activeAgentId = this.agents[0]?.id ?? null;
    }

    if (this.canAutoInitAgentSites()) {
      await this.tryAutoInitAgentSites();
    }
    this.notify();
  }

  private async attachFileLineLimits(list: AgentConfig[]): Promise<AgentConfig[]> {
    return Promise.all(
      list.map(async (agent) => {
        try {
          const src = await this.configService.readBridgeScript(agent.injectScript);
          const limits = parseFileLineLimitsFromBridgeScript(src);
          return {
            ...agent,
            ...(limits.read != null ? { readFileLineLimit: limits.read } : {}),
            ...(limits.write != null ? { writeFileLineLimit: limits.write } : {}),
          };
        } catch {
          return agent;
        }
      })
    );
  }

  private async ensureWebviews(): Promise<void> {
    let template = '';
    try {
      template = await this.configService.readBridgeScript('scripts/bridge-default.js');
    } catch (err) {
      vscode.window.showErrorMessage(`读取 bridge-default.js 失败: ${err}`);
      return;
    }

    // 仅创建当前活动 Agent，避免其它站点静默窗意外弹出
    const agent = this.agents.find((a) => a.id === this.activeAgentId);
    if (!agent) return;
    if (this.bridge.hasAgent(agent.id)) {
      // 已创建但 Session 尚无 status 时补 idle，避免发送按钮一直禁用
      if (!this.statuses[agent.id]) {
        this.statuses[agent.id] = 'idle';
        this.notify();
      }
      return;
    }

    try {
      const siteScript = await this.configService.readBridgeScript(agent.injectScript);
      this.setStatus(agent.id, 'waiting');
      this.startComposerInitWait(agent.id);
      await this.bridge.createAgent(agent, siteScript, template, true);
      this.startLoginProbe(agent.id);
    } catch (err) {
      this.cancelComposerInitWait(agent.id);
      this.setStatus(agent.id, 'error');
      this.chats.push({
        agentId: agent.id,
        role: 'system',
        text: `创建 Agent 失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    this.notify();
  }

  setActiveAgent(id: string): void {
    this.activeAgentId = id;
    this.notify();
    if (this.canAutoInitAgentSites() && this.host.isStarted()) {
      void this.ensureWebviews();
    }
  }

  async sendChat(text: string, explicitAgentId?: string): Promise<void> {
    const agentId = explicitAgentId || this.activeAgentId;
    if (!agentId || !text.trim()) return;
    if (!this.hasWorkspace()) {
      void vscode.window.showWarningMessage(
        '工作区未打开：请在当前窗口用「文件 → 打开文件夹」打开项目'
      );
      return;
    }
    await this.ensureHostAndAgents();
    let wireText = text;
    if (this.pendingAgentModeInjection.has(agentId)) {
      this.pendingAgentModeInjection.delete(agentId);
      wireText = await this.buildDeferredAgentModeWireText(agentId, text);
      this.agentModeEnabled = true;
    }
    this.chats.push({ agentId, role: 'user', text });
    this.setStatus(agentId, 'sending');
    await this.bridge.sendMessage(agentId, wireText);
    this.setStatus(agentId, 'waiting');
  }

  /** 标记新会话后待合并注入 Agent 模式提示词 */
  private markPendingAgentModeInjection(agentId: string): void {
    this.pendingAgentModeInjection.add(agentId);
    this.agentModeEnabled = true;
    this.notify();
  }

  /** 新会话后清空该 Agent 的对话、去重与工具相关内存状态 */
  private resetAgentConversationState(agentId: string): void {
    this.chats = this.chats.filter((c) => c.agentId !== agentId);

    const colonPrefix = `${agentId}:`;
    const nlPrefix = `${agentId}\n`;
    const dropPrefixed = (store: Set<string> | Map<string, unknown>) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(colonPrefix) || key.startsWith(nlPrefix)) {
          store.delete(key);
        }
      }
    };
    dropPrefixed(this.loggedChatKeys);
    dropPrefixed(this.loggedAgentTexts);
    dropPrefixed(this.incompleteHints);
    dropPrefixed(this.unknownToolHints);
    dropPrefixed(this.inflightToolOps);
    dropPrefixed(this.callToolDisplayStatus);

    this.incompleteConfirm.cancel(agentId);
    this.waitingWatch.delete(agentId);

    const pending = this.pendingDecisions.get(agentId);
    if (pending) {
      pending.resolve(null);
      this.pendingDecisions.delete(agentId);
    }

    this.setStatus(agentId, 'idle');
  }

  /** 首条用户消息：提示词（无等待句）+ [USER] + 用户原文 */
  private async buildDeferredAgentModeWireText(
    agentId: string,
    userText: string
  ): Promise<string> {
    const root = this.fileService.getWorkspaceRoot();
    const agent = this.agents.find((a) => a.id === agentId);
    this.skills = await discoverSkills(this.fileService, this.configService);
    const prompt = buildAgentModePrompt(
      root || undefined,
      agent?.readFileLineLimit,
      this.toolPermissions,
      agent?.writeFileLineLimit,
      agent?.siteAgentPrompt,
      this.skills,
      { omitWaitForUser: true }
    );
    const base = prompt.endsWith('\n') ? prompt : `${prompt}\n`;
    return `${base}${USER_MARKER}\n${userText}`;
  }

  async sendCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('没有活动编辑器');
      return;
    }
    const pathLabel = editor.document.uri.fsPath;
    const content = editor.document.getText();
    const msg = `当前文件: ${pathLabel}\n\n\`\`\`\n${content}\n\`\`\``;
    await this.sendChat(msg);
  }

  async sendSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('没有活动编辑器');
      return;
    }
    const sel = editor.selection;
    const text = editor.document.getText(sel);
    if (!text) {
      vscode.window.showWarningMessage('没有选中内容');
      return;
    }
    let startLine = sel.start.line + 1;
    let endLine = sel.end.line + 1;
    // 选到下一行行首时不计入该行
    if (!sel.isEmpty && sel.end.character === 0 && endLine > startLine) {
      endLine -= 1;
    }
    const msg = buildSelectionMessage({
      path: editor.document.uri.fsPath,
      startLine,
      endLine,
      text,
    });
    await this.sendChat(msg);
  }

  async sendAgentMode(explicitAgentId?: string): Promise<void> {
    const agentId = explicitAgentId || this.activeAgentId;
    if (agentId) this.pendingAgentModeInjection.delete(agentId);
    const root = this.fileService.getWorkspaceRoot();
    const agent = this.agents.find((a) => a.id === agentId);
    this.skills = await discoverSkills(this.fileService, this.configService);
    const msg = buildAgentModePrompt(
      root || undefined,
      agent?.readFileLineLimit,
      this.toolPermissions,
      agent?.writeFileLineLimit,
      agent?.siteAgentPrompt,
      this.skills
    );
    this.agentModeEnabled = true;
    await this.sendChat(msg, agentId || undefined);
  }

  async getAgentModePromptText(): Promise<string> {
    const agentId = this.activeAgentId;
    const root = this.fileService.getWorkspaceRoot();
    const agent = this.agents.find((a) => a.id === agentId);
    this.skills = await discoverSkills(this.fileService, this.configService);
    return buildAgentModePrompt(
      root || undefined,
      agent?.readFileLineLimit,
      this.toolPermissions,
      agent?.writeFileLineLimit,
      agent?.siteAgentPrompt,
      this.skills
    );
  }

  getLastCallToolBlocks(): string {
    const agentId = this.activeAgentId;
    if (!agentId) return '';
    const found = this.findLatestCallToolForAgent(agentId);
    return found ? found.blocks.join('\n\n') : '';
  }

  async executeLastCallToolForce(): Promise<void> {
    const agentId = this.activeAgentId;
    if (!agentId) {
      void vscode.window.showWarningMessage('请先选择 Agent');
      return;
    }
    const found = this.findLatestCallToolForAgent(agentId);
    if (!found) {
      void vscode.window.showInformationMessage('无 call-tool 可执行');
      return;
    }
    await this.handleAgentResponse(agentId, found.text, undefined, { force: true });
  }

  /** 新会话：站点 newChatSession 完成后等待 0.5s，清空本地对话缓存，标记待与首条用户消息合并注入 */
  async newChatSession(): Promise<void> {
    const agentId = this.activeAgentId;
    if (!agentId) {
      void vscode.window.showWarningMessage('请先选择 Agent');
      return;
    }
    try {
      await this.ensureHostAndAgents();
      await this.bridge.newChatSession(agentId);
      await new Promise((r) => setTimeout(r, 500));
      this.resetAgentConversationState(agentId);
      this.markPendingAgentModeInjection(agentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`新会话失败: ${msg}`);
    }
  }

  async showLogin(): Promise<void> {
    const agentId = this.activeAgentId;
    if (!agentId) {
      void vscode.window.showWarningMessage('请先选择 Agent');
      return;
    }
    try {
      await this.ensureHostAndAgents();
      // 手动打开：取消自动开/关
      this.markManualLogin(agentId);
      try {
        await this.bridge.showForLogin(agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found/i.test(msg)) throw err;
        // 用户手动关闭后窗口已销毁，重建再打开
        this.bridge.forgetAgent(agentId);
        this.onloadAgentModeDone.delete(agentId);
        this.cancelLoginProbe(agentId);
        this.cancelComposerInitWait(agentId);
        await this.ensureWebviews();
        this.markManualLogin(agentId);
        await this.bridge.showForLogin(agentId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`打开登录窗失败: ${msg}`);
    }
  }

  /** 取消登录探测并清除自动打开标记 */
  private cancelLoginProbe(agentId: string): void {
    const gen = (this.loginProbeGen.get(agentId) ?? 0) + 1;
    this.loginProbeGen.set(agentId, gen);
    this.autoOpenedLogin.delete(agentId);
  }

  /** 取消首次输入框就绪等待 */
  private cancelComposerInitWait(agentId: string): void {
    this.composerInitPending.delete(agentId);
    this.composerInitGen.set(agentId, (this.composerInitGen.get(agentId) ?? 0) + 1);
  }

  /** 首次建站：等到输入框就绪再从 waiting 回 idle */
  private startComposerInitWait(agentId: string): void {
    this.composerInitPending.add(agentId);
    const gen = (this.composerInitGen.get(agentId) ?? 0) + 1;
    this.composerInitGen.set(agentId, gen);
    void this.runComposerInitWait(agentId, gen);
  }

  private async runComposerInitWait(agentId: string, gen: number): Promise<void> {
    while (
      !this.disposed &&
      this.composerInitGen.get(agentId) === gen &&
      this.composerInitPending.has(agentId)
    ) {
      let ready = false;
      try {
        ready = await this.bridge.isComposerReady(agentId);
      } catch {
        ready = false;
      }
      if (
        this.disposed ||
        this.composerInitGen.get(agentId) !== gen ||
        !this.composerInitPending.has(agentId)
      ) {
        return;
      }
      if (ready) {
        this.composerInitPending.delete(agentId);
        if (this.statuses[agentId] === 'waiting') {
          this.setStatus(agentId, 'idle');
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** 手动登录：停止自动打开与自动关闭 */
  private markManualLogin(agentId: string): void {
    this.cancelLoginProbe(agentId);
  }

  private startLoginProbe(agentId: string): void {
    const gen = (this.loginProbeGen.get(agentId) ?? 0) + 1;
    this.loginProbeGen.set(agentId, gen);
    this.autoOpenedLogin.delete(agentId);
    void this.runLoginProbe(agentId, gen);
  }

  private isLoginProbeActive(agentId: string, gen: number): boolean {
    return !this.disposed && this.loginProbeGen.get(agentId) === gen;
  }

  /** 创建后探测输入框：5s 未就绪则自动打开登录窗，就绪后仅自动打开的才 hide */
  private async runLoginProbe(agentId: string, gen: number): Promise<void> {
    const deadline = Date.now() + 5000;
    let autoOpened = false;
    while (this.isLoginProbeActive(agentId, gen)) {
      let ready = false;
      try {
        ready = await this.bridge.isComposerReady(agentId);
      } catch {
        ready = false;
      }
      if (!this.isLoginProbeActive(agentId, gen)) return;
      if (ready) {
        if (this.autoOpenedLogin.has(agentId)) {
          this.autoOpenedLogin.delete(agentId);
          try {
            await this.bridge.hide(agentId);
          } catch {
            // 忽略 hide 失败
          }
        }
        return;
      }
      if (!autoOpened && Date.now() >= deadline) {
        autoOpened = true;
        this.autoOpenedLogin.add(agentId);
        try {
          await this.bridge.showForLogin(agentId);
        } catch {
          this.autoOpenedLogin.delete(agentId);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** UI「终止终端」：结束全部会话 */
  async killAllPowershell(): Promise<void> {
    for (const [agentId, pending] of this.pendingDecisions) {
      pending.resolve(null);
      this.pendingDecisions.delete(agentId);
    }
    const n = killAllPowershellSessions();
    this.chats.push({
      agentId: this.activeAgentId ?? 'system',
      role: 'system',
      text: n > 0 ? `已终止 ${n} 个 PowerShell 进程` : '无运行中的 PowerShell',
    });
    this.notify();
    if (n > 0) {
      void vscode.window.showInformationMessage(`已终止 ${n} 个 PowerShell 进程`);
    } else {
      void vscode.window.showInformationMessage('无运行中的 PowerShell');
    }
  }

  private async ensureHostAndAgents(): Promise<void> {
    if (!this.hasWorkspace()) {
      throw new Error('工作区未打开：请在当前窗口用「文件 → 打开文件夹」打开项目');
    }
    await this.host.ensureStarted();
    await this.ensureWebviews();
  }

  /** Host 同步对话；跳过与本地已入队同文案的 user 消息 */
  private acceptSyncedChat(
    agentId: string,
    role: 'user' | 'agent',
    key: string,
    text: string
  ): boolean {
    if (role === 'agent') {
      const dedupeKey = `${agentId}:agent:${key}`;
      const prevText = this.loggedAgentTexts.get(dedupeKey);
      if (key !== '' && this.loggedChatKeys.has(dedupeKey)) {
        if (!prevText || prevText === text) {
          return false;
        }
        // 同 key 文本变化则原地更新
        this.loggedChatKeys.delete(dedupeKey);
        const idx = this.findChatIndex(agentId, 'agent', key);
        if (idx >= 0) {
          this.chats[idx] = { agentId, role, key, text };
          this.loggedChatKeys.add(dedupeKey);
          this.loggedAgentTexts.set(dedupeKey, text);
          if (text.includes('BEGIN_TOOL')) {
            this.setTextDisplayStatus(agentId, text, '进行中');
          }
          return true;
        }
      }
      if (key !== '') {
        this.loggedChatKeys.add(dedupeKey);
        this.loggedAgentTexts.set(dedupeKey, text);
      }
      this.chats.push({ agentId, role, key, text });
      if (text.includes('BEGIN_TOOL')) {
        this.setTextDisplayStatus(agentId, text, '进行中');
      }
      return true;
    }

    const dedupeKey = `${agentId}:user:${key}`;
    if (key !== '' && this.loggedChatKeys.has(dedupeKey)) {
      return false;
    }

    const lastUser = [...this.chats]
      .reverse()
      .find((c) => c.role === 'user' && c.agentId === agentId);
    if (lastUser && lastUser.text.trim() === text.trim()) {
      if (key !== '') {
        this.loggedChatKeys.add(dedupeKey);
        if (lastUser.key == null) lastUser.key = key;
      }
      return false;
    }
    // 合并发送回传：全文含 [USER]\n 且后缀等于本地已显示的用户原文
    const userMarker = `${USER_MARKER}\n`;
    const markerIdx = text.indexOf(userMarker);
    if (
      lastUser &&
      markerIdx >= 0 &&
      text.slice(markerIdx + userMarker.length).trim() === lastUser.text.trim()
    ) {
      if (key !== '') {
        this.loggedChatKeys.add(dedupeKey);
        if (lastUser.key == null) lastUser.key = key;
      }
      return false;
    }

    if (key !== '') this.loggedChatKeys.add(dedupeKey);
    this.chats.push({ agentId, role, key, text });
    return true;
  }

  private findChatIndex(
    agentId: string,
    role: 'user' | 'agent',
    key: string
  ): number {
    if (key === '') return -1;
    for (let i = this.chats.length - 1; i >= 0; i--) {
      const c = this.chats[i];
      if (c.agentId === agentId && c.role === role && c.key === key) {
        return i;
      }
    }
    return -1;
  }

  private waitNextAgentReply(agentId: string): Promise<string | null> {
    const prev = this.pendingDecisions.get(agentId);
    if (prev) prev.resolve(null);
    return new Promise((resolve) => {
      this.pendingDecisions.set(agentId, { resolve });
    });
  }

  private async sendToolResult(agentId: string, message: string): Promise<void> {
    try {
      await this.bridge.sendMessage(agentId, message);
      this.setStatus(agentId, 'waiting');
    } catch (err) {
      this.setStatus(agentId, 'error');
      this.chats.push({
        agentId,
        role: 'system',
        text: `回传工具结果失败: ${err instanceof Error ? err.message : String(err)}`,
      });
      this.notify();
    }
  }

  private async runPowershellWithProgress(
    agentId: string,
    op: FileOperation
  ): Promise<{ skippedReply?: string }> {
    const command = op.command?.trim() ?? '';
    const cwd = this.fileService.getWorkspaceRoot().trim();
    if (!command) {
      const result = { ok: false, message: 'command 为空' } satisfies ToolApplyResult;
      this.setOpDisplayStatus(agentId, op, '失败');
      this.addLog(op, 'error', result.message);
      await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
      return {};
    }
    if (!cwd) {
      const result = {
        ok: false,
        message: '工作区未打开：请在当前窗口用「文件 → 打开文件夹」打开项目',
      } satisfies ToolApplyResult;
      this.setOpDisplayStatus(agentId, op, '失败');
      this.addLog(op, 'error', result.message);
      await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
      return {};
    }

    this.setOpDisplayStatus(agentId, op, '进行中');

    const session: PowershellSession = startPowershellSession(command, cwd);
    const t0 = Date.now();
    let reported = 0;
    let sentFinal = false;

    const sendFinal = async (result: ToolApplyResult, status: LogStatus) => {
      if (sentFinal) return;
      sentFinal = true;
      this.setOpDisplayStatus(agentId, op, result.ok ? '成功' : '失败');
      this.addLog(op, status, result.message);
      await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
    };

    while (true) {
      const outcome = await session.wait(POWERSHELL_PROGRESS_INTERVAL_MS);
      if (outcome === 'exited') {
        const result = buildPowershellFinalResult({
          content: session.getOutput(),
          exitCode: session.getExitCode() ?? 1,
        });
        await sendFinal(result, result.ok ? 'applied' : 'error');
        return {};
      }
      if (outcome === 'killed') {
        const result = buildPowershellTerminatedResult({
          content: session.getOutput(),
          reason: 'user',
        });
        await sendFinal(result, 'error');
        return {};
      }

      const all = session.getOutput();
      const neu = all.slice(reported);
      reported = all.length;
      const elapsedSec = Math.round((Date.now() - t0) / 1000);
      const progress = buildPowershellProgressMessage({
        command,
        elapsedSec,
        newOutput: neu,
      });
      await this.sendToolResult(agentId, progress);

      const reply = await this.waitNextAgentReply(agentId);
      this.pendingDecisions.delete(agentId);

      if (reply === null) {
        if (!session.isExited()) session.kill();
        const result = buildPowershellTerminatedResult({
          content: session.getOutput(),
          reason: 'user',
        });
        await sendFinal(result, 'error');
        return {};
      }

      const decision = parsePowershellWaitDecision(reply);
      if (decision === 'continue') continue;
      if (decision === 'terminate') {
        session.kill();
        const killed = await session.wait(Number.POSITIVE_INFINITY);
        void killed;
        const result = buildPowershellTerminatedResult({
          content: session.getOutput(),
          reason: 'agent',
        });
        await sendFinal(result, 'error');
        return {};
      }

      // skip：保留进程
      return { skippedReply: reply };
    }
  }

  private async handleAgentResponse(
    agentId: string,
    text: string,
    key?: string,
    opts?: { force?: boolean }
  ): Promise<void> {
    const force = !!opts?.force;
    if (!force) {
      const pending = this.pendingDecisions.get(agentId);
      if (pending) {
        this.pendingDecisions.delete(agentId);
        pending.resolve(text);
        return;
      }
    }

    const operations = [
      ...this.parser.parse(text),
      ...this.callToolParser.parse(text),
    ];
    if (operations.length === 0) {
      if (force) {
        // 强制结束仍交由轮询按三条条件清 idle
        this.setStatus(agentId, 'waiting');
        return;
      }
      const unknownNames = findUnknownCallToolNames(text);
      if (unknownNames.length > 0) {
        const hintKey = `${agentId}:unknown:${unknownNames.join(',')}`;
        if (!this.unknownToolHints.has(hintKey)) {
          this.unknownToolHints.add(hintKey);
          this.setTextDisplayStatus(agentId, text, '失败');
          const hint = buildUnknownToolResult(unknownNames, this.toolPermissions);
          this.chats.push({ agentId, role: 'user', text: hint });
          await this.sendToolResult(agentId, hint);
          this.notify();
        } else {
          this.setStatus(agentId, 'waiting');
        }
        return;
      }

      if (key === '' && hasIncompleteCallTool(text)) {
        const lastAgent = [...this.chats]
          .reverse()
          .find((c) => c.agentId === agentId && c.role === 'agent')?.text;
        const isLast = isIncompleteFromLastConversation(text, lastAgent);
        const loading = await this.bridge.isLoading(agentId);
        this.incompleteConfirm.discover(agentId, text, {
          isLastConversation: isLast,
          isLoading: loading,
          alreadyReported: (hintKey) => this.incompleteHints.has(hintKey),
          markReported: (hintKey) => {
            this.incompleteHints.add(hintKey);
          },
          revalidate: async () => {
            if (await this.bridge.isLoading(agentId)) return false;
            const latest = [...this.chats]
              .reverse()
              .find((c) => c.agentId === agentId && c.role === 'agent')?.text;
            return isIncompleteFromLastConversation(text, latest);
          },
          onConfirm: async () => {
            const limit = this.agents.find((a) => a.id === agentId)?.writeFileLineLimit;
            const hint = buildIncompleteCallToolHint(limit);
            this.setTextDisplayStatus(agentId, text, '失败');
            this.chats.push({ agentId, role: 'user', text: hint });
            await this.sendToolResult(agentId, hint);
            this.notify();
          },
        });
      } else {
        this.incompleteConfirm.onContentChange(agentId, text);
      }
      // 无工具回复：保持 waiting，由轮询按三条条件清 idle
      this.setStatus(agentId, 'waiting');
      return;
    }

    this.incompleteConfirm.onContentChange(agentId, text);

    const opsFp = fileOperationsFingerprint(operations);
    const inflightKey = `${agentId}:${opsFp}`;
    if (!force) {
      if (this.inflightToolOps.has(inflightKey)) return;

      const history = this.chats
        .filter((c) => c.agentId === agentId && (c.role === 'user' || c.role === 'agent'))
        .map((c) => c.text)
        .join('\n');
      const last = this.chats.filter((c) => c.agentId === agentId).at(-1)?.text;
      const transcript = last === text || history.includes(text) ? history : `${history}\n${text}`;
      if (isToolCallAlreadyReported(transcript, operations)) {
        this.setStatus(agentId, 'waiting');
        return;
      }
    }

    if (!force) {
      this.inflightToolOps.add(inflightKey);
    }
    for (const op of operations) {
      this.setOpDisplayStatus(agentId, op, '进行中');
    }
    this.setStatus(agentId, 'waiting');

    const readFileLineLimit = this.agents.find((a) => a.id === agentId)?.readFileLineLimit;
    const workspaceRoot = this.fileService.getWorkspaceRoot().trim();
    if (!workspaceRoot) {
      const noWs = '工作区未打开：请在当前窗口用「文件 → 打开文件夹」打开项目';
      for (const op of operations) {
        const result = { ok: false, message: noWs } satisfies ToolApplyResult;
        this.setOpDisplayStatus(agentId, op, '失败');
        this.addLog(op, 'error', noWs);
        await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
      }
      this.setStatus(agentId, 'waiting');
      return;
    }

    try {
    for (const op of operations) {
      const toolName = resolveToolNameForOperation(op);
      const effective = resolveEffectivePermission(
        toolName,
        op,
        this.fileService.getWorkspaceRoot(),
        this.toolPermissions,
        (p) => this.fileService.resolvePath(p)
      );
      if (effective === 'deny') {
        const denied = buildDeniedToolResult(toolName);
        this.setOpDisplayStatus(agentId, op, '失败');
        this.addLog(op, 'error', '权限禁止');
        await this.sendToolResult(agentId, denied);
        continue;
      }
      if (effective === 'ask') {
        const pick = await vscode.window.showWarningMessage(
          buildPermissionAskMessage(toolName, op),
          { modal: true },
          '允许'
        );
        if (pick !== '允许') {
          this.setOpDisplayStatus(agentId, op, '失败');
          this.addLog(op, 'error', '用户取消');
          this.notify();
          continue;
        }
      }

      if (op.action === 'run_powershell') {
        const { skippedReply } = await this.runPowershellWithProgress(agentId, op);
        if (skippedReply) {
          await this.handleAgentResponse(agentId, skippedReply);
        }
        continue;
      }

      const result = await applyFileOperation(op, {
        fileService: this.fileService,
        workspaceRoot: this.fileService.getWorkspaceRoot(),
        resolvePath: (p) => this.fileService.resolvePath(p),
        addLogEntry: (operation, status, message) => this.addLog(operation, status, message),
        readFileLineLimit,
        findSkill: (name) => findSkillByName(this.skills, name),
        openInEditor: async (filePath, content) => {
          const uri = vscode.Uri.file(this.fileService.resolvePath(filePath));
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
          void content;
        },
      });
      this.setOpDisplayStatus(agentId, op, result.ok ? '成功' : '失败');
      const toolResultMessage = buildToolResultFromOperation(op, result);
      await this.sendToolResult(agentId, toolResultMessage);
    }
  } finally {
      if (!force) {
        this.inflightToolOps.delete(inflightKey);
      }
    }
    this.setStatus(agentId, 'waiting');
  }

  private addLog(op: FileOperation, status: LogStatus, message?: string): void {
    this.logs.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action: op.action,
      path: op.path,
      status,
      message,
      at: Date.now(),
    });
    this.notify();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.autoOpenedLogin.clear();
    this.loginProbeGen.clear();
    this.composerInitPending.clear();
    this.composerInitGen.clear();
    if (this.waitingPollTimer) {
      clearInterval(this.waitingPollTimer);
      this.waitingPollTimer = undefined;
    }
    this.waitingWatch.clear();
    this.incompleteConfirm.clearAll();
    for (const pending of this.pendingDecisions.values()) {
      pending.resolve(null);
    }
    this.pendingDecisions.clear();
    killAllPowershellSessions();
    this.bridge.stopEventLoop();
    this.configWatch?.dispose();
  }
}

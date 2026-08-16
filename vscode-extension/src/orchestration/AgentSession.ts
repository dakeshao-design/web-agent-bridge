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
  fileOperationsFingerprint,
  FileOperationParser,
  findUnknownCallToolNames,
  hasIncompleteCallTool,
  isIncompleteFromLastConversation,
  IncompleteCallToolConfirm,
  isToolCallAlreadyReported,
  mergeToolPermissions,
  buildSelectionMessage,
  parseFileLineLimitsFromBridgeScript,
  POWERSHELL_PROGRESS_INTERVAL_MS,
  parsePowershellWaitDecision,
  resolveEffectivePermission,
  resolveToolNameForOperation,
  listToolsForSettings,
  type AgentConfig,
  type AgentStatus,
  type AppConfig,
  type FileOperation,
  type ToolApplyResult,
  type ToolPermissionMode,
  type ToolPermissionsConfig,
} from '@my-agent-editor/shared';
import type { ConfigService } from '../services/ConfigService';
import type { VscodeFileService } from '../services/VscodeFileService';
import type { AgentHostBridge } from '../services/AgentHostBridge';
import type { AgentHostProcess } from '../services/AgentHostProcess';
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
  key?: number;
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
  private parser = new FileOperationParser('structured');
  private callToolParser = new CallToolParser();
  private inflightToolOps = new Set<string>();
  private incompleteHints = new Set<string>();
  private unknownToolHints = new Set<string>();
  private incompleteConfirm = new IncompleteCallToolConfirm();
  private listeners = new Set<UiListener>();
  private configWatch?: vscode.Disposable;
  private disposed = false;
  /** agentId → 等待进度确认 */
  private pendingDecisions = new Map<string, PendingDecision>();
  private waitingWatch = new Map<
    string,
    {
      sawLoading: boolean;
      consecutiveNotLoading: number;
      lastText: string;
      textStableSince: number;
    }
  >();
  private waitingPollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigService,
    private readonly fileService: VscodeFileService,
    private readonly bridge: AgentHostBridge,
    private readonly host: AgentHostProcess
  ) {}

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

  private setStatus(agentId: string, status: AgentStatus): void {
    if (this.statuses[agentId] === status) return;
    this.statuses[agentId] = status;
    if (status === 'waiting') {
      this.waitingWatch.set(agentId, {
        sawLoading: false,
        consecutiveNotLoading: 0,
        lastText: this.lastAgentText(agentId),
        textStableSince: Date.now(),
      });
    } else {
      this.waitingWatch.delete(agentId);
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
    for (const [agentId, status] of Object.entries(this.statuses)) {
      if (status !== 'waiting') continue;

      const loading = await this.bridge.isLoading(agentId);
      let watch = this.waitingWatch.get(agentId);
      if (!watch) {
        watch = {
          sawLoading: false,
          consecutiveNotLoading: 0,
          lastText: this.lastAgentText(agentId),
          textStableSince: Date.now(),
        };
        this.waitingWatch.set(agentId, watch);
      }

      const text = this.lastAgentText(agentId);
      if (text !== watch.lastText) {
        watch.lastText = text;
        watch.textStableSince = Date.now();
      }

      if (loading) {
        watch.sawLoading = true;
        watch.consecutiveNotLoading = 0;
        watch.textStableSince = Date.now();
        continue;
      }

      if (watch.sawLoading) {
        watch.consecutiveNotLoading += 1;
        if (watch.consecutiveNotLoading >= 2) {
          this.setStatus(agentId, 'idle');
          continue;
        }
      }

      const hasInflight = [...this.inflightToolOps].some((k) =>
        k.startsWith(`${agentId}:`)
      );
      const hasPendingPs = this.pendingDecisions.has(agentId);
      if (
        !hasInflight &&
        !hasPendingPs &&
        Date.now() - watch.textStableSince >= 3000
      ) {
        this.setStatus(agentId, 'idle');
      }
    }
  }

  getSnapshot() {
    return {
      agents: this.agents,
      activeAgentId: this.activeAgentId,
      statuses: { ...this.statuses },
      chats: this.chats.slice(-200),
      logs: this.logs.slice(-100),
      agentModeEnabled: this.agentModeEnabled,
      hostReady: this.host.isStarted(),
      toolPermissions: { ...this.toolPermissions },
      toolsForSettings: listToolsForSettings(),
    };
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
      this.chats.push({ agentId, role, key, text });
      if (role === 'agent') {
        this.setStatus(agentId, 'idle');
      }
    });
    this.bridge.startEventLoop();
    this.startWaitingPoll();

    await this.reloadAgents();
    this.configWatch = this.configService.watchConfig(() => {
      void this.reloadAgents();
    });
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

    if (this.host.isStarted()) {
      await this.ensureWebviews();
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

    for (const agent of this.agents) {
      if (this.bridge.hasAgent(agent.id)) continue;
      try {
        const siteScript = await this.configService.readBridgeScript(agent.injectScript);
        await this.bridge.createAgent(agent, siteScript, template, true);
        this.statuses[agent.id] = 'idle';
      } catch (err) {
        this.statuses[agent.id] = 'error';
        this.chats.push({
          agentId: agent.id,
          role: 'system',
          text: `创建 Agent 失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    this.notify();
  }

  setActiveAgent(id: string): void {
    this.activeAgentId = id;
    this.notify();
  }

  async sendChat(text: string): Promise<void> {
    const agentId = this.activeAgentId;
    if (!agentId || !text.trim()) return;
    await this.ensureHostAndAgents();
    this.chats.push({ agentId, role: 'user', text });
    this.setStatus(agentId, 'sending');
    await this.bridge.sendMessage(agentId, text);
    this.setStatus(agentId, 'waiting');
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

  async sendAgentMode(): Promise<void> {
    const root = this.fileService.getWorkspaceRoot();
    const agent = this.agents.find((a) => a.id === this.activeAgentId);
    const msg = buildAgentModePrompt(
      root || undefined,
      agent?.readFileLineLimit,
      this.toolPermissions,
      agent?.writeFileLineLimit
    );
    this.agentModeEnabled = true;
    await this.sendChat(msg);
  }

  async showLogin(): Promise<void> {
    const agentId = this.activeAgentId;
    if (!agentId) {
      void vscode.window.showWarningMessage('请先选择 Agent');
      return;
    }
    try {
      await this.ensureHostAndAgents();
      try {
        await this.bridge.showForLogin(agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found/i.test(msg)) throw err;
        // 用户手动关闭后窗口已销毁，重建再打开
        this.bridge.forgetAgent(agentId);
        await this.ensureWebviews();
        await this.bridge.showForLogin(agentId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`打开登录窗失败: ${msg}`);
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
    await this.host.ensureStarted();
    await this.ensureWebviews();
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
      this.addLog(op, 'error', result.message);
      await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
      return {};
    }
    if (!cwd) {
      const result = {
        ok: false,
        message: '工作区未打开：请在当前窗口用「文件 → 打开文件夹」打开项目',
      } satisfies ToolApplyResult;
      this.addLog(op, 'error', result.message);
      await this.sendToolResult(agentId, buildToolResultFromOperation(op, result));
      return {};
    }

    const session: PowershellSession = startPowershellSession(command, cwd);
    const t0 = Date.now();
    let reported = 0;
    let sentFinal = false;

    const sendFinal = async (result: ToolApplyResult, status: LogStatus) => {
      if (sentFinal) return;
      sentFinal = true;
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
    key?: number
  ): Promise<void> {
    const pending = this.pendingDecisions.get(agentId);
    if (pending) {
      this.pendingDecisions.delete(agentId);
      pending.resolve(text);
      return;
    }

    const operations = [
      ...this.parser.parse(text),
      ...this.callToolParser.parse(text),
    ];
    if (operations.length === 0) {
      const unknownNames = findUnknownCallToolNames(text);
      if (unknownNames.length > 0) {
        const hintKey = `${agentId}:unknown:${unknownNames.join(',')}`;
        if (!this.unknownToolHints.has(hintKey)) {
          this.unknownToolHints.add(hintKey);
          const hint = buildUnknownToolResult(unknownNames, this.toolPermissions);
          this.chats.push({ agentId, role: 'user', text: hint });
          await this.sendToolResult(agentId, hint);
          this.notify();
        } else {
          this.setStatus(agentId, 'idle');
        }
        return;
      }

      if (key === -1 && hasIncompleteCallTool(text)) {
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
            this.chats.push({ agentId, role: 'user', text: hint });
            await this.sendToolResult(agentId, hint);
            this.notify();
          },
        });
      } else {
        this.incompleteConfirm.onContentChange(agentId, text);
      }
      this.setStatus(agentId, 'idle');
      return;
    }

    this.incompleteConfirm.onContentChange(agentId, text);

    const opsFp = fileOperationsFingerprint(operations);
    const inflightKey = `${agentId}:${opsFp}`;
    if (this.inflightToolOps.has(inflightKey)) return;

    const history = this.chats
      .filter((c) => c.agentId === agentId && (c.role === 'user' || c.role === 'agent'))
      .map((c) => c.text)
      .join('\n');
    const last = this.chats.filter((c) => c.agentId === agentId).at(-1)?.text;
    const transcript = last === text || history.includes(text) ? history : `${history}\n${text}`;
    if (isToolCallAlreadyReported(transcript, operations)) {
      this.setStatus(agentId, 'idle');
      return;
    }

    this.inflightToolOps.add(inflightKey);
    this.setStatus(agentId, 'waiting');
    let awaitAgentReply = false;

    const readFileLineLimit = this.agents.find((a) => a.id === agentId)?.readFileLineLimit;

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
        this.addLog(op, 'error', '权限禁止');
        await this.sendToolResult(agentId, denied);
        awaitAgentReply = true;
        continue;
      }
      if (effective === 'ask') {
        const pick = await vscode.window.showWarningMessage(
          buildPermissionAskMessage(toolName, op),
          { modal: true },
          '允许'
        );
        if (pick !== '允许') {
          this.addLog(op, 'error', '用户取消');
          continue;
        }
      }

      if (op.action === 'run_powershell') {
        const { skippedReply } = await this.runPowershellWithProgress(agentId, op);
        awaitAgentReply = true;
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
        openInEditor: async (filePath, content) => {
          const uri = vscode.Uri.file(this.fileService.resolvePath(filePath));
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
          void content;
        },
      });
      const toolResultMessage = buildToolResultFromOperation(op, result);
      await this.sendToolResult(agentId, toolResultMessage);
      awaitAgentReply = true;
    }
    } finally {
      this.inflightToolOps.delete(inflightKey);
    }
    this.setStatus(agentId, awaitAgentReply ? 'waiting' : 'idle');
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

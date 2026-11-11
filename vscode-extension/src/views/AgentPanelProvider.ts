import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PLAN_TEMPLATE_HOME_PATH,
  buildPlanCreationPrompt,
  createPlanTimestamp,
} from '@my-agent-editor/shared';
import type { AgentSession } from '../orchestration/AgentSession';
import type { VscodeFileService } from '../services/VscodeFileService';

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'webAgentBridge.panel';
  private view?: vscode.WebviewView;
  private uiSub?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: AgentSession,
    private readonly fileService: VscodeFileService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    // 视图可见时才自动初始化 Agent 站点
    this.session.setPanelVisible(webviewView.visible);
    webviewView.onDidChangeVisibility(() => {
      this.session.setPanelVisible(webviewView.visible);
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready':
          this.postSnapshot();
          break;
        case 'selectAgent':
          this.session.setActiveAgent(String(msg.agentId || ''));
          break;
        case 'send':
          await this.session.sendChat(String(msg.text || ''));
          break;
        case 'stop':
          await this.session.stopAgent(this.session.getSnapshot().activeAgentId);
          break;
        case 'createPlan': {
          const description = String(msg.description || '').trim();
          const snapshot = this.session.getSnapshot();
          const agentId = snapshot.activeAgentId;
          const workspaceRoot = this.fileService.getWorkspaceRoot();
          try {
            if (!description) throw new Error('请输入计划内容。');
            if (!workspaceRoot) throw new Error('请先打开工作区。');
            if (!agentId) throw new Error('请先选择一个 Agent。');
            const status = snapshot.statuses[agentId];
            if (status === 'sending' || status === 'waiting') {
              throw new Error('当前 Agent 正在处理消息，请稍后再试。');
            }
            const template = await fs.readFile(
              path.join(os.homedir(), PLAN_TEMPLATE_HOME_PATH),
              'utf8'
            );
            if (!template.trim()) throw new Error('计划模板为空。');
            const prompt = buildPlanCreationPrompt({
              description,
              template,
              workspaceRoot,
              timestamp: createPlanTimestamp(),
            });
            await this.session.sendChat(prompt, agentId);
            this.view?.webview.postMessage({ type: 'planCreated' });
          } catch (err) {
            this.view?.webview.postMessage({
              type: 'planError',
              message: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case 'agentMode':
          await this.session.sendAgentMode();
          break;
        case 'getAgentModePrompt': {
          const body = await this.session.getAgentModePromptText();
          this.view?.webview.postMessage({
            type: 'debugDialog',
            kind: 'agentMode',
            title: 'Agent mode promet',
            body,
          });
          break;
        }
        case 'sendAgentModePrompt':
          await this.session.sendAgentMode();
          break;
        case 'getLastCallTool': {
          const body = this.session.getLastCallToolBlocks();
          this.view?.webview.postMessage({
            type: 'debugDialog',
            kind: 'lastCallTool',
            title: 'Last call-tool',
            body: body || '(无 call-tool)',
          });
          break;
        }
        case 'executeLastCallTool':
          await this.session.executeLastCallToolForce();
          break;
        case 'newChatSession':
          await this.session.newChatSession();
          break;
        case 'showLogin':
          await this.session.showLogin();
          break;
        case 'killTerminal':
          await this.session.killAllPowershell();
          break;
        case 'reload':
          await this.session.reloadAgents();
          break;
        case 'setToolPermission':
          this.session.setToolPermissionDraft(
            String(msg.toolName || ''),
            msg.mode as 'allow' | 'ask' | 'deny'
          );
          break;
        case 'saveToolPermissions':
          await this.session.saveToolPermissions(
            (msg.permissions || {}) as Record<string, 'allow' | 'ask' | 'deny'>
          );
          void vscode.window.showInformationMessage('工具权限已保存，将在新会话中应用');
          break;
      }
    });

    this.uiSub?.dispose();
    this.uiSub = vscode.Disposable.from(
      this.session.onUiChange(() => this.postSnapshot()),
      this.session.onComposerFill((text) => {
        this.view?.show?.(true);
        this.view?.webview.postMessage({ type: 'fillComposer', text });
      })
    );
    this.postSnapshot();
  }

  private postSnapshot(): void {
    if (!this.view) return;
    this.view.webview.postMessage({
      type: 'snapshot',
      data: {
        ...this.session.getSnapshot(),
        workspaceRoot: this.fileService.getWorkspaceRoot(),
      },
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'agentPanel.css'));
    const markedJs = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'marked.umd.js'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'agentPanel.js'));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>WAB</title>
</head>
<body>
  <div id="app">
    <div class="agent-tabs-bar">
      <div id="tabs" class="tabs" role="tablist"></div>
    </div>
    <div id="hostStatus" class="host-status"></div>
    <div id="chat" class="chat"></div>
    <div class="composer">
      <textarea id="input" rows="3" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
      <div class="composer-actions" id="composerActions">
        <div class="composer-actions-items" id="composerActionsItems">
          <button data-cmd="newChatSession" title="开启新会话" data-toolbar-item>新会话</button>
          <button type="button" id="planBtn" disabled data-toolbar-item>计划</button>
          <button data-cmd="reload" title="重新加载" data-toolbar-item>刷新</button>
          <button data-cmd="showLogin" title="打开登录窗" data-toolbar-item>登录</button>
          <button type="button" id="configBtn" title="工具权限" data-toolbar-item>配置</button>
          <div class="debug-tools-wrap" data-toolbar-item>
            <button type="button" id="debugToolsBtn" title="调试工具">调试工具</button>
            <div id="debugMenu" class="debug-menu hidden" role="menu">
              <button type="button" data-debug="agentModePrompt" role="menuitem">Agent mode promet</button>
              <button type="button" data-debug="lastCallTool" role="menuitem">Last call-tool</button>
              <button type="button" data-debug="stopTerminal" role="menuitem">Stop Terminal</button>
            </div>
          </div>
        </div>
        <div class="composer-actions-end">
          <div class="more-wrap">
            <button type="button" id="moreBtn" class="more-btn hidden" title="更多" aria-haspopup="menu" aria-expanded="false">...</button>
            <div id="moreMenu" class="more-menu hidden" role="menu"></div>
          </div>
          <button id="sendBtn" class="primary" disabled>发送</button>
        </div>
      </div>
    </div>
    <div id="logs" class="logs"></div>
  </div>
  <div id="debugOverlay" class="debug-overlay hidden" role="dialog" aria-modal="true">
    <div class="debug-dialog">
      <div class="debug-dialog-header">
        <h2 id="debugDialogTitle"></h2>
        <button type="button" id="debugDialogCloseX" aria-label="关闭">×</button>
      </div>
      <pre id="debugDialogBody" class="debug-dialog-body"></pre>
      <div class="debug-dialog-footer">
        <button type="button" id="debugDialogClose">Close</button>
        <button type="button" id="debugDialogPrimary" class="primary">Send</button>
      </div>
    </div>
  </div>
  <div id="configOverlay" class="debug-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="configDialogTitle">
    <div class="debug-dialog config-dialog">
      <div class="debug-dialog-header">
        <h2 id="configDialogTitle">工具权限</h2>
        <button type="button" id="configDialogCloseX" aria-label="关闭">×</button>
      </div>
      <div id="configDialogBody" class="config-dialog-body"></div>
      <div class="debug-dialog-footer">
        <button type="button" id="configDialogClose">关闭</button>
        <button type="button" id="configSaveBtn" class="primary">保存权限</button>
      </div>
    </div>
  </div>
  <div id="planOverlay" class="plan-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="planDialogTitle">
    <div class="plan-dialog">
      <div class="plan-dialog-header">
        <h2 id="planDialogTitle">创建计划</h2>
        <button type="button" id="planDialogCloseX" aria-label="关闭">×</button>
      </div>
      <label for="planContent">计划内容</label>
      <textarea id="planContent" rows="8" placeholder="描述你希望 Agent 制定的计划"></textarea>
      <div id="planError" class="plan-error" role="alert"></div>
      <div class="plan-dialog-footer">
        <button type="button" id="planDialogClose">关闭</button>
        <button type="button" id="planCreateBtn" class="primary" disabled>创建计划</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${markedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

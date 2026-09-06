import * as vscode from 'vscode';
import type { AgentSession } from '../orchestration/AgentSession';

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'webAgentBridge.panel';
  private view?: vscode.WebviewView;
  private uiSub?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: AgentSession
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
        case 'sendCurrentFile':
          await this.session.sendCurrentFile();
          break;
        case 'sendSelection':
          await this.session.sendSelection();
          break;
        case 'agentMode':
          await this.session.sendAgentMode();
          break;
        case 'getAgentModePrompt':
          this.view?.webview.postMessage({
            type: 'debugDialog',
            kind: 'agentMode',
            title: 'Agent mode promet',
            body: this.session.getAgentModePromptText(),
          });
          break;
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
        case 'openConfig':
          await vscode.commands.executeCommand('webAgentBridge.openAgentsConfig');
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
          void vscode.window.showInformationMessage('工具权限已保存');
          break;
        case 'showPermissions':
          this.view?.webview.postMessage({ type: 'togglePermissions', show: true });
          break;
      }
    });

    this.uiSub?.dispose();
    this.uiSub = this.session.onUiChange(() => this.postSnapshot());
    this.postSnapshot();
  }

  private postSnapshot(): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'snapshot', data: this.session.getSnapshot() });
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
    <div class="toolbar">
      <div id="tabs" class="tabs"></div>
      <div class="toolbar-actions">
        <button data-cmd="showLogin" title="打开登录窗">登录</button>
        <button data-cmd="openConfig" title="打开桥接脚本目录">配置</button>
        <button data-cmd="showPermissions" title="工具权限">权限</button>
        <button data-cmd="reload" title="重新加载">刷新</button>
      </div>
    </div>
    <div id="hostStatus" class="host-status"></div>
    <div id="permissions" class="permissions hidden"></div>
    <div id="chat" class="chat"></div>
    <div class="composer">
      <textarea id="input" rows="3" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
      <div class="composer-actions">
        <button data-cmd="sendCurrentFile">当前文件</button>
        <button data-cmd="sendSelection">选区</button>
        <button data-cmd="newChatSession" title="开启新会话并注入 Agent 模式提示词">新会话</button>
        <div class="debug-tools-wrap">
          <button type="button" id="debugToolsBtn" title="调试工具">调试工具</button>
          <div id="debugMenu" class="debug-menu hidden" role="menu">
            <button type="button" data-debug="agentModePrompt" role="menuitem">Agent mode promet</button>
            <button type="button" data-debug="lastCallTool" role="menuitem">Last call-tool</button>
            <button type="button" data-debug="stopTerminal" role="menuitem">Stop Terminal</button>
          </div>
        </div>
        <button id="sendBtn" class="primary">发送</button>
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
  <script nonce="${nonce}" src="${markedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

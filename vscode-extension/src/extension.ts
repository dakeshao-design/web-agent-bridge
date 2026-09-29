import * as vscode from 'vscode';
import { AgentPanelProvider } from './views/AgentPanelProvider';
import { ConfigService } from './services/ConfigService';
import { AgentHostProcess } from './services/AgentHostProcess';
import { AgentHostBridge } from './services/AgentHostBridge';
import { VscodeFileService } from './services/VscodeFileService';
import { AgentSession } from './orchestration/AgentSession';

let session: AgentSession | undefined;
let hostProcess: AgentHostProcess | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const configService = new ConfigService(context);
  await configService.ensureUserConfig();

  const fileService = new VscodeFileService();
  hostProcess = new AgentHostProcess(context);
  const bridge = new AgentHostBridge(hostProcess);

  // Host / Agent 站点仅在有工作区且 WAB 视图可见时由 session 延迟启动
  session = new AgentSession(context, configService, fileService, bridge, hostProcess);
  await session.init();

  const provider = new AgentPanelProvider(context.extensionUri, session);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AgentPanelProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const register = (command: string, fn: (...args: never[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, fn));
  };

  register('webAgentBridge.openAgentsConfig', () => configService.openAgentsConfig());
  register('webAgentBridge.openAppConfig', () => configService.openAppConfig());
  register('webAgentBridge.openConfigFolder', () => configService.openConfigFolder());
  register('webAgentBridge.resetConfig', () => configService.resetConfigWithConfirm());
  register('webAgentBridge.sendCurrentFile', () => session?.sendCurrentFile());
  register('webAgentBridge.sendSelection', () => session?.sendSelection());
  register('webAgentBridge.sendAgentMode', () => session?.sendAgentMode());
  register('webAgentBridge.newChatSession', () => session?.newChatSession());
  register('webAgentBridge.showLogin', () => session?.showLogin());
  register('webAgentBridge.reloadAgents', () => session?.reloadAgents());

  context.subscriptions.push({
    dispose: () => {
      session?.dispose();
      hostProcess?.dispose();
    },
  });
}

export function deactivate(): void {
  session?.dispose();
  hostProcess?.dispose();
  session = undefined;
  hostProcess = undefined;
}

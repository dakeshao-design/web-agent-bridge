import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentConfig, AgentStatus, IAgentBridge } from '@my-agent-editor/shared';

type ChatRole = 'user' | 'agent';

type ResponseHandler = (agentId: string, text: string, key?: number) => void | Promise<void>;
type ChatMessageHandler = (
  agentId: string,
  role: ChatRole,
  key: number,
  text: string
) => void | Promise<void>;

type BridgeCommHandler = (
  agentId: string,
  direction: 'request' | 'response' | 'copy',
  content: string
) => void | Promise<void>;

export class WebViewAgentBridge implements IAgentBridge {
  private statuses = new Map<string, AgentStatus>();
  private responseCallbackRef: { current?: ResponseHandler } = {};
  private chatMessageCallbackRef: { current?: ChatMessageHandler } = {};
  private bridgeCommCallbackRef: { current?: BridgeCommHandler } = {};
  private unlistenChat?: UnlistenFn;
  private unlistenBridgeComm?: UnlistenFn;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.initListener();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async initListener(): Promise<void> {
    this.unlistenChat = await listen<{
      agentId?: string;
      role?: ChatRole;
      key?: number;
      text: string;
    }>('agent-chat-message', (event) => {
      const agentId = event.payload.agentId || 'unknown';
      const role = event.payload.role || 'agent';
      const key = event.payload.key ?? -1;
      const text = event.payload.text || '';

      if (role === 'agent') {
        this.statuses.set(agentId, 'idle');
      }

      void (async () => {
        const chatHandler = this.chatMessageCallbackRef.current;
        if (chatHandler) {
          try {
            await Promise.resolve(chatHandler(agentId, role, key, text));
          } catch (err) {
            console.error('[agent-bridge] chat handler failed', err);
          }
        }

        if (role === 'agent') {
          const responseHandler = this.responseCallbackRef.current;
          if (responseHandler) {
            try {
              await Promise.resolve(responseHandler(agentId, text, key));
            } catch (err) {
              console.error('[agent-bridge] response handler failed', err);
            }
          }
        }
      })();
    });

    this.unlistenBridgeComm = await listen<{
      agentId?: string;
      direction?: 'request' | 'response' | 'copy';
      content?: string;
    }>('bridge-comm-log', (event) => {
      const agentId = event.payload.agentId || 'unknown';
      const direction = event.payload.direction;
      const content = event.payload.content || '';
      if (!direction || !content) return;

      const handler = this.bridgeCommCallbackRef.current;
      if (handler) {
        Promise.resolve(handler(agentId, direction, content)).catch((err) => {
          console.error('[agent-bridge] bridge comm handler failed', err);
        });
      }
    });
  }

  async createWebview(
    agent: AgentConfig,
    bounds: { x: number; y: number; width: number; height: number },
    bridgeScript: string,
    templateScript: string
  ): Promise<void> {
    const bridgeConfig: Record<string, unknown> = {};
    if (agent.selectors && Object.keys(agent.selectors).length > 0) {
      bridgeConfig.selectors = agent.selectors;
    }
    if (agent.inputMode) {
      bridgeConfig.inputMode = agent.inputMode;
    }
    if (agent.typeDelayMs != null) {
      bridgeConfig.typeDelayMs = agent.typeDelayMs;
    }
    if (agent.typeStrategy) {
      bridgeConfig.typeStrategy = agent.typeStrategy;
    }

    await invoke('create_agent_webview', {
      label: `agent-${agent.id}`,
      url: agent.url,
      agentId: agent.id,
      bounds,
      bridgeScript,
      templateScript,
      bridgeConfig,
    });
    this.statuses.set(agent.id, 'idle');
  }

  async showWebview(agentId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    await invoke('show_agent_webview', {
      label: `agent-${agentId}`,
      bounds,
    });
  }

  async hideWebview(agentId: string): Promise<void> {
    await invoke('hide_agent_webview', { label: `agent-${agentId}` });
  }

  async sendMessage(agentId: string, text: string): Promise<void> {
    this.statuses.set(agentId, 'sending');
    try {
      await invoke('send_agent_message', {
        label: `agent-${agentId}`,
        agentId,
        text,
      });
      this.statuses.set(agentId, 'waiting');
    } catch {
      this.statuses.set(agentId, 'error');
      throw new Error(`Failed to send message to agent: ${agentId}`);
    }
  }

  async fillMessage(agentId: string, text: string): Promise<void> {
    await invoke('fill_agent_message', {
      label: `agent-${agentId}`,
      agentId,
      text,
    });
  }

  async isLoading(agentId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('agent_bridge_is_loading', { agentId });
    } catch {
      return false;
    }
  }

  onResponse(callback: ResponseHandler): void {
    this.responseCallbackRef.current = callback;
  }

  onChatMessage(callback: ChatMessageHandler): void {
    this.chatMessageCallbackRef.current = callback;
  }

  onBridgeComm(callback: BridgeCommHandler): void {
    this.bridgeCommCallbackRef.current = callback;
  }

  getStatus(agentId: string): AgentStatus {
    return this.statuses.get(agentId) || 'idle';
  }

  destroy(): void {
    this.unlistenChat?.();
    this.unlistenChat = undefined;
    this.unlistenBridgeComm?.();
    this.unlistenBridgeComm = undefined;
    this.responseCallbackRef.current = undefined;
    this.chatMessageCallbackRef.current = undefined;
    this.bridgeCommCallbackRef.current = undefined;
  }
}

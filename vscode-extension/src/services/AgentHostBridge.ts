import type { AgentConfig, AgentStatus, IAgentBridge } from '@my-agent-editor/shared';
import type { AgentHostProcess } from './AgentHostProcess';

type ResponseHandler = (agentId: string, text: string, key?: number) => void | Promise<void>;
type ChatHandler = (
  agentId: string,
  role: 'user' | 'agent',
  key: number,
  text: string
) => void | Promise<void>;
type BridgeCommHandler = (
  agentId: string,
  direction: 'request' | 'response' | 'copy',
  content: string
) => void | Promise<void>;

export class AgentHostBridge implements IAgentBridge {
  private statuses = new Map<string, AgentStatus>();
  private responseHandler?: ResponseHandler;
  private chatHandler?: ChatHandler;
  private bridgeCommHandler?: BridgeCommHandler;
  private eventCursor = 0;
  private polling = false;
  private stopPoll = false;
  private created = new Set<string>();

  constructor(private readonly host: AgentHostProcess) {}

  startEventLoop(): void {
    if (this.polling) return;
    this.polling = true;
    this.stopPoll = false;
    void this.loop();
  }

  stopEventLoop(): void {
    this.stopPoll = true;
    this.polling = false;
  }

  private async loop(): Promise<void> {
    while (!this.stopPoll) {
      try {
        if (!this.host.isStarted()) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const { seq, events } = await this.host.pollEvents(this.eventCursor);
        this.eventCursor = seq;
        for (const ev of events) {
          await this.dispatch(ev);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async dispatch(ev: Record<string, unknown>): Promise<void> {
    const type = String(ev.type || '');
    if (type === 'chat') {
      const agentId = String(ev.agentId || 'unknown');
      const role = (ev.role === 'user' ? 'user' : 'agent') as 'user' | 'agent';
      const key = Number(ev.key ?? -1);
      const text = String(ev.text || '');
      if (role === 'agent') this.statuses.set(agentId, 'idle');
      if (this.chatHandler) await this.chatHandler(agentId, role, key, text);
      if (role === 'agent' && text && this.responseHandler) {
        await this.responseHandler(agentId, text, key);
      }
      return;
    }
    if (type === 'bridgeComm') {
      const direction = ev.direction as 'request' | 'response' | 'copy';
      if (!direction) return;
      if (this.bridgeCommHandler) {
        await this.bridgeCommHandler(
          String(ev.agentId || 'unknown'),
          direction,
          String(ev.content || '')
        );
      }
      return;
    }
    if (type === 'agentClosed') {
      const agentId = String(ev.agentId || '');
      if (agentId) this.created.delete(agentId);
    }
  }

  async createAgent(
    agent: AgentConfig,
    bridgeScript: string,
    templateScript: string,
    hidden = true
  ): Promise<void> {
    const bridgeConfig: Record<string, unknown> = {};
    if (agent.selectors && Object.keys(agent.selectors).length > 0) {
      bridgeConfig.selectors = agent.selectors;
    }
    if (agent.inputMode) bridgeConfig.inputMode = agent.inputMode;
    if (agent.typeDelayMs != null) bridgeConfig.typeDelayMs = agent.typeDelayMs;
    if (agent.typeStrategy) bridgeConfig.typeStrategy = agent.typeStrategy;
    if (agent.readToolViaCopy != null) bridgeConfig.readToolViaCopy = agent.readToolViaCopy;

    await this.host.request('POST', '/agents/create', {
      agentId: agent.id,
      url: agent.url,
      bridgeScript,
      templateScript,
      bridgeConfig,
      hidden,
      bounds: { x: 0, y: 0, width: 960, height: 720 },
    });
    this.created.add(agent.id);
    this.statuses.set(agent.id, 'idle');
  }

  async showForLogin(agentId: string): Promise<void> {
    await this.host.request('POST', '/agents/show', {
      agentId,
      bounds: { x: 40, y: 40, width: 1000, height: 750 },
    });
  }

  async hide(agentId: string): Promise<void> {
    await this.host.request('POST', '/agents/hide', { agentId });
  }

  async sendMessage(agentId: string, text: string): Promise<void> {
    this.statuses.set(agentId, 'sending');
    try {
      await this.host.request('POST', '/agents/send', { agentId, text });
      this.statuses.set(agentId, 'waiting');
    } catch {
      this.statuses.set(agentId, 'error');
      throw new Error(`Failed to send message to agent: ${agentId}`);
    }
  }

  async fillMessage(agentId: string, text: string): Promise<void> {
    await this.host.request('POST', '/agents/fill', { agentId, text });
  }

  async isLoading(agentId: string): Promise<boolean> {
    try {
      const res = (await this.host.request('GET', `/agents/loading?agentId=${encodeURIComponent(agentId)}`)) as {
        loading?: boolean;
      };
      return !!res.loading;
    } catch {
      return false;
    }
  }

  onResponse(callback: ResponseHandler): void {
    this.responseHandler = callback;
  }

  onChatMessage(callback: ChatHandler): void {
    this.chatHandler = callback;
  }

  onBridgeComm(callback: BridgeCommHandler): void {
    this.bridgeCommHandler = callback;
  }

  getStatus(agentId: string): AgentStatus {
    return this.statuses.get(agentId) || 'idle';
  }

  hasAgent(agentId: string): boolean {
    return this.created.has(agentId);
  }

  forgetAgent(agentId: string): void {
    this.created.delete(agentId);
  }

  clearCreated(): void {
    this.created.clear();
  }
}

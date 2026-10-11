import type { AgentConfig, AgentStatus, IAgentBridge } from '@my-agent-editor/shared';
import { normalizeChatKey } from '@my-agent-editor/shared';
import type { AgentHostProcess } from './AgentHostProcess';

type ResponseHandler = (agentId: string, text: string, key?: string) => void | Promise<void>;
type ChatHandler = (
  agentId: string,
  role: 'user' | 'agent',
  key: string,
  text: string
) => void | Promise<void>;
type BridgeCommHandler = (
  agentId: string,
  direction: 'request' | 'response' | 'copy',
  content: string
) => void | Promise<void>;

type NewChatOnloadHandler = (agentId: string) => void | Promise<void>;
type AgentClosedHandler = (agentId: string) => void | Promise<void>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function consumeEventBatch(
  events: Array<Record<string, unknown>>,
  cursor: number,
  dispatch: (event: Record<string, unknown>) => Promise<void>,
  onFailure: (event: Record<string, unknown>, error: unknown) => void
): Promise<{
  cursor: number;
  processed: number;
  failedEvent?: Record<string, unknown>;
}> {
  let nextCursor = cursor;
  let processed = 0;
  for (const event of events) {
    const seq = Number(event.seq);
    if (!Number.isSafeInteger(seq) || seq <= nextCursor) {
      onFailure(event, new Error(`Invalid event seq: ${String(event.seq)}`));
      return { cursor: nextCursor, processed, failedEvent: event };
    }
    try {
      await dispatch(event);
    } catch (error) {
      onFailure(event, error);
      return { cursor: nextCursor, processed, failedEvent: event };
    }
    nextCursor = seq;
    processed++;
  }
  return { cursor: nextCursor, processed };
}

export class AgentHostBridge implements IAgentBridge {
  private statuses = new Map<string, AgentStatus>();
  private responseHandler?: ResponseHandler;
  private chatHandler?: ChatHandler;
  private bridgeCommHandler?: BridgeCommHandler;
  private newChatOnloadHandler?: NewChatOnloadHandler;
  private agentClosedHandler?: AgentClosedHandler;
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
        const after = this.eventCursor;
        const { seq, events } = await this.host.pollEvents(after);
        console.debug(
          `[wab-events] poll after=${after} through=${seq} count=${events.length}`
        );
        const result = await consumeEventBatch(
          events,
          this.eventCursor,
          async (event) => {
            const context = this.eventContext(event);
            console.debug(`[wab-events] event start ${context}`);
            await this.dispatch(event);
            console.debug(`[wab-events] event complete ${context}`);
          },
          (event, error) => {
            console.error(
              `[wab-events] event failed ${this.eventContext(event)}; retaining cursor for retry: ${errorMessage(error)}`
            );
          }
        );
        this.eventCursor = result.cursor;
        if (result.failedEvent) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (error) {
        console.error(
          `[wab-events] poll failed after=${this.eventCursor}: ${errorMessage(error)}`
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private eventContext(ev: Record<string, unknown>): string {
    return `seq=${String(ev.seq ?? '?')} type=${String(ev.type || '')} agent=${String(ev.agentId || 'unknown')} key=${normalizeChatKey(ev.key)}`;
  }

  private async dispatch(ev: Record<string, unknown>): Promise<void> {
    const type = String(ev.type || '');
    if (type === 'chat') {
      const agentId = String(ev.agentId || 'unknown');
      const role = (ev.role === 'user' ? 'user' : 'agent') as 'user' | 'agent';
      const key = normalizeChatKey(ev.key);
      const text = String(ev.text || '');
      const isToolResponse = role === 'agent' && text !== '' && key === '';
      if (this.chatHandler) {
        console.debug(`[wab-events] callback start chatHandler ${this.eventContext(ev)}`);
        try {
          await this.chatHandler(agentId, role, key, text);
          console.debug(`[wab-events] callback complete chatHandler ${this.eventContext(ev)}`);
        } catch (error) {
          console.error(
            `[wab-events] callback failed chatHandler ${this.eventContext(ev)}: ${errorMessage(error)}`
          );
          if (!isToolResponse) throw error;
        }
      }
      // 仅空 key 的 Host 工具响应路径触发工具；普通会话 key 只更新对话
      if (isToolResponse) {
        if (!this.responseHandler) {
          throw new Error(`Response handler is not registered for agent ${agentId}`);
        }
        console.debug(`[wab-events] callback start responseHandler ${this.eventContext(ev)}`);
        try {
          await this.responseHandler(agentId, text, key);
          console.debug(`[wab-events] callback complete responseHandler ${this.eventContext(ev)}`);
        } catch (error) {
          console.error(
            `[wab-events] callback failed responseHandler ${this.eventContext(ev)}: ${errorMessage(error)}`
          );
          throw error;
        }
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
    if (type === 'newChatOnloadAgentMode') {
      const agentId = String(ev.agentId || '');
      if (agentId && this.newChatOnloadHandler) {
        await this.newChatOnloadHandler(agentId);
      }
      return;
    }
    if (type === 'agentClosed') {
      const agentId = String(ev.agentId || '');
      if (agentId) {
        this.created.delete(agentId);
        if (this.agentClosedHandler) await this.agentClosedHandler(agentId);
      }
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
    if (agent.waitBeforeSend != null) bridgeConfig.waitBeforeSend = agent.waitBeforeSend;
    if (agent.newChatOnload != null) bridgeConfig.newChatOnload = agent.newChatOnload;
    if (agent.readFileLineLimit != null) bridgeConfig.readFileLineLimit = agent.readFileLineLimit;
    if (agent.writeFileLineLimit != null) bridgeConfig.writeFileLineLimit = agent.writeFileLineLimit;

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

  async newChatSession(agentId: string): Promise<void> {
    await this.host.request('POST', '/agents/new-chat', { agentId });
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

  async getPollSnapshot(agentId: string): Promise<{
    loading: boolean;
    lastUser: { index: string; text: string } | null;
    lastAgent: { index: string; text: string } | null;
    preUser: { index: string; text: string } | null;
    preAgent: { index: string; text: string } | null;
  }> {
    try {
      const res = (await this.host.request(
        'GET',
        `/agents/poll-snapshot?agentId=${encodeURIComponent(agentId)}`
      )) as {
        loading?: boolean;
        lastUser?: { index?: string | number; text?: string } | null;
        lastAgent?: { index?: string | number; text?: string } | null;
        preUser?: { index?: string | number; text?: string } | null;
        preAgent?: { index?: string | number; text?: string } | null;
      };
      const toTurn = (v: { index?: string | number; text?: string } | null | undefined) => {
        if (!v || typeof v.text !== 'string') return null;
        const index = v.index == null || v.index === '' ? '' : String(v.index);
        return { index, text: v.text };
      };
      return {
        loading: !!res.loading,
        lastUser: toTurn(res.lastUser),
        lastAgent: toTurn(res.lastAgent),
        preUser: toTurn(res.preUser),
        preAgent: toTurn(res.preAgent),
      };
    } catch {
      return { loading: false, lastUser: null, lastAgent: null, preUser: null, preAgent: null };
    }
  }

  async isComposerReady(agentId: string): Promise<boolean> {
    try {
      const res = (await this.host.request(
        'GET',
        `/agents/composer-ready?agentId=${encodeURIComponent(agentId)}`
      )) as { ready?: boolean };
      return !!res.ready;
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

  onNewChatOnloadAgentMode(callback: NewChatOnloadHandler): void {
    this.newChatOnloadHandler = callback;
  }

  onAgentClosed(callback: AgentClosedHandler): void {
    this.agentClosedHandler = callback;
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

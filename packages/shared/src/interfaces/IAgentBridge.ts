export type AgentStatus = 'idle' | 'sending' | 'waiting' | 'error';

export interface IAgentBridge {
  sendMessage(agentId: string, text: string): Promise<void>;
  onResponse(callback: (agentId: string, text: string, key?: number) => void): void;
  getStatus(agentId: string): AgentStatus;
}

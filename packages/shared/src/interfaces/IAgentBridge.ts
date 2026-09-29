export type AgentStatus = 'idle' | 'sending' | 'waiting' | 'error';

export type BridgePollTurn = { index: string; text: string };

export type BridgePollSnapshot = {
  loading: boolean;
  lastUser: BridgePollTurn | null;
  lastAgent: BridgePollTurn | null;
};

/** 工具回传 / 无 key → 空串；兼容旧 Host 的 -1 */
export function normalizeChatKey(raw: unknown): string {
  if (raw == null || raw === '' || raw === -1 || raw === '-1') return '';
  return String(raw);
}

/** waiting 图标：loading / lastUser / lastAgent 任一变化即视为活动 */
export function pollSnapshotFingerprint(snap: BridgePollSnapshot): string {
  const user = snap.lastUser;
  const agent = snap.lastAgent;
  return [
    snap.loading ? '1' : '0',
    user ? String(user.index) : '',
    user?.text ?? '',
    agent ? String(agent.index) : '',
    agent?.text ?? '',
  ].join('|');
}

export interface IAgentBridge {
  sendMessage(agentId: string, text: string): Promise<void>;
  onResponse(callback: (agentId: string, text: string, key?: string) => void): void;
  getStatus(agentId: string): AgentStatus;
}

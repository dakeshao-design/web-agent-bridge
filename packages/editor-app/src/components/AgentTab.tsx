import type { AgentConfig, AgentStatus } from '@my-agent-editor/shared';

interface AgentTabProps {
  agent: AgentConfig;
  active: boolean;
  status: AgentStatus | string;
  onSelect: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  sending: '发送中',
  waiting: '等待回复',
  error: '错误',
};

export function AgentTab({ agent, active, status, onSelect }: AgentTabProps) {
  const busy = status === 'sending' || status === 'waiting';
  const label = STATUS_LABEL[status] ?? status;
  return (
    <button
      className={`agent-tab ${active ? 'active' : ''}`}
      onClick={() => onSelect(agent.id)}
      title={`${agent.name} · ${label}`}
    >
      <span className="agent-tab-name">{agent.name}</span>
      <span
        className={`agent-tab-status status-${status}${busy ? ' is-busy' : ''}`}
        aria-label={label}
        title={label}
      />
    </button>
  );
}

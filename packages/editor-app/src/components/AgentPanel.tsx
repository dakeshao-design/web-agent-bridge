import { useRef, useEffect } from 'react';
import type { AgentConfig, AgentStatus } from '@my-agent-editor/shared';
import { AgentTab } from './AgentTab';
import { AgentUrlBar } from './AgentUrlBar';

interface AgentPanelProps {
  width: number;
  agents: AgentConfig[];
  activeAgentId: string | null;
  agentStatuses: Record<string, AgentStatus>;
  workspaceReady: boolean;
  onSelectAgent: (id: string) => void;
  onBoundsChange: (bounds: { x: number; y: number; width: number; height: number }) => void;
}

export function AgentPanel({
  width,
  agents,
  activeAgentId,
  agentStatuses,
  workspaceReady,
  onSelectAgent,
  onBoundsChange,
}: AgentPanelProps) {
  const webviewHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = webviewHostRef.current;
    if (!el) return;

    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      onBoundsChange({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(el);
    window.addEventListener('resize', updateBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [onBoundsChange, activeAgentId]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  return (
    <div className="agent-panel" style={{ width }}>
      <div className="agent-tabs">
        {agents.map((agent) => (
          <AgentTab
            key={agent.id}
            agent={agent}
            active={agent.id === activeAgentId}
            status={agentStatuses[agent.id] || 'idle'}
            onSelect={onSelectAgent}
          />
        ))}
      </div>
      <AgentUrlBar url={activeAgent?.url ?? ''} />
      <div ref={webviewHostRef} className="agent-webview-host">
        {!workspaceReady && (
          <div className="agent-webview-placeholder">请先打开工作区</div>
        )}
      </div>
    </div>
  );
}

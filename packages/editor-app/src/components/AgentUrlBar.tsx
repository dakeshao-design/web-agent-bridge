interface AgentUrlBarProps {
  url: string;
}

export function AgentUrlBar({ url }: AgentUrlBarProps) {
  if (!url) return null;

  return (
    <div className="agent-url-bar">
      <input
        className="agent-url-input"
        type="text"
        readOnly
        value={url}
        title={url}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

import { useEffect, useRef } from 'react';

export type PowershellViewStatus = 'running' | 'done' | 'killed';

export interface PowershellViewEntry {
  id: string;
  timestamp: Date;
  agentName: string;
  command: string;
  output: string;
  status: PowershellViewStatus;
  exitCode: number | null;
}

interface PowershellPanelProps {
  entries: PowershellViewEntry[];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString();
}

function statusLabel(entry: PowershellViewEntry): string {
  if (entry.status === 'running') return '执行中';
  if (entry.status === 'killed') return '已终止';
  const code = entry.exitCode ?? -1;
  return entry.exitCode === 0 ? '成功' : `失败 (${code})`;
}

export function PowershellPanel({ entries }: PowershellPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div ref={listRef} className="powershell-panel-list">
      {entries.length === 0 ? (
        <div className="chat-log-empty">暂无 PowerShell 输出</div>
      ) : (
        entries.map((entry) => {
          const ok = entry.status === 'done' && entry.exitCode === 0;
          const fail = entry.status === 'killed' || (entry.status === 'done' && entry.exitCode !== 0);
          const output = entry.output.trim() ? entry.output : entry.status === 'running' ? '' : '(无输出)';
          return (
            <div
              key={entry.id}
              className={`powershell-entry${entry.status === 'running' ? ' is-running' : ''}`}
            >
              <div className="powershell-entry-meta">
                <span className="powershell-entry-time">{formatTime(entry.timestamp)}</span>
                <span className="powershell-entry-agent">{entry.agentName}</span>
                <span
                  className={`powershell-entry-status${ok ? ' ok' : ''}${fail ? ' fail' : ''}${
                    entry.status === 'running' ? ' running' : ''
                  }`}
                >
                  {statusLabel(entry)}
                </span>
              </div>
              <pre className="powershell-entry-cmd">{`PS> ${entry.command}`}</pre>
              {output ? <pre className="powershell-entry-console">{output}</pre> : null}
              {entry.status !== 'running' && entry.exitCode !== null && (
                <div className={`powershell-entry-exit${ok ? ' ok' : ' fail'}`}>
                  exit code: {entry.exitCode}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

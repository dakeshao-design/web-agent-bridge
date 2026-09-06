import { useEffect, useRef } from 'react';
import type { ChatLogEntry } from '../services/ConversationLogService';

interface ChatLogPanelProps {
  entries: ChatLogEntry[];
  /** 在 BottomPanel 内不绘制标题栏 */
  embedded?: boolean;
  logFilePath?: string;
  onClear?: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString();
}

function formatRoleLabel(role: ChatLogEntry['role']): string {
  switch (role) {
    case 'user':
      return '用户';
    case 'agent':
      return 'Agent';
    case 'bridge-request':
      return 'Request';
    case 'bridge-response':
      return 'Response';
    case 'bridge-copy':
      return 'Copy';
    case 'shell':
      return 'PowerShell';
    default:
      return role;
  }
}

/** shell 在 PowerShell 标签页显示 */
function visibleEntries(entries: ChatLogEntry[]): ChatLogEntry[] {
  return entries.filter((e) => e.role !== 'shell');
}

export function ChatLogPanel({ entries, embedded, logFilePath, onClear }: ChatLogPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const shown = visibleEntries(entries);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [shown]);

  const list = (
    <div ref={listRef} className="chat-log-list">
      {shown.length === 0 ? (
        <div className="chat-log-empty">暂无对话记录</div>
      ) : (
        shown.map((entry) => (
          <div key={entry.id} className={`chat-log-entry role-${entry.role}`}>
            <div className="chat-log-meta">
              <span className="chat-log-time">{formatTime(entry.timestamp)}</span>
              <span className="chat-log-role">{formatRoleLabel(entry.role)}</span>
              <span className="chat-log-agent">{entry.agentName}</span>
              {entry.source && (
                <span className="chat-log-source">{entry.source}</span>
              )}
            </div>
            <pre className="chat-log-content">{entry.content}</pre>
          </div>
        ))
      )}
    </div>
  );

  if (embedded) {
    return list;
  }

  return (
    <div className="chat-log-panel">
      <div className="chat-log-header">
        <span className="chat-log-title">对话日志</span>
        {logFilePath && (
          <span className="chat-log-file" title={logFilePath}>
            {logFilePath}
          </span>
        )}
        {onClear && (
          <button type="button" className="chat-log-clear" onClick={onClear}>
            清空显示
          </button>
        )}
      </div>
      {list}
    </div>
  );
}

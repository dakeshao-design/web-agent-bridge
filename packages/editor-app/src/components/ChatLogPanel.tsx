import { useEffect, useRef } from 'react';
import type { ChatLogEntry } from '../services/ConversationLogService';

interface ChatLogPanelProps {
  entries: ChatLogEntry[];
  logFilePath: string;
  onClear: () => void;
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

function ShellEntryBody({ entry }: { entry: ChatLogEntry }) {
  const meta = entry.meta;
  const command = meta?.command ?? '';
  const output = meta?.output?.trim() ? meta.output : '(无输出)';
  const exitCode = meta?.exitCode ?? -1;
  const ok = meta?.ok ?? false;

  return (
    <div className="chat-log-shell">
      <pre className="chat-log-shell-cmd">{`PS> ${command}`}</pre>
      <pre className="chat-log-shell-console">{output}</pre>
      <div className={`chat-log-shell-exit ${ok ? 'ok' : 'fail'}`}>
        exit code: {exitCode}
      </div>
    </div>
  );
}

export function ChatLogPanel({ entries, logFilePath, onClear }: ChatLogPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="chat-log-panel">
      <div className="chat-log-header">
        <span className="chat-log-title">对话日志</span>
        {logFilePath && (
          <span className="chat-log-file" title={logFilePath}>
            {logFilePath}
          </span>
        )}
        <button type="button" className="chat-log-clear" onClick={onClear}>
          清空显示
        </button>
      </div>
      <div ref={listRef} className="chat-log-list">
        {entries.length === 0 ? (
          <div className="chat-log-empty">暂无对话记录</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`chat-log-entry role-${entry.role}`}>
              <div className="chat-log-meta">
                <span className="chat-log-time">{formatTime(entry.timestamp)}</span>
                <span className="chat-log-role">{formatRoleLabel(entry.role)}</span>
                <span className="chat-log-agent">{entry.agentName}</span>
                {entry.role === 'shell' && entry.meta && (
                  <span className={`chat-log-shell-status ${entry.meta.ok ? 'ok' : 'fail'}`}>
                    {entry.meta.ok ? '成功' : '失败'}
                  </span>
                )}
                {entry.source && entry.role !== 'shell' && (
                  <span className="chat-log-source">{entry.source}</span>
                )}
              </div>
              {entry.role === 'shell' ? (
                <ShellEntryBody entry={entry} />
              ) : (
                <pre className="chat-log-content">{entry.content}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

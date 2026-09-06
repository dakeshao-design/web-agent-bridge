import { useEffect, useRef } from 'react';
import type { FileOperation } from '@my-agent-editor/shared';

export interface FileOpLogEntry {
  id: string;
  timestamp: Date;
  operation: FileOperation;
  status: 'pending' | 'applied' | 'rejected' | 'error';
  message?: string;
}

interface FileOpLogProps {
  entries: FileOpLogEntry[];
  /** 在 BottomPanel 内不绘制标题栏 */
  embedded?: boolean;
}

export function FileOpLog({ entries, embedded }: FileOpLogProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!embedded) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, embedded]);

  if (entries.length === 0) {
    return (
      <div className={`file-op-log empty${embedded ? ' embedded' : ''}`}>
        暂无文件操作
      </div>
    );
  }

  const list = (
    <ul className="file-op-log-list">
      {entries.map((entry) => (
        <li key={entry.id} className={`file-op-entry status-${entry.status}`}>
          <span className="file-op-time">
            {entry.timestamp.toLocaleTimeString()}
          </span>
          <span className="file-op-action">{entry.operation.action}</span>
          <span className="file-op-path" title={entry.operation.path}>
            {entry.operation.path}
          </span>
          <span className="file-op-status">{entry.status}</span>
          {entry.message && <span className="file-op-message">{entry.message}</span>}
        </li>
      ))}
    </ul>
  );

  if (embedded) {
    return (
      <div ref={listRef} className="file-op-log embedded">
        {list}
      </div>
    );
  }

  return (
    <div className="file-op-log">
      <div className="file-op-log-header">文件操作日志</div>
      {list}
    </div>
  );
}

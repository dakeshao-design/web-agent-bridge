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
}

export function FileOpLog({ entries }: FileOpLogProps) {
  if (entries.length === 0) {
    return <div className="file-op-log empty">暂无文件操作</div>;
  }

  return (
    <div className="file-op-log">
      <div className="file-op-log-header">文件操作日志</div>
      <ul className="file-op-log-list">
        {entries.map((entry) => (
          <li key={entry.id} className={`file-op-entry status-${entry.status}`}>
            <span className="file-op-time">
              {entry.timestamp.toLocaleTimeString()}
            </span>
            <span className="file-op-action">{entry.operation.action}</span>
            <span className="file-op-path">{entry.operation.path}</span>
            <span className="file-op-status">{entry.status}</span>
            {entry.message && <span className="file-op-message">{entry.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

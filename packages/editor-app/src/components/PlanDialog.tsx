interface PlanDialogProps {
  open: boolean;
  content: string;
  busy: boolean;
  onContentChange: (content: string) => void;
  onCreate: () => void;
  onClose: () => void;
}

export function PlanDialog({
  open,
  content,
  busy,
  onContentChange,
  onCreate,
  onClose,
}: PlanDialogProps) {
  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="创建计划">
      <div className="settings-panel plan-dialog">
        <div className="settings-header">
          <h2>创建计划</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="关闭"
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="plan-dialog-body">
          <label htmlFor="plan-content">计划内容</label>
          <textarea
            id="plan-content"
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
            placeholder="描述你希望 Agent 制定的计划"
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="settings-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button type="button" onClick={onCreate} disabled={busy || !content.trim()}>
            {busy ? '创建中…' : '创建计划'}
          </button>
        </div>
      </div>
    </div>
  );
}

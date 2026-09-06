interface DebugToolsDialogProps {
  open: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  onPrimary: () => void | Promise<void>;
  onClose: () => void;
  primaryDisabled?: boolean;
  busy?: boolean;
}

export function DebugToolsDialog({
  open,
  title,
  body,
  primaryLabel,
  onPrimary,
  onClose,
  primaryDisabled,
  busy,
}: DebugToolsDialogProps) {
  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="settings-panel debug-tools-dialog">
        <div className="settings-header">
          <h2>{title}</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="debug-tools-body">
          <pre className="debug-tools-pre">{body || '(空)'}</pre>
        </div>
        <div className="settings-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            onClick={() => void onPrimary()}
            disabled={primaryDisabled || busy}
          >
            {busy ? '…' : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

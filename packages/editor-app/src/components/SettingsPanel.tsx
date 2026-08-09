import { listToolsForSettings, type ToolPermissionMode, type ToolPermissionsConfig } from '@my-agent-editor/shared';

const MODE_LABELS: { value: ToolPermissionMode; label: string }[] = [
  { value: 'allow', label: '允许' },
  { value: 'ask', label: '询问' },
  { value: 'deny', label: '禁止' },
];

interface SettingsPanelProps {
  open: boolean;
  permissions: ToolPermissionsConfig;
  onChange: (toolName: string, mode: ToolPermissionMode) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
}

export function SettingsPanel({
  open,
  permissions,
  onChange,
  onSave,
  onClose,
  saving,
}: SettingsPanelProps) {
  if (!open) return null;

  const tools = listToolsForSettings();

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="工具权限设置">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>工具权限</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>工具</th>
                <th>简介</th>
                <th>权限</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => {
                const mode = permissions[tool.name] ?? 'allow';
                return (
                  <tr key={tool.name}>
                    <td className="settings-tool-name">{tool.name}</td>
                    <td className="settings-tool-desc">{tool.description}</td>
                    <td className="settings-tool-mode">
                      {MODE_LABELS.map((opt) => (
                        <label key={opt.value} className="settings-radio">
                          <input
                            type="radio"
                            name={`perm-${tool.name}`}
                            checked={mode === opt.value}
                            onChange={() => onChange(tool.name, opt.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="settings-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

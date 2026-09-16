import { ChatLogPanel } from './ChatLogPanel';
import { PowershellPanel, type PowershellViewEntry } from './PowershellPanel';
import { FileOpLog, type FileOpLogEntry } from './FileOpLog';
import type { ChatLogEntry } from '../services/ConversationLogService';

export type BottomPanelTab = 'chat' | 'runtime' | 'powershell' | 'fileops';

interface BottomPanelProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  chatEntries: ChatLogEntry[];
  chatLogFilePath: string;
  onClearChat: () => void;
  runtimeEntries: ChatLogEntry[];
  runtimeLogFilePath: string;
  onClearRuntime: () => void;
  powershellEntries: PowershellViewEntry[];
  onClearPowershell: () => void;
  runningCount: number;
  fileOpEntries: FileOpLogEntry[];
  onClearFileOps: () => void;
}

export function BottomPanel({
  activeTab,
  onTabChange,
  chatEntries,
  chatLogFilePath,
  onClearChat,
  runtimeEntries,
  runtimeLogFilePath,
  onClearRuntime,
  powershellEntries,
  onClearPowershell,
  runningCount,
  fileOpEntries,
  onClearFileOps,
}: BottomPanelProps) {
  const onClear =
    activeTab === 'chat'
      ? onClearChat
      : activeTab === 'runtime'
        ? onClearRuntime
        : activeTab === 'powershell'
          ? onClearPowershell
          : onClearFileOps;

  const activeLogPath =
    activeTab === 'chat'
      ? chatLogFilePath
      : activeTab === 'runtime'
        ? runtimeLogFilePath
        : '';

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={`bottom-panel-tab${activeTab === 'chat' ? ' active' : ''}`}
            onClick={() => onTabChange('chat')}
          >
            对话日志
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'runtime'}
            className={`bottom-panel-tab${activeTab === 'runtime' ? ' active' : ''}`}
            onClick={() => onTabChange('runtime')}
          >
            运行日志
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'powershell'}
            className={`bottom-panel-tab${activeTab === 'powershell' ? ' active' : ''}`}
            onClick={() => onTabChange('powershell')}
          >
            PowerShell
            {runningCount > 0 ? (
              <span className="bottom-panel-tab-badge" title="执行中">
                {runningCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'fileops'}
            className={`bottom-panel-tab${activeTab === 'fileops' ? ' active' : ''}`}
            onClick={() => onTabChange('fileops')}
          >
            文件操作
          </button>
        </div>
        {activeLogPath ? (
          <span className="chat-log-file" title={activeLogPath}>
            {activeLogPath}
          </span>
        ) : (
          <span className="bottom-panel-spacer" />
        )}
        <button type="button" className="chat-log-clear" onClick={onClear}>
          清空显示
        </button>
      </div>
      {activeTab === 'chat' ? (
        <ChatLogPanel entries={chatEntries} kind="chat" embedded />
      ) : activeTab === 'runtime' ? (
        <ChatLogPanel entries={runtimeEntries} kind="runtime" embedded />
      ) : activeTab === 'powershell' ? (
        <PowershellPanel entries={powershellEntries} />
      ) : (
        <FileOpLog entries={fileOpEntries} embedded />
      )}
    </div>
  );
}

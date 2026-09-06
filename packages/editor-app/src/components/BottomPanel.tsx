import { ChatLogPanel } from './ChatLogPanel';
import { PowershellPanel, type PowershellViewEntry } from './PowershellPanel';
import { FileOpLog, type FileOpLogEntry } from './FileOpLog';
import type { ChatLogEntry } from '../services/ConversationLogService';

export type BottomPanelTab = 'chat' | 'powershell' | 'fileops';

interface BottomPanelProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  chatEntries: ChatLogEntry[];
  chatLogFilePath: string;
  onClearChat: () => void;
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
  powershellEntries,
  onClearPowershell,
  runningCount,
  fileOpEntries,
  onClearFileOps,
}: BottomPanelProps) {
  const onClear =
    activeTab === 'chat'
      ? onClearChat
      : activeTab === 'powershell'
        ? onClearPowershell
        : onClearFileOps;

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
        {activeTab === 'chat' && chatLogFilePath ? (
          <span className="chat-log-file" title={chatLogFilePath}>
            {chatLogFilePath}
          </span>
        ) : (
          <span className="bottom-panel-spacer" />
        )}
        <button type="button" className="chat-log-clear" onClick={onClear}>
          清空显示
        </button>
      </div>
      {activeTab === 'chat' ? (
        <ChatLogPanel entries={chatEntries} embedded />
      ) : activeTab === 'powershell' ? (
        <PowershellPanel entries={powershellEntries} />
      ) : (
        <FileOpLog entries={fileOpEntries} embedded />
      )}
    </div>
  );
}

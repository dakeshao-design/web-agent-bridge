import type { FileOperation, IFileService, ToolApplyResult } from '@my-agent-editor/shared';

export type LogStatus = 'applied' | 'error' | 'pending';

export interface ToolApplyContext {
  fileService: IFileService;
  workspaceRoot: string;
  resolvePath: (path: string) => string;
  addLogEntry: (operation: FileOperation, status: LogStatus, message?: string) => void;
  openInEditor?: (path: string, content: string) => Promise<void>;
  /** 当前 Agent 的行数上限；未设置则不限制 */
  fileLineLimit?: number;
}

export type FileToolHandler = (
  op: FileOperation,
  ctx: ToolApplyContext
) => Promise<ToolApplyResult>;

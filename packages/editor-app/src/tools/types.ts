import type { IFileService, FileOperation, ToolApplyResult } from '@my-agent-editor/shared';
import type { FileOpLogEntry } from '../components/FileOpLog';

export interface ToolApplyContext {
  fileService: IFileService;
  workspaceRoot: string;
  resolvePath: (path: string) => string;
  filePath: string | null;
  setContent: (content: string) => void;
  setFilePath: (path: string) => void;
  setIsDirty: (dirty: boolean) => void;
  addLogEntry: (
    operation: FileOperation,
    status: FileOpLogEntry['status'],
    message?: string
  ) => void;
  publishLastFileOp: (
    operation: FileOperation,
    status: FileOpLogEntry['status'],
    message?: string
  ) => void;
  /** 当前 Agent 的行数上限；未设置则不限制 */
  fileLineLimit?: number;
}

export type FileToolHandler = (
  op: FileOperation,
  ctx: ToolApplyContext
) => Promise<ToolApplyResult>;

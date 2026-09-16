import type { FileOperation } from '../interfaces/IFileOperationParser.js';

export type ToolApplyResult = {
  ok: boolean;
  message?: string;
  content?: string;
  total_lines?: number;
  edited_range?: string;
  deleted_range?: string;
};

export interface AgentToolArgDefinition {
  readonly name: string;
  readonly description: string;
  /** 文件内容参数：解析时不 trim */
  readonly isFileContent?: boolean;
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly args: readonly AgentToolArgDefinition[];
  readonly action: FileOperation['action'];
  parseArgs(args: Record<string, string>): FileOperation | null;
  toArgs(operation: FileOperation): Record<string, string>;
  /** 可变名文件内容参数，如 old_2；未实现则只认 args[].isFileContent */
  isFileContentArg?(argName: string): boolean;
}

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
}

export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly args: readonly AgentToolArgDefinition[];
  readonly action: FileOperation['action'];
  parseArgs(args: Record<string, string>): FileOperation | null;
  toArgs(operation: FileOperation): Record<string, string>;
}

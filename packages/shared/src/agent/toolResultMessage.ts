import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { ToolApplyResult } from '../tools/types.js';
import { getToolByAction } from '../tools/registry.js';
import { REPORT_TOOL_MARKER } from './fileOperationsFingerprint.js';

export type { ToolApplyResult };

export function fileActionToToolName(action: FileOperation['action']): string {
  return getToolByAction(action)?.name ?? action;
}

export function buildToolResultMessage(
  toolName: string,
  args: Record<string, string>,
  result: ToolApplyResult
): string {
  const lines = [
    REPORT_TOOL_MARKER,
    `工具 \`${toolName}\` 执行${result.ok ? '成功' : '失败'}。`,
    '',
  ];

  const hasLineMeta = result.total_lines !== undefined;

  if (args.path) {
    lines.push(`path: ${args.path}`);
  }
  if (args.dest) {
    lines.push(`dest: ${args.dest}`);
  }
  if (args.deep) {
    lines.push(`deep: ${args.deep}`);
  }
  if (args.command) {
    lines.push(`command: ${args.command}`);
  }
  // 有 total_lines 时不回显请求 start/end_line，避免与 edited_range 重复
  if (!hasLineMeta) {
    if (args.start_line) {
      lines.push(`start_line: ${args.start_line}`);
    }
    if (args.end_line) {
      lines.push(`end_line: ${args.end_line}`);
    }
  }
  if (args.pattern) {
    lines.push(`pattern: ${args.pattern}`);
  }
  if (args.glob) {
    lines.push(`glob: ${args.glob}`);
  }
  if (args.offset) {
    lines.push(`offset: ${args.offset}`);
  }
  if (result.total_lines !== undefined) {
    lines.push(`total_lines: ${result.total_lines}`);
  }
  if (result.edited_range) {
    lines.push(`edited_range: ${result.edited_range}`);
  }
  if (result.deleted_range) {
    lines.push(`deleted_range: ${result.deleted_range}`);
  }
  // 成功且已有行元数据时不再输出重复 message
  const skipMessage = result.ok && hasLineMeta;
  if (result.message && !skipMessage) {
    lines.push(`message: ${result.message}`);
  }
  if (result.content !== undefined) {
    lines.push('', '```', result.content, '```');
  }

  return lines.join('\n');
}

export function buildToolResultFromOperation(
  op: FileOperation,
  result: ToolApplyResult
): string {
  const tool = getToolByAction(op.action);
  const toolName = tool?.name ?? op.action;
  const args = tool?.toArgs(op) ?? { path: op.path };
  return buildToolResultMessage(toolName, args, result);
}

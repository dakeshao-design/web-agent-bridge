import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { ToolApplyResult } from '../tools/types.js';
import { getToolByAction } from '../tools/registry.js';
import { SYSTEM_MARKER } from './fileOperationsFingerprint.js';

export type { ToolApplyResult };

/** 回传识别键白名单 */
const ECHO_ARG_KEYS = [
  'path',
  'dest',
  'command',
  'start_line',
  'end_line',
  'pattern',
  'glob',
  'offset',
] as const;

export function fileActionToToolName(action: FileOperation['action']): string {
  return getToolByAction(action)?.name ?? action;
}

export function buildToolResultMessage(
  toolName: string,
  args: Record<string, string>,
  result: ToolApplyResult
): string {
  const lines = [
    SYSTEM_MARKER,
    `${result.ok ? 'ok' : 'err'} \`${toolName}\``,
  ];

  const hasLineMeta = result.total_lines !== undefined;

  if (args.name && toolName === 'read_skill') {
    lines.push(`name: ${args.name}`);
  }

  for (const key of ECHO_ARG_KEYS) {
    if (key === 'path' && toolName === 'read_skill') continue;
    if ((key === 'start_line' || key === 'end_line') && hasLineMeta) continue;
    const value = args[key];
    if (!value) continue;
    lines.push(`${key}: ${value}`);
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
  if (result.more_offset !== undefined) {
    lines.push(`more_offset: ${result.more_offset}`);
  }

  // 成功：不回传冗余中文 message；失败：始终保留
  if (!result.ok && result.message) {
    lines.push(`message: ${result.message}`);
  }

  if (result.content !== undefined) {
    lines.push('', result.content);
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

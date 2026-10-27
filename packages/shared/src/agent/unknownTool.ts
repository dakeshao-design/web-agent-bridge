import type { ToolPermissionsConfig } from '../config/types.js';
import { getToolByName } from '../tools/registry.js';
import { extractCallToolSourceBlocks, stripMarkdownLineNumbers } from '../tools/parseCallTool.js';
import { buildToolTable } from './agentModePrompt.js';
import { listToolsForPrompt } from './toolPermissions.js';
import { SYSTEM_MARKER } from './fileOperationsFingerprint.js';

const BEGIN_TOOL_NAME = /BEGIN_TOOL:\s*(\S+)/gi;
const BEGIN_ARG_NAME = /BEGIN_ARG:\s*(\S+)\s*\r?\n([\s\S]*?)(?=\r?\n(?:END_ARG\b|BEGIN_ARG:\s*\S+\s*\r?\n|END_TOOL\b)|$)/gi;

export type ToolCallValidationIssue = {
  unknownToolNames: string[];
  missingParameters: string[];
  invalidArgs: string[];
};

function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

function extractCallToolArgs(block: string): Record<string, string> {
  const args: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = BEGIN_ARG_NAME.exec(block)) !== null) {
    const argName = match[1].trim();
    if (!argName) continue;
    const raw = match[2] ?? '';
    args[argName] = raw;
  }
  return args;
}

/** 从回复中提取 call-tool 工具名（去重，保序） */
export function extractCallToolNames(text: string): string[] {
  const normalized = stripMarkdownLineNumbers(text);
  const names: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(BEGIN_TOOL_NAME.source, 'gi');
  while ((match = re.exec(normalized)) !== null) {
    const name = match[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** 未在 AGENT_TOOLS 注册的工具名 */
export function findUnknownCallToolNames(text: string): string[] {
  return extractCallToolNames(text).filter((name) => !getToolByName(name));
}

/** 检查 call-tool 是否存在未知工具、缺少必要参数或传入不存在的参数 */
export function findCallToolValidationIssues(text: string): ToolCallValidationIssue {
  const issue: ToolCallValidationIssue = {
    unknownToolNames: [],
    missingParameters: [],
    invalidArgs: [],
  };

  const blocks = extractCallToolSourceBlocks(text);
  for (const block of blocks) {
    BEGIN_ARG_NAME.lastIndex = 0;
    const toolMatch = /BEGIN_TOOL:\s*(\S+)/i.exec(block);
    if (!toolMatch) continue;

    const toolName = toolMatch[1].trim();
    const tool = getToolByName(toolName);
    if (!tool) {
      issue.unknownToolNames.push(toolName);
      continue;
    }

    const args = extractCallToolArgs(block);
    const allowedArgs = new Set(tool.args.map((arg) => arg.name));
    const actualArgNames = Object.keys(args);
    for (const argName of actualArgNames) {
      const isAllowed = allowedArgs.has(argName) || !!tool.isFileContentArg?.(argName);
      if (!isAllowed) {
        issue.invalidArgs.push(argName);
      }
    }

    if (tool.parseArgs(args) === null) {
      const missing = tool.args
        .filter((arg) => {
          if (arg.name === 'content_b64') return false;
          return !(arg.name in args);
        })
        .map((arg) => arg.name);

      if (tool.name === 'edit_file') {
        if (!actualArgNames.some((name) => /^old_\d+$/.test(name))) {
          missing.push('old_1');
        }
        if (!actualArgNames.some((name) => /^new_\d+$/.test(name))) {
          missing.push('new_1');
        }
      }
      if (tool.name === 'edit_file_range') {
        if (!('start_line' in args)) missing.push('start_line');
        if (!('end_line' in args)) missing.push('end_line');
      }
      issue.missingParameters.push(...missing);
    }
  }

  return {
    unknownToolNames: uniqueNames(issue.unknownToolNames),
    missingParameters: uniqueNames(issue.missingParameters),
    invalidArgs: uniqueNames(issue.invalidArgs),
  };
}

/** 非法 call-tool 参数时回传工具列表 */
export function buildToolCallValidationResult(
  issue: ToolCallValidationIssue,
  toolPermissions?: ToolPermissionsConfig | null,
  options: { includeToolTable?: boolean } = {}
): string {
  const tools = listToolsForPrompt(toolPermissions);
  const includeToolTable = options.includeToolTable ?? true;
  const reasons: string[] = [];

  if (issue.unknownToolNames.length) {
    reasons.push(`工具不存在: ${uniqueNames(issue.unknownToolNames).join(', ')}。`);
  }
  if (issue.missingParameters.length) {
    reasons.push(`缺少必要参数: ${uniqueNames(issue.missingParameters).join(', ')}。`);
  }
  if (issue.invalidArgs.length) {
    reasons.push(`参数不存在: ${uniqueNames(issue.invalidArgs).join(', ')}。`);
  }

  const message = reasons.length ? reasons.join(' ') : 'call-tool 参数不合法。';
  const lines = [
    SYSTEM_MARKER,
    'err `invalid_tool_call`',
    `message: ${message}`,
  ];

  if (includeToolTable) {
    lines.push('', '## 可用工具', '', buildToolTable(tools));
  }

  return lines.join('\n');
}

/** 未知工具时回传可用工具列表 */
export function buildUnknownToolResult(
  unknownNames: string[],
  toolPermissions?: ToolPermissionsConfig | null,
  options: { includeToolTable?: boolean } = {}
): string {
  const tools = listToolsForPrompt(toolPermissions);
  const names = uniqueNames(unknownNames).join(', ') || '(未知)';
  const includeToolTable = options.includeToolTable ?? true;
  const lines = [
    SYSTEM_MARKER,
    'err `unknown_tool`',
    `message: 工具不存在: ${names}。请使用下列可用工具之一，并按 call-tool 格式重新调用。`,
  ];
  if (includeToolTable) {
    lines.push('', '## 可用工具', '', buildToolTable(tools));
  }
  return lines.join('\n');
}

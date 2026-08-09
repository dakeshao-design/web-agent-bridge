import type { ToolPermissionsConfig } from '../config/types.js';
import { getToolByName } from '../tools/registry.js';
import { stripMarkdownLineNumbers } from '../tools/parseCallTool.js';
import { buildToolTable } from './agentModePrompt.js';
import { listToolsForPrompt } from './toolPermissions.js';

const BEGIN_TOOL_NAME = /BEGIN_TOOL:\s*(\S+)/gi;

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

/** 未知工具时回传可用工具列表 */
export function buildUnknownToolResult(
  unknownNames: string[],
  toolPermissions?: ToolPermissionsConfig | null
): string {
  const tools = listToolsForPrompt(toolPermissions);
  const names = unknownNames.length ? unknownNames.join(', ') : '(未知)';
  return [
    '[REPORT_TOOL]',
    `工具不存在: ${names}`,
    '',
    'status: error',
    'message: 请使用下列可用工具之一，并按 call-tool 格式重新调用。',
    '',
    '## 可用工具',
    '',
    buildToolTable(tools),
  ].join('\n');
}

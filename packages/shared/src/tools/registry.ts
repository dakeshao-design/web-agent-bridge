import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { AgentToolDefinition } from './types.js';
import { readFileTool } from './readFileTool.js';
import { readFileRangeTool } from './readFileRangeTool.js';
import { countFileRowsTool } from './countFileRowsTool.js';
import { writeFileTool } from './writeFileTool.js';
import { appendFileTool } from './appendFileTool.js';
import { editFileRangeTool } from './editFileRangeTool.js';
import { deleteFileTool } from './deleteFileTool.js';
import { deletePathTool } from './deletePathTool.js';
import { movePathTool } from './movePathTool.js';
import { copyPathTool } from './copyPathTool.js';
import { lsTool } from './lsTool.js';
import { grepTool } from './grepTool.js';
import { runPowershellTool } from './runPowershellTool.js';

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [
  readFileTool,
  readFileRangeTool,
  countFileRowsTool,
  writeFileTool,
  appendFileTool,
  editFileRangeTool,
  deleteFileTool,
  deletePathTool,
  movePathTool,
  copyPathTool,
  lsTool,
  grepTool,
  runPowershellTool,
];

const byName = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));
const byAction = new Map(AGENT_TOOLS.map((tool) => [tool.action, tool]));

export function getToolByName(name: string): AgentToolDefinition | undefined {
  return byName.get(name);
}

export function getToolByAction(
  action: FileOperation['action']
): AgentToolDefinition | undefined {
  return byAction.get(action);
}

export function parseToolCall(
  toolName: string,
  args: Record<string, string>
): FileOperation | null {
  const tool = getToolByName(toolName);
  if (!tool) return null;
  return tool.parseArgs(args);
}

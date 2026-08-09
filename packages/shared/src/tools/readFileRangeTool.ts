import type { AgentToolDefinition } from './types.js';

function parsePositiveInt(value?: string): number | null {
  if (!value?.trim()) return null;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export const readFileRangeTool: AgentToolDefinition = {
  name: 'read_file_range',
  description: '读取文件指定行范围',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'start_line',
      description: '起始行号，从 1 开始',
    },
    {
      name: 'end_line',
      description: '结束行号，包含该行',
    },
  ],
  action: 'read_range',
  parseArgs(args) {
    const path = args.path?.trim();
    const startLine = parsePositiveInt(args.start_line);
    const endLine = parsePositiveInt(args.end_line);
    if (!path || startLine === null || endLine === null || endLine < startLine) {
      return null;
    }
    return { action: 'read_range', path, start_line: startLine, end_line: endLine };
  },
  toArgs(operation) {
    return {
      path: operation.path,
      start_line: String(operation.start_line ?? ''),
      end_line: String(operation.end_line ?? ''),
    };
  },
};

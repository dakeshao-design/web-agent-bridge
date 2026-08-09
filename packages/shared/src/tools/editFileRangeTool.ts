import type { AgentToolDefinition } from './types.js';
import { resolveFileContent } from './resolveFileContent.js';

function parsePositiveInt(value?: string): number | null {
  if (!value?.trim()) return null;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export const editFileRangeTool: AgentToolDefinition = {
  name: 'edit_file_range',
  description: '替换文件指定行范围的内容',
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
    {
      name: 'content',
      description: '替换后的内容，空则删除该行范围。含代码围栏或工具关键字时用 <<<哨兵 包裹',
    },
    {
      name: 'content_b64',
      description: '可选。UTF-8 Base64 编码的替换内容，优先于 content',
    },
  ],
  action: 'edit_range',
  parseArgs(args) {
    const path = args.path?.trim();
    const startLine = parsePositiveInt(args.start_line);
    const endLine = parsePositiveInt(args.end_line);
    if (!path || startLine === null || endLine === null || endLine < startLine) {
      return null;
    }
    try {
      return {
        action: 'edit_range',
        path,
        start_line: startLine,
        end_line: endLine,
        content: resolveFileContent(args),
      };
    } catch {
      return null;
    }
  },
  toArgs(operation) {
    const args: Record<string, string> = {
      path: operation.path,
      start_line: String(operation.start_line ?? ''),
      end_line: String(operation.end_line ?? ''),
    };
    if (operation.content !== undefined) {
      args.content = operation.content;
    }
    return args;
  },
};

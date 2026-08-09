import type { AgentToolDefinition } from './types.js';
import { resolveFileContent } from './resolveFileContent.js';

export const writeFileTool: AgentToolDefinition = {
  name: 'write_file',
  description: '写入文件',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'content',
      description: '要写入的完整文件内容，会覆盖原文件。含代码围栏或工具关键字时用 <<<哨兵 包裹',
    },
    {
      name: 'content_b64',
      description: '可选。UTF-8 Base64 编码的文件内容，优先于 content',
    },
  ],
  action: 'write',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    try {
      return { action: 'write', path, content: resolveFileContent(args) };
    } catch {
      return null;
    }
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path };
    if (operation.content !== undefined) {
      args.content = operation.content;
    }
    return args;
  },
};

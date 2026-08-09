import type { AgentToolDefinition } from './types.js';

export const appendFileTool: AgentToolDefinition = {
  name: 'append_file',
  description: '追加内容',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'content',
      description: '要追加到文件末尾的内容',
    },
  ],
  action: 'append',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    return { action: 'append', path, content: args.content ?? '' };
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path };
    if (operation.content !== undefined) {
      args.content = operation.content;
    }
    return args;
  },
};

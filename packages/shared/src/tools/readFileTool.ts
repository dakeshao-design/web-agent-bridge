import type { AgentToolDefinition } from './types.js';

export const readFileTool: AgentToolDefinition = {
  name: 'read_file',
  description: '读取文件',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
  ],
  action: 'read',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    return { action: 'read', path };
  },
  toArgs(operation) {
    return { path: operation.path };
  },
};

import type { AgentToolDefinition } from './types.js';

export const deleteFileTool: AgentToolDefinition = {
  name: 'delete_file',
  description: '删除文件',
  args: [
    {
      name: 'path',
      description: '要删除的文件路径，可为相对工作区根目录或绝对路径',
    },
  ],
  action: 'delete',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    return { action: 'delete', path };
  },
  toArgs(operation) {
    return { path: operation.path };
  },
};

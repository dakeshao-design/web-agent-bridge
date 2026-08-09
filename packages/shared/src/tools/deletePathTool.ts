import type { AgentToolDefinition } from './types.js';

export const deletePathTool: AgentToolDefinition = {
  name: 'delete_path',
  description: '删除文件或文件夹及其内部所有内容',
  args: [
    {
      name: 'path',
      description: '要删除的文件或文件夹路径，可为相对工作区根目录或绝对路径',
    },
  ],
  action: 'delete_path',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    return { action: 'delete_path', path };
  },
  toArgs(operation) {
    return { path: operation.path };
  },
};

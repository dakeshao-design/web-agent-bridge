import type { AgentToolDefinition } from './types.js';

export const countFileRowsTool: AgentToolDefinition = {
  name: 'count_file_rows',
  description: '返回文件行数',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
  ],
  action: 'count_rows',
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    return { action: 'count_rows', path };
  },
  toArgs(operation) {
    return { path: operation.path };
  },
};

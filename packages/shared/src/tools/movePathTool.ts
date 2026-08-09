import type { AgentToolDefinition } from './types.js';

export const movePathTool: AgentToolDefinition = {
  name: 'move_path',
  description: '移动文件或文件夹',
  args: [
    {
      name: 'path',
      description: '源文件或文件夹路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'dest',
      description: '目标完整路径，含移动后的文件名或文件夹名',
    },
  ],
  action: 'move',
  parseArgs(args) {
    const path = args.path?.trim();
    const dest = args.dest?.trim();
    if (!path || !dest) return null;
    return { action: 'move', path, dest };
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path };
    if (operation.dest !== undefined) {
      args.dest = operation.dest;
    }
    return args;
  },
};

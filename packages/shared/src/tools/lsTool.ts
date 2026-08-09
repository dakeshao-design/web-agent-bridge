import type { AgentToolDefinition } from './types.js';

function parseBool(value?: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export const lsTool: AgentToolDefinition = {
  name: 'ls',
  description: '列出目录内的文件和文件夹',
  args: [
    {
      name: 'path',
      description: '目标目录路径，默认当前工作区根目录',
    },
    {
      name: 'deep',
      description: '是否递归列出子目录内所有文件，默认 false；false 时含本层文件夹名以 / 结尾',
    },
  ],
  action: 'list',
  parseArgs(args) {
    const path = args.path?.trim() || '.';
    return { action: 'list', path, deep: parseBool(args.deep) };
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path || '.' };
    if (operation.deep) {
      args.deep = 'true';
    }
    return args;
  },
};

import type { AgentToolDefinition } from './types.js';
import { matchGlob } from './grepLogic.js';

function parseBool(value?: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** 取列表项叶名，去掉目录标记 / */
function listedLeafName(name: string): string {
  const trimmed = name.replace(/\/$/, '');
  const i = trimmed.lastIndexOf('/');
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/** 按 filter 过滤 ls 结果，语义同 PowerShell -Filter */
export function filterListedNames(names: string[], filter?: string): string[] {
  if (!filter) return names;
  return names.filter((name) => matchGlob(listedLeafName(name), filter));
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
    {
      name: 'filter',
      description: '按文件名过滤，支持 * 与 ?，等同 PowerShell -Filter；省略则不过滤',
    },
  ],
  action: 'list',
  parseArgs(args) {
    const path = args.path?.trim() || '.';
    const filter = args.filter?.trim();
    return {
      action: 'list',
      path,
      deep: parseBool(args.deep),
      ...(filter ? { filter } : {}),
    };
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path || '.' };
    if (operation.deep) {
      args.deep = 'true';
    }
    if (operation.filter) {
      args.filter = operation.filter;
    }
    return args;
  },
};

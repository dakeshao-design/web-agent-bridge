import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { AgentToolDefinition } from './types.js';

function parseBool(value?: string): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined || !value.trim()) return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined || !value.trim()) return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export const grepTool: AgentToolDefinition = {
  name: 'grep',
  description: '搜索指定文件或目录内匹配行',
  args: [
    {
      name: 'path',
      description: '目标文件或目录路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'pattern',
      description: '搜索字符串；regex 为 true 时按正则匹配',
    },
    {
      name: 'regex',
      description: '是否按正则匹配，默认 false',
    },
    {
      name: 'case_insensitive',
      description: '是否忽略大小写，默认 false',
    },
    {
      name: 'glob',
      description: '可选。目录搜索时按文件名过滤，如 *.ts',
    },
    {
      name: 'head_limit',
      description: '单次返回的最大匹配条数，默认 100',
    },
    {
      name: 'offset',
      description: '跳过前 N 条匹配后再收集，默认 0，用于继续检索',
    },
  ],
  action: 'grep',
  parseArgs(args) {
    const path = args.path?.trim();
    const pattern = args.pattern;
    if (!path || pattern === undefined || pattern === '') return null;
    const headLimit = parsePositiveInt(args.head_limit, 100);
    const offset = parseNonNegativeInt(args.offset, 0);
    if (headLimit === null || offset === null) return null;
    const op: FileOperation = {
      action: 'grep',
      path,
      pattern,
      head_limit: headLimit,
      offset,
    };
    if (parseBool(args.regex)) op.regex = true;
    if (parseBool(args.case_insensitive)) op.case_insensitive = true;
    const glob = args.glob?.trim();
    if (glob) op.glob = glob;
    return op;
  },
  toArgs(operation) {
    const args: Record<string, string> = {
      path: operation.path,
      pattern: operation.pattern ?? '',
    };
    if (operation.regex) args.regex = 'true';
    if (operation.case_insensitive) args.case_insensitive = 'true';
    if (operation.glob) args.glob = operation.glob;
    if (operation.head_limit !== undefined) {
      args.head_limit = String(operation.head_limit);
    }
    if (operation.offset !== undefined && operation.offset > 0) {
      args.offset = String(operation.offset);
    }
    return args;
  },
};

import type { FileEditReplacement } from '../interfaces/IFileOperationParser.js';
import type { AgentToolDefinition } from './types.js';

const PAIR_ARG = /^(old|new)_(\d+)$/;

function collectReplacements(args: Record<string, string>): FileEditReplacement[] | null {
  const replacements: FileEditReplacement[] = [];
  for (let n = 1; ; n++) {
    const oldKey = `old_${n}`;
    const newKey = `new_${n}`;
    const hasOld = Object.prototype.hasOwnProperty.call(args, oldKey);
    const hasNew = Object.prototype.hasOwnProperty.call(args, newKey);
    if (!hasOld && !hasNew) break;
    if (!hasOld || !hasNew) return null;
    const old = args[oldKey];
    if (old === undefined || old === '') return null;
    replacements.push({ old, new: args[newKey] ?? '' });
  }
  return replacements.length > 0 ? replacements : null;
}

export const editFileTool: AgentToolDefinition = {
  name: 'edit_file',
  description: '按整行段落替换文件内容，可一次替换多段',
  args: [
    {
      name: 'path',
      description: '目标文件路径，可为相对工作区根目录或绝对路径',
    },
    {
      name: 'old_1',
      description: '第1段旧内容，须整行对齐，可多行。可继续 old_2/new_2…。含代码围栏或工具关键字时用 <<<哨兵 包裹',
      isFileContent: true,
    },
    {
      name: 'new_1',
      description: '第1段新内容，空则删除该段。含代码围栏或工具关键字时用 <<<哨兵 包裹',
      isFileContent: true,
    },
  ],
  action: 'edit',
  isFileContentArg(argName) {
    return PAIR_ARG.test(argName);
  },
  parseArgs(args) {
    const path = args.path?.trim();
    if (!path) return null;
    const replacements = collectReplacements(args);
    if (!replacements) return null;
    return { action: 'edit', path, replacements };
  },
  toArgs(operation) {
    const args: Record<string, string> = { path: operation.path };
    const list = operation.replacements ?? [];
    for (let i = 0; i < list.length; i++) {
      const n = i + 1;
      args[`old_${n}`] = list[i].old;
      args[`new_${n}`] = list[i].new;
    }
    return args;
  },
};

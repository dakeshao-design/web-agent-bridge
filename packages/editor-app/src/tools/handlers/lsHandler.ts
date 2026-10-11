import { filterListedNames } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyListFiles: FileToolHandler = async (op, ctx) => {
  if (op.deep === undefined) {
    const message = '缺少 deep 参数，须为 true 或 false';
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }
  const listed = await ctx.fileService.listFiles(op.path, op.deep);
  const files = filterListedNames(listed, op.filter);
  const content = files.join('\n');
  const message = `共 ${files.length} 项`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content };
};

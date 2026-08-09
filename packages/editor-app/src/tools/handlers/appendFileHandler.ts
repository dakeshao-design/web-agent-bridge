import type { FileToolHandler } from '../types';

export const applyAppendFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.append(op.path, op.content || '');
  ctx.addLogEntry(op, 'applied');
  ctx.publishLastFileOp(op, 'applied');
  return { ok: true, message: '追加完成' };
};

import type { FileToolHandler } from '../types';

export const applyDeleteFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.delete(op.path);
  ctx.addLogEntry(op, 'applied');
  ctx.publishLastFileOp(op, 'applied');
  return { ok: true, message: '删除完成' };
};

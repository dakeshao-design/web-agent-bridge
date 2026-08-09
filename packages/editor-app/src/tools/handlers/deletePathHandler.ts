import type { FileToolHandler } from '../types';

export const applyDeletePath: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.deletePath(op.path);
  const message = '路径删除完成';
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message };
};

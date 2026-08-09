import type { FileToolHandler } from '../types';

export const applyWriteFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.write(op.path, op.content || '');
  ctx.addLogEntry(op, 'applied');
  ctx.publishLastFileOp(op, 'applied');
  if (ctx.filePath === op.path || !ctx.filePath) {
    ctx.setContent(op.content || '');
    ctx.setFilePath(op.path);
    ctx.setIsDirty(false);
  }
  return { ok: true, message: '写入完成' };
};

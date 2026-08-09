import type { FileToolHandler } from '../types';

export const applyListFiles: FileToolHandler = async (op, ctx) => {
  const deep = op.deep ?? false;
  const files = await ctx.fileService.listFiles(op.path, deep);
  const content = files.join('\n');
  const message = `共 ${files.length} 项`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content };
};

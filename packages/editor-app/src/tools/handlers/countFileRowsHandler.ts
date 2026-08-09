import type { FileToolHandler } from '../types';

export const applyCountFileRows: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const lineCount = data.length === 0 ? 0 : data.split(/\r?\n/).length;
  const content = String(lineCount);
  const message = `文件共 ${lineCount} 行`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content };
};

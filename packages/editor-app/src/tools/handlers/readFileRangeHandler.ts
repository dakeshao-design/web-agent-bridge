import type { FileToolHandler } from '../types';

export const applyReadFileRange: FileToolHandler = async (op, ctx) => {
  const startLine = op.start_line ?? 1;
  const endLine = op.end_line ?? startLine;
  const data = await ctx.fileService.read(op.path);
  const lines = data.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine);
  const content = slice.join('\n');
  const message = `读取第 ${startLine} 行到第 ${endLine} 行，共 ${slice.length} 行`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content };
};

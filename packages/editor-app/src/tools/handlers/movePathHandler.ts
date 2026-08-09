import type { FileToolHandler } from '../types';

export const applyMovePath: FileToolHandler = async (op, ctx) => {
  const dest = op.dest;
  if (!dest) throw new Error('缺少 dest');
  await ctx.fileService.move(op.path, dest);
  const message = `已移动到 ${dest}`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message };
};

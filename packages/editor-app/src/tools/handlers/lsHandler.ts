import { filterListedNames } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyListFiles: FileToolHandler = async (op, ctx) => {
  const deep = op.deep ?? false;
  const listed = await ctx.fileService.listFiles(op.path, deep);
  const files = filterListedNames(listed, op.filter);
  const content = files.join('\n');
  const message = `共 ${files.length} 项`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content };
};

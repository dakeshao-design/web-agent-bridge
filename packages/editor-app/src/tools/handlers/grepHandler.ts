import { runGrep } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyGrep: FileToolHandler = async (op, ctx) => {
  const result = await runGrep(ctx.fileService, op);
  ctx.addLogEntry(op, 'applied', result.message);
  ctx.publishLastFileOp(op, 'applied', result.message);
  return { ok: true, message: result.message, content: result.content };
};

import {
  buildReadFileOverLimitMessage,
  countContentLines,
} from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyReadFile: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const lineCount = countContentLines(data);
  const limit = ctx.readFileLineLimit;
  if (limit != null && limit > 0 && lineCount > limit) {
    const message = buildReadFileOverLimitMessage(lineCount, limit);
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }
  ctx.setContent(data);
  ctx.setFilePath(op.path);
  ctx.setIsDirty(false);
  const message = `读取 ${lineCount} 行， ${data.length} 字符，`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content: data };
};

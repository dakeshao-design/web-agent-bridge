import { applyEditFileReplacements } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyEditFile: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const result = applyEditFileReplacements(data, op.replacements ?? []);
  await ctx.fileService.write(op.path, result.next);
  ctx.addLogEntry(op, 'applied', result.logMessage);
  ctx.publishLastFileOp(op, 'applied', result.logMessage);
  if (ctx.filePath === op.path || !ctx.filePath) {
    ctx.setContent(result.next);
    ctx.setFilePath(op.path);
    ctx.setIsDirty(false);
  }
  return {
    ok: true,
    total_lines: result.total_lines,
    edited_range: result.edited_range,
    deleted_range: result.deleted_range,
  };
};

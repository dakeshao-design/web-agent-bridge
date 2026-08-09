import { buildEditFileRangeResultMeta } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyEditFileRange: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const lines = data.length === 0 ? [] : data.split(/\r?\n/);
  const startLine = op.start_line ?? 1;
  const endLine = Math.min(op.end_line ?? startLine, Math.max(lines.length, 1));
  if (startLine > lines.length && lines.length > 0) {
    throw new Error(`start_line ${startLine} 超出文件行数 ${lines.length}`);
  }
  const raw = op.content ?? '';
  const replacement = raw === '' ? [] : raw.split(/\r?\n/);
  const deleteCount = lines.length === 0 ? 0 : endLine - startLine + 1;
  lines.splice(startLine - 1, deleteCount, ...replacement);
  const next = lines.join('\n');
  await ctx.fileService.write(op.path, next);
  const meta = buildEditFileRangeResultMeta(
    startLine,
    endLine,
    replacement.length,
    lines.length
  );
  ctx.addLogEntry(op, 'applied', meta.logMessage);
  ctx.publishLastFileOp(op, 'applied', meta.logMessage);
  if (ctx.filePath === op.path || !ctx.filePath) {
    ctx.setContent(next);
    ctx.setFilePath(op.path);
    ctx.setIsDirty(false);
  }
  return {
    ok: true,
    total_lines: meta.total_lines,
    edited_range: meta.edited_range,
    deleted_range: meta.deleted_range,
  };
};

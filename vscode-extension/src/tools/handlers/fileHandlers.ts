import { runGrep, buildReadFileOverLimitMessage, countContentLines, buildEditFileRangeResultMeta } from '@my-agent-editor/shared';
import type { FileToolHandler } from '../types';

export const applyReadFile: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const lineCount = countContentLines(data);
  const limit = ctx.fileLineLimit;
  if (limit != null && limit > 0 && lineCount > limit) {
    const message = buildReadFileOverLimitMessage(lineCount, limit);
    ctx.addLogEntry(op, 'error', message);
    return { ok: false, message };
  }
  if (ctx.openInEditor) await ctx.openInEditor(op.path, data);
  const message = `读取 ${lineCount} 行， ${data.length} 字符`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message, content: data };
};

export const applyReadFileRange: FileToolHandler = async (op, ctx) => {
  const startLine = op.start_line ?? 1;
  const endLine = op.end_line ?? startLine;
  const data = await ctx.fileService.read(op.path);
  const lines = data.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine);
  const content = slice.join('\n');
  const message = `读取第 ${startLine} 行到第 ${endLine} 行，共 ${slice.length} 行`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message, content };
};

export const applyCountFileRows: FileToolHandler = async (op, ctx) => {
  const data = await ctx.fileService.read(op.path);
  const lineCount = data.length === 0 ? 0 : data.split(/\r?\n/).length;
  const content = String(lineCount);
  const message = `文件共 ${lineCount} 行`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message, content };
};

export const applyWriteFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.write(op.path, op.content || '');
  ctx.addLogEntry(op, 'applied');
  if (ctx.openInEditor) await ctx.openInEditor(op.path, op.content || '');
  return { ok: true, message: '写入完成' };
};

export const applyAppendFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.append(op.path, op.content || '');
  ctx.addLogEntry(op, 'applied');
  return { ok: true, message: '追加完成' };
};

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
  if (ctx.openInEditor) await ctx.openInEditor(op.path, next);
  return {
    ok: true,
    total_lines: meta.total_lines,
    edited_range: meta.edited_range,
    deleted_range: meta.deleted_range,
  };
};

export const applyDeleteFile: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.delete(op.path);
  ctx.addLogEntry(op, 'applied');
  return { ok: true, message: '删除完成' };
};

export const applyDeletePath: FileToolHandler = async (op, ctx) => {
  await ctx.fileService.deletePath(op.path);
  const message = '路径删除完成';
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message };
};

export const applyMovePath: FileToolHandler = async (op, ctx) => {
  const dest = op.dest;
  if (!dest) throw new Error('缺少 dest');
  await ctx.fileService.move(op.path, dest);
  const message = `已移动到 ${dest}`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message };
};

export const applyCopyPath: FileToolHandler = async (op, ctx) => {
  const dest = op.dest;
  if (!dest) throw new Error('缺少 dest');
  await ctx.fileService.copy(op.path, dest);
  const message = `已复制到 ${dest}`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message };
};

export const applyListFiles: FileToolHandler = async (op, ctx) => {
  const deep = op.deep ?? false;
  const files = await ctx.fileService.listFiles(op.path, deep);
  const content = files.join('\n');
  const message = `共 ${files.length} 项`;
  ctx.addLogEntry(op, 'applied', message);
  return { ok: true, message, content };
};

export const applyGrep: FileToolHandler = async (op, ctx) => {
  const result = await runGrep(ctx.fileService, op);
  ctx.addLogEntry(op, 'applied', result.message);
  return { ok: true, message: result.message, content: result.content };
};

import type { FileOperation } from '@my-agent-editor/shared';
import type { ToolApplyContext } from './types';
import { applyReadFile } from './handlers/readFileHandler';
import { applyReadFileRange } from './handlers/readFileRangeHandler';
import { applyCountFileRows } from './handlers/countFileRowsHandler';
import { applyWriteFile } from './handlers/writeFileHandler';
import { applyAppendFile } from './handlers/appendFileHandler';
import { applyEditFileRange } from './handlers/editFileRangeHandler';
import { applyDeleteFile } from './handlers/deleteFileHandler';
import { applyDeletePath } from './handlers/deletePathHandler';
import { applyMovePath } from './handlers/movePathHandler';
import { applyCopyPath } from './handlers/copyPathHandler';
import { applyListFiles } from './handlers/lsHandler';
import { applyGrep } from './handlers/grepHandler';
import { applyRunPowershell } from './handlers/runPowershellHandler';

const handlers = {
  read: applyReadFile,
  read_range: applyReadFileRange,
  count_rows: applyCountFileRows,
  write: applyWriteFile,
  append: applyAppendFile,
  edit_range: applyEditFileRange,
  delete: applyDeleteFile,
  delete_path: applyDeletePath,
  move: applyMovePath,
  copy: applyCopyPath,
  list: applyListFiles,
  grep: applyGrep,
  run_powershell: applyRunPowershell,
} as const;

export async function applyFileOperation(
  op: FileOperation,
  ctx: ToolApplyContext
) {
  const resolvedOp =
    op.action === 'list' || op.action === 'run_powershell'
      ? op
      : op.action === 'move' || op.action === 'copy'
        ? {
            ...op,
            path: ctx.resolvePath(op.path),
            dest: op.dest ? ctx.resolvePath(op.dest) : op.dest,
          }
        : { ...op, path: ctx.resolvePath(op.path) };

  try {
    return await handlers[resolvedOp.action](resolvedOp, ctx);
  } catch (err) {
    const errorMessage = String(err);
    ctx.addLogEntry(resolvedOp, 'error', errorMessage);
    ctx.publishLastFileOp(resolvedOp, 'error', errorMessage);
    return { ok: false, message: errorMessage };
  }
}

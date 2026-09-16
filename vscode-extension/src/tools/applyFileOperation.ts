import type { FileOperation } from '@my-agent-editor/shared';
import type { ToolApplyContext } from './types';
import {
  applyAppendFile,
  applyCopyPath,
  applyCountFileRows,
  applyDeleteFile,
  applyDeletePath,
  applyEditFileRange,
  applyEditFile,
  applyGrep,
  applyListFiles,
  applyMovePath,
  applyReadFile,
  applyReadFileRange,
  applyReadSkill,
  applyWriteFile,
} from './handlers/fileHandlers';
import { applyRunPowershell } from './handlers/runPowershellHandler';

const handlers = {
  read: applyReadFile,
  read_range: applyReadFileRange,
  count_rows: applyCountFileRows,
  write: applyWriteFile,
  append: applyAppendFile,
  edit_range: applyEditFileRange,
  edit: applyEditFile,
  delete: applyDeleteFile,
  delete_path: applyDeletePath,
  move: applyMovePath,
  copy: applyCopyPath,
  list: applyListFiles,
  grep: applyGrep,
  run_powershell: applyRunPowershell,
  read_skill: applyReadSkill,
} as const;

export async function applyFileOperation(op: FileOperation, ctx: ToolApplyContext) {
  const resolvedOp =
    op.action === 'list' || op.action === 'run_powershell' || op.action === 'read_skill'
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
    return { ok: false, message: errorMessage };
  }
}

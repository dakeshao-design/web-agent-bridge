import type { FileToolHandler } from '../types';

/** 按名称读取已发现的 Skill 正文 */
export const applyReadSkill: FileToolHandler = async (op, ctx) => {
  const name = op.path?.trim();
  if (!name) {
    const message = '缺少 skill 名称';
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }

  const skill = ctx.findSkill?.(name);
  if (!skill) {
    const message = `未找到 skill: ${name}`;
    ctx.addLogEntry(op, 'error', message);
    ctx.publishLastFileOp(op, 'error', message);
    return { ok: false, message };
  }

  const message = `已读取 skill ${skill.name}`;
  ctx.addLogEntry(op, 'applied', message);
  ctx.publishLastFileOp(op, 'applied', message);
  return { ok: true, message, content: skill.body };
};

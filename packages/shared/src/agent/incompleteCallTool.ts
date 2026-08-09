import { parseCallToolBlocks } from '../tools/parseCallTool.js';

/** 发现不完整后等待对话无变化再提示 */
export const INCOMPLETE_CALL_TOOL_CONFIRM_MS = 30_000;

/** 是否含未完成的 call-tool（有起始无完整 END_TOOL 解析结果） */
export function hasIncompleteCallTool(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const hasBegin =
    /BEGIN_TOOL\s*:/i.test(trimmed) || /`{3,}\s*call-tool\b/i.test(trimmed);
  if (!hasBegin) return false;

  if (parseCallToolBlocks(trimmed).length > 0) return false;

  const beginCount = (trimmed.match(/BEGIN_TOOL\s*:/gi) || []).length;
  const endCount = (trimmed.match(/\bEND_TOOL\b/gi) || []).length;
  if (beginCount > 0 && beginCount > endCount) return true;

  // 有 call-tool 围栏起始但解析不出工具
  return /`{3,}\s*call-tool\b/i.test(trimmed);
}

/**
 * candidate 是否属于最后一条 Agent 对话中的不完整调用。
 * 最后一条已完整或不含工具时视为旧块，排除。
 */
export function isIncompleteFromLastConversation(
  candidateText: string,
  lastAgentText: string | undefined | null
): boolean {
  if (!hasIncompleteCallTool(candidateText)) return false;
  const last = lastAgentText?.trim();
  if (!last) return true;
  if (last === candidateText.trim()) return true;
  // 最后对话已完整 → 不是最后对话中的截断
  if (!hasIncompleteCallTool(last)) return false;
  return true;
}

/** 截断未落盘时回传给 Agent 的提示 */
export function buildIncompleteCallToolHint(fileLineLimit?: number): string {
  const lines: string[] = [
    '[REPORT_TOOL] incomplete_call_tool',
    'status: error',
    'message: 工具调用不完整（缺少 END_TOOL 或 call-tool 未闭合），未执行、未落盘。',
  ];
  if (fileLineLimit != null && fileLineLimit > 0) {
    lines.push(
      `hint: 请按行分片重试：每段不超过 ${fileLineLimit} 行，只在换行处断开；先 write_file 写第 1 段，再多次 append_file。不要从中间 append。`
    );
  } else {
    lines.push('hint: 请重新输出完整的 call-tool 块（含 END_TOOL）。大文件请分多轮写入。');
  }
  return lines.join('\n');
}

type PendingIncomplete = {
  text: string;
  hintKey: string;
  timer: ReturnType<typeof setTimeout>;
};

export type IncompleteDiscoverOptions = {
  /** 是否为最后一条对话 */
  isLastConversation: boolean;
  /** loadingIndicator 是否显示生成中 */
  isLoading: boolean;
  alreadyReported: (hintKey: string) => boolean;
  markReported: (hintKey: string) => void;
  /** 确认前再次检查；返回 false 则放弃 */
  revalidate?: () => boolean | Promise<boolean>;
  onConfirm: (text: string) => void | Promise<void>;
  confirmMs?: number;
};

/**
 * 不完整 call-tool 延迟确认：
 * loading / 非最后对话直接跳过；发现后 confirmMs 内内容变化则取消。
 */
export class IncompleteCallToolConfirm {
  private pending = new Map<string, PendingIncomplete>();

  cancel(agentId: string): void {
    const p = this.pending.get(agentId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(agentId);
  }

  /** 对话内容变化时取消待确认（同文忽略） */
  onContentChange(agentId: string, text?: string): void {
    const p = this.pending.get(agentId);
    if (!p) return;
    if (text !== undefined && text.trim() === p.text.trim()) return;
    this.cancel(agentId);
  }

  clearAll(): void {
    for (const agentId of [...this.pending.keys()]) this.cancel(agentId);
  }

  discover(agentId: string, text: string, opts: IncompleteDiscoverOptions): void {
    if (!opts.isLastConversation || opts.isLoading) {
      this.cancel(agentId);
      return;
    }
    if (!hasIncompleteCallTool(text)) {
      this.cancel(agentId);
      return;
    }

    const hintKey = `${agentId}:incomplete:${text.length}:${text.slice(0, 64)}`;
    if (opts.alreadyReported(hintKey)) return;

    const existing = this.pending.get(agentId);
    if (existing && existing.text === text) return;

    this.cancel(agentId);
    const confirmMs = opts.confirmMs ?? INCOMPLETE_CALL_TOOL_CONFIRM_MS;
    const timer = setTimeout(() => {
      void (async () => {
        this.pending.delete(agentId);
        if (opts.alreadyReported(hintKey)) return;
        if (opts.revalidate) {
          const ok = await opts.revalidate();
          if (!ok) return;
        }
        if (!hasIncompleteCallTool(text)) return;
        opts.markReported(hintKey);
        await opts.onConfirm(text);
      })();
    }, confirmMs);

    this.pending.set(agentId, { text, hintKey, timer });
  }
}

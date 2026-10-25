import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import { getToolByAction } from '../tools/registry.js';
import { parseCallToolBlocks, stripMarkdownLineNumbers } from '../tools/parseCallTool.js';

export const SYSTEM_MARKER = '[SYSTEM]';

/** 去重匹配用识别键，不含 content 等大字段 */
const REPORT_MATCH_KEYS = [
  'path',
  'dest',
  'name',
  'command',
  'pattern',
  'start_line',
  'end_line',
] as const;

function stableStringifyArgs(args: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(args).sort()) {
    sorted[key] = args[key];
  }
  return JSON.stringify(sorted);
}

/** 解析后的工具调用指纹 */
export function fileOperationsFingerprint(operations: FileOperation[]): string {
  return operations
    .map((op) => {
      const tool = getToolByAction(op.action);
      const args = tool?.toArgs(op) ?? { path: op.path };
      return `${op.action}:${stableStringifyArgs(args)}`;
    })
    .join('\n');
}

/** 是否为工具结果回传文本 */
export function isToolResultEcho(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith(SYSTEM_MARKER)) return true;
  if (/^(ok|err|run)\s+`[^`]+`/m.test(trimmed)) return true;
  return /^工具\s*`[^`]+`\s*执行/.test(trimmed) || trimmed.includes('仍在执行。');
}

function reportMatchesOperations(region: string, operations: FileOperation[]): boolean {
  for (const op of operations) {
    const tool = getToolByAction(op.action);
    const name = tool?.name ?? op.action;
    if (!region.includes(`\`${name}\``)) return false;
    // 紧凑 ok/err/run，或旧文案「执行」
    if (!/\b(ok|err|run)\s+`/.test(region) && !region.includes('执行')) {
      return false;
    }
    const args = tool?.toArgs(op) ?? { path: op.path };
    for (const key of REPORT_MATCH_KEYS) {
      const value = args[key];
      if (!value) continue;
      if (!region.includes(`${key}: ${value}`)) return false;
    }
  }
  return true;
}

type CallSpan = { start: number; end: number; fp: string };

function collectCallSpans(normalized: string): CallSpan[] {
  const blockRe = /BEGIN_TOOL:\s*\S+\s*\n[\s\S]*?END_TOOL/gi;
  const spans: CallSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(normalized)) !== null) {
    const ops = parseCallToolBlocks(match[0]);
    if (ops.length === 0) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      fp: fileOperationsFingerprint(ops),
    });
  }
  return spans;
}

function collectMatchingReportEnds(
  normalized: string,
  operations: FileOperation[]
): number[] {
  const ends: number[] = [];
  let from = 0;
  while (from < normalized.length) {
    const idx = normalized.indexOf(SYSTEM_MARKER, from);
    if (idx < 0) break;
    const nextMarker = normalized.indexOf(SYSTEM_MARKER, idx + SYSTEM_MARKER.length);
    const nextTool = normalized.indexOf('BEGIN_TOOL:', idx + SYSTEM_MARKER.length);
    let regionEnd = normalized.length;
    if (nextMarker >= 0) regionEnd = Math.min(regionEnd, nextMarker);
    if (nextTool >= 0) regionEnd = Math.min(regionEnd, nextTool);
    const region = normalized.slice(idx, regionEnd);
    if (reportMatchesOperations(region, operations)) {
      ends.push(regionEnd);
    }
    from = idx + SYSTEM_MARKER.length;
  }
  return ends;
}

/**
 * 最近一次同指纹 call 之后是否已有匹配 [SYSTEM] 回传。
 * 仅此条件视为已报；多轮同参再调不算已报。
 */
export function isToolCallAlreadyReported(
  transcript: string,
  operations: FileOperation[]
): boolean {
  if (operations.length === 0) return false;
  const targetFp = fileOperationsFingerprint(operations);
  const normalized = stripMarkdownLineNumbers(transcript);
  const calls = collectCallSpans(normalized);
  const matchingCalls = calls.filter((c) => c.fp === targetFp);
  if (matchingCalls.length === 0) return false;

  const lastCall = matchingCalls[matchingCalls.length - 1];
  const reportEnds = collectMatchingReportEnds(normalized, operations);
  const lastReportEnd = reportEnds.length > 0 ? reportEnds[reportEnds.length - 1] : -1;

  return lastReportEnd > lastCall.end;
}

/** 定宽 index 前缀，用于比较先后 */
export function messageIndexSortKey(index: string): string {
  if (!index) return '';
  const m = index.match(/^\d+/);
  if (!m) return index.slice(0, 5);
  return m[0].slice(0, 5).padStart(5, '0');
}

/** 比较会话 messageIndex；正数表示 a 更新 */
export function compareMessageIndex(a: string, b: string): number {
  const ka = messageIndexSortKey(a);
  const kb = messageIndexSortKey(b);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
}

/** 工具执行去重键：agent + messageIndex + 块指纹 */
export function toolExecDedupeKey(
  agentId: string,
  messageIndex: string,
  opsFingerprint: string
): string {
  return `${agentId}\n${messageIndex}\n${opsFingerprint}`;
}

/**
 * waiting 结束时的兜底：loading 已 false，
 * 且 lastAgent.index > lastUser.index，且正文可解析出 call-tool。
 */
export function shouldForceStaleCallTool(input: {
  loading: boolean;
  lastAgentIndex: string | undefined | null;
  lastUserIndex: string | undefined | null;
  agentText: string | undefined | null;
  alreadyAttempted: boolean;
}): boolean {
  if (input.alreadyAttempted) return false;
  if (input.loading) return false;
  const agentIdx = input.lastAgentIndex?.trim() ?? '';
  const userIdx = input.lastUserIndex?.trim() ?? '';
  if (!agentIdx || !userIdx) return false;
  if (compareMessageIndex(agentIdx, userIdx) <= 0) return false;
  const text = input.agentText?.trim() ?? '';
  if (!text || !/BEGIN_TOOL\s*:/i.test(text)) return false;
  return parseCallToolBlocks(text).length > 0;
}

import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import { getToolByAction } from '../tools/registry.js';
import { parseCallToolBlocks, stripMarkdownLineNumbers } from '../tools/parseCallTool.js';

export const REPORT_TOOL_MARKER = '[REPORT_TOOL]';

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
  if (trimmed.startsWith(REPORT_TOOL_MARKER)) return true;
  return /^工具\s*`[^`]+`\s*执行/.test(trimmed) || trimmed.includes('仍在执行。');
}

function reportMatchesOperations(region: string, operations: FileOperation[]): boolean {
  for (const op of operations) {
    const tool = getToolByAction(op.action);
    const name = tool?.name ?? op.action;
    if (!region.includes(`\`${name}\``)) return false;
    const args = tool?.toArgs(op) ?? { path: op.path };
    for (const [key, value] of Object.entries(args)) {
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
    const idx = normalized.indexOf(REPORT_TOOL_MARKER, from);
    if (idx < 0) break;
    const nextMarker = normalized.indexOf(REPORT_TOOL_MARKER, idx + REPORT_TOOL_MARKER.length);
    const nextTool = normalized.indexOf('BEGIN_TOOL:', idx + REPORT_TOOL_MARKER.length);
    let regionEnd = normalized.length;
    if (nextMarker >= 0) regionEnd = Math.min(regionEnd, nextMarker);
    if (nextTool >= 0) regionEnd = Math.min(regionEnd, nextTool);
    const region = normalized.slice(idx, regionEnd);
    if (reportMatchesOperations(region, operations)) {
      ends.push(regionEnd);
    }
    from = idx + REPORT_TOOL_MARKER.length;
  }
  return ends;
}

/**
 * 最近一次匹配的工具请求是否已在其后的 [REPORT_TOOL] 中回传。
 * 若请求出现在最近回传之后、且中间无其它工具，视为双通道重复，也视为已回传。
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

  if (lastReportEnd > lastCall.end) return true;
  if (lastReportEnd < 0) return false;

  const between = calls.filter(
    (c) => c.start >= lastReportEnd && c.start < lastCall.start
  );
  if (between.some((c) => c.fp !== targetFp)) {
    return false;
  }
  return true;
}

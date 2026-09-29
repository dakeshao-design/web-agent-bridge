import { stripMarkdownLineNumbers } from '../tools/parseCallTool.js';
import type { ToolApplyResult } from '../tools/types.js';
import { SYSTEM_MARKER } from './fileOperationsFingerprint.js';

export type CallToolDisplayStatus = '进行中' | '成功' | '失败';

export type CallToolDisplayPart =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool';
      summary: string;
      raw: string;
      status: CallToolDisplayStatus;
      result?: string;
    };

/** 侧栏展开用精简正文：无 SYSTEM / 工具名 / 参数回显 */
export function formatCallToolDisplayResult(result: ToolApplyResult): string {
  const lines: string[] = [];
  if (!result.ok && result.message) {
    lines.push(result.message);
  }
  if (result.total_lines !== undefined) {
    lines.push(`total_lines: ${result.total_lines}`);
  }
  if (result.edited_range) {
    lines.push(`edited_range: ${result.edited_range}`);
  }
  if (result.deleted_range) {
    lines.push(`deleted_range: ${result.deleted_range}`);
  }
  if (result.more_offset !== undefined) {
    lines.push(`more_offset: ${result.more_offset}`);
  }
  if (result.content !== undefined && result.content.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(result.content);
  }
  return lines.join('\n');
}

/** 从 hint / denied 等 SYSTEM 文案抽出可读说明 */
export function formatCallToolDisplayHint(systemText: string): string {
  const lines = systemText.split(/\r?\n/);
  const out: string[] = [];
  let afterBlank = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!afterBlank && trimmed === '') {
      afterBlank = true;
      continue;
    }
    if (!afterBlank) {
      if (trimmed === SYSTEM_MARKER) continue;
      if (/^(ok|err|run)\s+`[^`]+`\s*$/i.test(trimmed)) continue;
      if (/^status:\s*/i.test(trimmed)) continue;
      const msg = trimmed.match(/^message:\s*(.*)$/i);
      if (msg) {
        out.push(msg[1]);
        continue;
      }
      const hint = trimmed.match(/^hint:\s*(.*)$/i);
      if (hint) {
        out.push(hint[1]);
        continue;
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

const OMIT_ARG = /^(content|content_b64|old_.*|new_.*)$/i;
const KEY_ARG_ORDER = [
  'path',
  'dest',
  'pattern',
  'name',
  'command',
  'start_line',
  'end_line',
];
const COMMAND_MAX = 60;

type Span = { start: number; end: number; raw: string };

/** 组装单行摘要 */
export function formatCallToolDisplayLine(
  toolName: string,
  keyArgs: string[],
  status: CallToolDisplayStatus
): string {
  const parts = ['call-tool', toolName, ...keyArgs.filter((a) => a.length > 0), status];
  return parts.join(' ');
}

/** 从工具块正文抽工具名与已闭合 ARG */
export function extractCallToolDisplayMeta(block: string): {
  toolName: string;
  keyArgs: string[];
} | null {
  const toolMatch = block.match(/BEGIN_TOOL:\s*(\S+)/i);
  if (!toolMatch) return null;
  const toolName = toolMatch[1];
  const args = parseClosedArgs(block);
  const keyArgs = pickKeyArgs(toolName, args);
  return { toolName, keyArgs };
}

function parseClosedArgs(block: string): Record<string, string> {
  const args: Record<string, string> = {};
  const argPattern = /BEGIN_ARG:\s*(\S+)\s*\n([\s\S]*?)\nEND_ARG/gi;
  let match: RegExpExecArray | null;
  while ((match = argPattern.exec(block)) !== null) {
    const name = match[1];
    if (OMIT_ARG.test(name)) continue;
    args[name] = match[2].trim();
  }
  return args;
}

function pickKeyArgs(toolName: string, args: Record<string, string>): string[] {
  const out: string[] = [];
  const used = new Set<string>();

  const push = (name: string, value: string) => {
    if (!value || used.has(name)) return;
    used.add(name);
    if (name === 'command' && value.length > COMMAND_MAX) {
      out.push(value.slice(0, COMMAND_MAX) + '…');
    } else {
      out.push(value);
    }
  };

  for (const name of KEY_ARG_ORDER) {
    if (args[name] !== undefined) push(name, args[name]);
  }
  for (const [name, value] of Object.entries(args)) {
    if (OMIT_ARG.test(name) || used.has(name)) continue;
    // 短标量才进摘要
    if (value.length > 80 || value.includes('\n')) continue;
    push(name, value);
  }

  if (toolName === 'ls' && !used.has('path')) {
    out.unshift('.');
  }

  return out;
}

/** 从 toArgs 结果生成与摘要一致的关键参数 */
export function keyArgsFromToolArgs(
  toolName: string,
  args: Record<string, string>
): string[] {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (OMIT_ARG.test(k)) continue;
    filtered[k] = v;
  }
  return pickKeyArgs(toolName, filtered);
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function addSpan(spans: Span[], next: Span): void {
  if (spans.some((s) => overlaps(s, next))) return;
  spans.push(next);
}

/** call-tool 与 BEGIN_TOOL 间去空白后字数上限；不超过则视为站点按钮区 */
const CALL_TOOL_CHROME_MAX = 20;

/**
 * 去掉紧挨工具块前的站点 UI 区：
 * 若末次出现的 call-tool 到文本末尾（BEGIN_TOOL 之前）去空白后不超过 20 字，整段清除。
 */
export function stripTrailingCallToolChrome(prefix: string): string {
  if (!prefix) return prefix;

  const re = /call-tool/gi;
  let lastIdx = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prefix)) !== null) {
    lastIdx = match.index;
  }
  if (lastIdx < 0) return prefix;

  const between = prefix.slice(lastIdx + 'call-tool'.length);
  const betweenChars = between.replace(/\s/g, '').length;
  if (betweenChars > CALL_TOOL_CHROME_MAX) return prefix;

  // 从 call-tool 所在行行首切掉
  let cut = lastIdx;
  while (cut > 0 && prefix[cut - 1] !== '\n') cut -= 1;
  return prefix.slice(0, cut).replace(/\n+$/, '');
}

/** 收集所有 call-tool / BEGIN_TOOL 展示区间 */
function collectToolSpans(text: string): Span[] {
  const spans: Span[] = [];

  // 1–2: 任意围栏；优先含 BEGIN_TOOL 或 language=call-tool
  const fenceRe = /(`{3,})([^\n`]*)\r?\n([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const lang = (m[2] || '').trim().toLowerCase();
    const body = m[3] || '';
    const isCallToolLang = /^call-tool\b/.test(lang);
    if (!isCallToolLang && !/BEGIN_TOOL\s*:/i.test(body)) continue;
    addSpan(spans, { start: m.index, end: m.index + m[0].length, raw: m[0] });
  }

  // 3: 成对 BEGIN_TOOL…END_TOOL
  const rawRe = /BEGIN_TOOL:\s*\S+\s*\n[\s\S]*?END_TOOL/gi;
  while ((m = rawRe.exec(text)) !== null) {
    addSpan(spans, { start: m.index, end: m.index + m[0].length, raw: m[0] });
  }

  // 4: 不完整 BEGIN_TOOL（无对应 END_TOOL）
  const beginRe = /BEGIN_TOOL\s*:/gi;
  while ((m = beginRe.exec(text)) !== null) {
    const start = m.index;
    if (spans.some((s) => start >= s.start && start < s.end)) continue;
    const after = text.slice(start);
    if (/\bEND_TOOL\b/i.test(after)) continue;
    // 截到下一围栏起点或文末
    const rest = text.slice(start);
    const nextFence = rest.search(/\n`{3,}/);
    const end = nextFence >= 0 ? start + nextFence : text.length;
    addSpan(spans, { start, end, raw: text.slice(start, end) });
  }

  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/**
 * 将回复拆成正文与可折叠工具片段。
 * resolveStatus 未给出时：缺 END_TOOL → 进行中，否则 → 成功。
 */
export function splitCallToolDisplayParts(
  text: string,
  resolveStatus?: (
    toolName: string,
    keyArgs: string[],
    rawSpan: string
  ) => CallToolDisplayStatus,
  resolveResult?: (
    toolName: string,
    keyArgs: string[],
    rawSpan: string
  ) => string | undefined
): CallToolDisplayPart[] {
  const normalized = stripMarkdownLineNumbers(text);
  if (!normalized) return [];

  const spans = collectToolSpans(normalized);
  if (spans.length === 0) {
    return [{ kind: 'text', text: normalized }];
  }

  const parts: CallToolDisplayPart[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      const prefix = stripTrailingCallToolChrome(normalized.slice(cursor, span.start));
      if (prefix.trim()) {
        parts.push({ kind: 'text', text: prefix });
      }
    }
    const meta = extractCallToolDisplayMeta(span.raw);
    if (!meta) {
      parts.push({ kind: 'text', text: span.raw });
    } else {
      const incomplete = !/\bEND_TOOL\b/i.test(span.raw);
      const status =
        resolveStatus?.(meta.toolName, meta.keyArgs, span.raw) ??
        (incomplete ? '进行中' : '成功');
      const result = resolveResult?.(meta.toolName, meta.keyArgs, span.raw);
      parts.push({
        kind: 'tool',
        summary: formatCallToolDisplayLine(meta.toolName, meta.keyArgs, status),
        raw: span.raw,
        status,
        ...(result ? { result } : {}),
      });
    }
    cursor = span.end;
  }

  if (cursor < normalized.length) {
    const rest = normalized.slice(cursor);
    if (rest.trim()) {
      parts.push({ kind: 'text', text: rest });
    }
  }

  return parts;
}

/** 展示状态表键：agent + 工具名 + 关键参数 */
export function callToolDisplayStatusKey(
  agentId: string,
  toolName: string,
  keyArgs: string[]
): string {
  return `${agentId}\n${toolName}\n${keyArgs.join('\n')}`;
}

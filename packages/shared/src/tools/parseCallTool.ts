import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import { parseToolCall } from './registry.js';

const CALL_TOOL_FENCED = /```call-tool\s*\n([\s\S]*?)```/gi;
const CALL_TOOL_RAW = /BEGIN_TOOL:\s*(\S+)\s*\n([\s\S]*?)END_TOOL/gi;

type NumberedLine =
  | { ok: true; n: number; content: string }
  | { ok: false };

/** 纯数字行（行号独占一行） */
function pureNumberLine(line: string): number | null {
  const m = line.match(/^\s*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** 解析同行行首编号；无编号则 ok=false */
function tryParseNumberedLine(line: string): NumberedLine {
  // 部分站点: "3." 表示内容为 "."
  let m = line.match(/^\s*(\d+)\.$/);
  if (m) return { ok: true, n: Number(m[1]), content: '.' };

  m = line.match(/^\s*(\d+)\.(.+)$/);
  if (m) return { ok: true, n: Number(m[1]), content: m[2] };

  m = line.match(/^\s*(\d+)[ \t]+(?=\S)(.*)$/);
  if (m) return { ok: true, n: Number(m[1]), content: m[2] };

  m = line.match(/^\s*(\d+)([A-Za-z_].*)$/);
  if (m) return { ok: true, n: Number(m[1]), content: m[2] };

  m = line.match(/^\s*(\d+)\s*$/);
  if (m) return { ok: true, n: Number(m[1]), content: '' };

  return { ok: false };
}

/**
 * 分行格式: 行号独占一行，下一行为内容，对间可有空行。
 * 例: "1\nBEGIN_TOOL: grep\n\n2\nBEGIN_ARG: path"
 */
function stripInterleavedLineNumbers(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const n0 = pureNumberLine(lines[i]);
    if (n0 === null || i + 1 >= lines.length) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    let j = i;
    let expected = n0;
    const contents: string[] = [];

    while (j + 1 < lines.length) {
      const n = pureNumberLine(lines[j]);
      if (n === null || n !== expected) break;
      contents.push(lines[j + 1]);
      j += 2;
      expected += 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
    }

    if (contents.length >= 2) {
      out.push(...contents);
      i = j;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }

  return out;
}

/**
 * DOM 粘连行号: "61" = 行号6 + 参数1。
 * 仅在已有实内容的连续行号列中使用，避免误伤孤立数字参数。
 */
function tryParseGluedDigitLine(
  line: string,
  expected: number
): Extract<NumberedLine, { ok: true }> | null {
  const digits = pureNumberLine(line);
  if (digits === null) return null;
  const s = String(digits);
  const p = String(expected);
  if (s.startsWith(p) && s.length > p.length) {
    return { ok: true, n: expected, content: s.slice(p.length) };
  }
  return null;
}

/** 同行格式: "1 BEGIN_TOOL" / "1BEGIN_TOOL" / "3."，连续编号至少两行 */
function stripInlineLineNumbers(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const first = tryParseNumberedLine(lines[i]);
    if (!first.ok) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const run: Extract<NumberedLine, { ok: true }>[] = [first];
    let j = i + 1;
    while (j < lines.length) {
      const expected = run[run.length - 1].n + 1;
      const next = tryParseNumberedLine(lines[j]);
      if (next.ok && next.n === expected) {
        run.push(next);
        j += 1;
        continue;
      }
      // 粘连剥离需已有实内容行
      if (run.some((r) => r.content.length > 0)) {
        const glued = tryParseGluedDigitLine(lines[j], expected);
        if (glued) {
          run.push(glued);
          j += 1;
          continue;
        }
      }
      break;
    }

    if (run.length >= 2) {
      for (const row of run) out.push(row.content);
      i = j;
    } else {
      out.push(lines[i]);
      i += 1;
    }
  }

  return out;
}

/**
 * 去除部分站点带行号的 markdown 代码块行首编号。
 * 先处理「行号独占一行」，再处理「行号与内容同行」；单行纯数字不误删。
 */
export function stripMarkdownLineNumbers(text: string): string {
  const lines = text.split('\n');
  const afterInterleaved = stripInterleavedLineNumbers(lines);
  return stripInlineLineNumbers(afterInterleaved).join('\n');
}

interface ParsedToolCall {
  toolName: string;
  args: Record<string, string>;
}

function parseToolArgs(block: string): Record<string, string> {
  const args: Record<string, string> = {};
  const argPattern = /BEGIN_ARG:\s*(\S+)\s*\n([\s\S]*?)\nEND_ARG/gi;
  let match: RegExpExecArray | null;
  while ((match = argPattern.exec(block)) !== null) {
    args[match[1]] = match[2].trim();
  }
  return args;
}

function parseToolBlock(block: string, toolName?: string): ParsedToolCall | null {
  const trimmed = block.trim();
  if (!trimmed) return null;

  let name = toolName;
  if (!name) {
    const toolMatch = trimmed.match(/BEGIN_TOOL:\s*(\S+)/i);
    if (!toolMatch) return null;
    name = toolMatch[1];
  }

  return { toolName: name, args: parseToolArgs(trimmed) };
}

function toFileOperation(call: ParsedToolCall): FileOperation | null {
  return parseToolCall(call.toolName, call.args);
}

export function parseCallToolBlocks(response: string): FileOperation[] {
  const normalized = stripMarkdownLineNumbers(response);
  const ops: FileOperation[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const fenced = new RegExp(CALL_TOOL_FENCED.source, 'gi');
  while ((match = fenced.exec(normalized)) !== null) {
    const parsed = parseToolBlock(match[1]);
    if (!parsed) continue;
    const op = toFileOperation(parsed);
    if (op && !seen.has(JSON.stringify(op))) {
      seen.add(JSON.stringify(op));
      ops.push(op);
    }
  }

  const raw = new RegExp(CALL_TOOL_RAW.source, 'gi');
  while ((match = raw.exec(normalized)) !== null) {
    const parsed = parseToolBlock(match[2], match[1]);
    if (!parsed) continue;
    const op = toFileOperation(parsed);
    if (op && !seen.has(JSON.stringify(op))) {
      seen.add(JSON.stringify(op));
      ops.push(op);
    }
  }

  return ops;
}

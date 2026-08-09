import { WORKSPACE_DATA_DIR } from '../constants.js';
import type { FileOperation } from '../interfaces/IFileOperationParser.js';
import type { IFileService } from '../interfaces/IFileService.js';

/** 检索时跳过的目录名 */
const SKIP_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  WORKSPACE_DATA_DIR,
]);

export interface GrepMatchOptions {
  pattern: string;
  regex: boolean;
  caseInsensitive: boolean;
}

export interface GrepRunResult {
  content: string;
  matchCount: number;
  truncated: boolean;
  nextOffset: number;
  message: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function basename(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function joinPath(dir: string, rel: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
  const r = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return `${d}/${r}`;
}

function displayPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function shouldSkipPath(relPath: string): boolean {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => SKIP_SEGMENTS.has(seg));
}

export function matchGlob(fileName: string, glob?: string): boolean {
  if (!glob) return true;
  const re = new RegExp(
    `^${escapeRegExp(glob).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`,
    'i'
  );
  return re.test(fileName);
}

export function matchLine(line: string, opts: GrepMatchOptions): boolean {
  const flags = opts.caseInsensitive ? 'i' : '';
  if (opts.regex) {
    return new RegExp(opts.pattern, flags).test(line);
  }
  if (opts.caseInsensitive) {
    return line.toLowerCase().includes(opts.pattern.toLowerCase());
  }
  return line.includes(opts.pattern);
}

export function grepText(
  fileLabel: string,
  text: string,
  opts: GrepMatchOptions
): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (matchLine(lines[i], opts)) {
      hits.push(`${fileLabel}:${i + 1}:${lines[i]}`);
    }
  }
  return hits;
}

async function readFileFlexible(
  fileService: IFileService,
  dir: string,
  rel: string
): Promise<string | null> {
  try {
    return await fileService.read(joinPath(dir, rel));
  } catch {
    try {
      return await fileService.read(rel);
    } catch {
      return null;
    }
  }
}

export async function runGrep(
  fileService: IFileService,
  op: FileOperation
): Promise<GrepRunResult> {
  const pattern = op.pattern ?? '';
  const headLimit = op.head_limit ?? 100;
  const offset = op.offset ?? 0;
  const fetchLimit = headLimit + 1;
  const opts: GrepMatchOptions = {
    pattern,
    regex: op.regex ?? false,
    caseInsensitive: op.case_insensitive ?? false,
  };

  let skipped = 0;
  const matches: string[] = [];

  const consume = (hit: string): boolean => {
    if (skipped < offset) {
      skipped += 1;
      return false;
    }
    matches.push(hit);
    return matches.length >= fetchLimit;
  };

  const searchFile = (label: string, text: string): boolean => {
    for (const hit of grepText(label, text, opts)) {
      if (consume(hit)) return true;
    }
    return false;
  };

  try {
    const text = await fileService.read(op.path);
    searchFile(displayPath(op.path), text);
  } catch {
    const files = await fileService.listFiles(op.path, true);
    for (const rel of files) {
      if (shouldSkipPath(rel)) continue;
      if (!matchGlob(basename(rel), op.glob)) continue;
      const text = await readFileFlexible(fileService, op.path, rel);
      if (text === null) continue;
      if (searchFile(rel.replace(/\\/g, '/'), text)) break;
    }
  }

  const truncated = matches.length > headLimit;
  const returned = truncated ? matches.slice(0, headLimit) : matches;
  const nextOffset = offset + returned.length;
  const message = truncated
    ? `已返回 ${returned.length} 条匹配（offset=${offset}），仍有更多结果。是否继续检索？继续请再次调用 grep，并设置 offset=${nextOffset}`
    : `共 ${returned.length} 处匹配`;

  return {
    content: returned.join('\n'),
    matchCount: returned.length,
    truncated,
    nextOffset,
    message,
  };
}

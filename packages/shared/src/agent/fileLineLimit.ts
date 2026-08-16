/** 从站点 bridge 脚本解析读写行限；未声明则 undefined */
export type FileLineLimits = {
  read?: number;
  write?: number;
};

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

export function parseFileLineLimitsFromBridgeScript(source: string): FileLineLimits {
  const read =
    parsePositiveInt(source.match(/\bREAD_FILE_LINE_LIMIT\s*=\s*(\d+)/)?.[1]) ??
    parsePositiveInt(source.match(/\breadFileLineLimit\s*:\s*(\d+)/)?.[1]);
  const write =
    parsePositiveInt(source.match(/\bWRITE_FILE_LINE_LIMIT\s*=\s*(\d+)/)?.[1]) ??
    parsePositiveInt(source.match(/\bwriteFileLineLimit\s*:\s*(\d+)/)?.[1]);
  return { read, write };
}

/** 与 read_file 一致的行数统计 */
export function countContentLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

export function buildReadFileOverLimitMessage(totalLines: number, limit: number): string {
  return `文件共 ${totalLines} 行，超过上限 ${limit} 行。请使用 read_file_range 分段读取。`;
}

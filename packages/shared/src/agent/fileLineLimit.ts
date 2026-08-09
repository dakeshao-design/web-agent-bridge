/** 从站点 bridge 脚本解析 FILE_LINE_LIMIT；未声明则 undefined */
export function parseFileLineLimitFromBridgeScript(source: string): number | undefined {
  const fromConst = source.match(/\bFILE_LINE_LIMIT\s*=\s*(\d+)/);
  const fromProp = source.match(/\bfileLineLimit\s*:\s*(\d+)/);
  const raw = fromConst?.[1] ?? fromProp?.[1];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/** 与 read_file 一致的行数统计 */
export function countContentLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

export function buildReadFileOverLimitMessage(totalLines: number, limit: number): string {
  return `文件共 ${totalLines} 行，超过上限 ${limit} 行。请使用 read_file_range 分段读取（可先 count_file_rows）。`;
}

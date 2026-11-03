export type FilePathReferenceInput = {
  path: string;
  startLine?: number;
  endLine?: number;
};

/** 生成填入输入框的路径引用：`path` / `path:L10` / `path:L10-20` */
export function buildFilePathReference(input: FilePathReferenceInput): string {
  const path = input.path.trim().replace(/\\/g, '/');
  if (!path) return '';
  let ref = path;
  if (input.startLine != null && input.endLine != null) {
    const start = Math.max(1, Math.min(input.startLine, input.endLine));
    const end = Math.max(1, Math.max(input.startLine, input.endLine));
    ref = start === end ? `${path}:L${start}` : `${path}:L${start}-${end}`;
  }
  return `\`${ref}\``;
}

/** 将 Base64 解码为 UTF-8 字符串 */
export function decodeBase64Utf8(b64: string): string {
  const normalized = b64.replace(/\s+/g, '');
  const Buf = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (Buf) {
    return Buf.from(normalized, 'base64').toString('utf8');
  }
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** 优先使用 content_b64，否则使用 content */
export function resolveFileContent(args: Record<string, string>): string {
  const b64 = args.content_b64?.trim();
  if (b64) {
    return decodeBase64Utf8(b64);
  }
  return args.content ?? '';
}

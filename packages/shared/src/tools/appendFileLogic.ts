/** 末尾若无换行则先补换行，再返回待追加内容 */
export function prepareAppendContent(existing: string, content: string): string {
  if (content === '') return content;
  if (existing === '' || existing.endsWith('\n')) return content;
  return `\n${content}`;
}

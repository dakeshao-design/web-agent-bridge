import type { FileOperation, IFileOperationParser } from '../interfaces/IFileOperationParser.js';

const STRUCTURED_PATTERN =
  /<!--\s*agent-editor:command\s*\n([\s\S]*?)\n\s*-->/g;

const MARKDOWN_FILE_PATTERN =
  /@file\s+(read|write|append|delete)\s+([^\s\n]+)\s*\n```[\w]*\n([\s\S]*?)```/g;

export class FileOperationParser implements IFileOperationParser {
  constructor(private commandFormat: 'structured' | 'markdown' = 'structured') {}

  parse(response: string): FileOperation[] {
    const ops: FileOperation[] = [];
    if (this.commandFormat === 'structured' || this.commandFormat === 'markdown') {
      ops.push(...this.parseStructured(response));
    }
    if (this.commandFormat === 'markdown') {
      ops.push(...this.parseMarkdown(response));
    }
    return ops;
  }

  private parseStructured(response: string): FileOperation[] {
    const ops: FileOperation[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(STRUCTURED_PATTERN.source, 'g');
    while ((match = pattern.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim()) as Partial<FileOperation>;
        if (parsed.action && parsed.path) {
          ops.push({
            action: parsed.action,
            path: parsed.path,
            content: parsed.content,
          });
        }
      } catch {
        // 忽略无效 JSON
      }
    }
    return ops;
  }

  private parseMarkdown(response: string): FileOperation[] {
    const ops: FileOperation[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(MARKDOWN_FILE_PATTERN.source, 'g');
    while ((match = pattern.exec(response)) !== null) {
      const action = match[1] as FileOperation['action'];
      const path = match[2];
      const content = match[3]?.replace(/\n$/, '');
      ops.push({ action, path, content });
    }
    return ops;
  }
}

import type { IFileOperationParser } from '../interfaces/IFileOperationParser.js';
import { parseCallToolBlocks } from '../tools/parseCallTool.js';

export class CallToolParser implements IFileOperationParser {
  parse(response: string) {
    return parseCallToolBlocks(response);
  }
}

export { stripMarkdownLineNumbers } from '../tools/parseCallTool.js';

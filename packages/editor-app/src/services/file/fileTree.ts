import { readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { isAbsolutePath, joinPath } from './pathUtils';

export interface FileTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** 文件树中隐藏的项；工作数据目录仍显示 */
export const HIDDEN_ENTRIES = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
]);

export async function listDirectoryEntries(
  dir: string,
  isAbsolute: boolean
): Promise<FileTreeEntry[]> {
  const entries = isAbsolute
    ? await readDir(dir)
    : await readDir(dir, { baseDir: BaseDirectory.AppData });

  return entries
    .filter((entry) => !HIDDEN_ENTRIES.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: joinPath(dir, entry.name),
      isDirectory: entry.isDirectory,
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

export { isAbsolutePath };

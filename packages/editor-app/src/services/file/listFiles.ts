import { readDir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { isAbsolutePath, joinPath } from './pathUtils';
import { HIDDEN_ENTRIES } from './fileTree';

async function readDirEntries(dir: string, isAbsolute: boolean) {
  return isAbsolute
    ? readDir(dir)
    : readDir(dir, { baseDir: BaseDirectory.AppData });
}

export async function listFilesInDir(
  dir: string,
  isAbsolute: boolean,
  deep: boolean
): Promise<string[]> {
  if (!deep) {
    const entries = await readDirEntries(dir, isAbsolute);
    return entries
      .filter(
        (entry) =>
          (entry.isFile || entry.isDirectory) && !HIDDEN_ENTRIES.has(entry.name)
      )
      .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  const files: string[] = [];

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const entries = await readDirEntries(currentDir, isAbsolute);
    const sorted = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    for (const entry of sorted) {
      if (HIDDEN_ENTRIES.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        files.push(rel);
        continue;
      }
      if (entry.isDirectory) {
        await walk(joinPath(currentDir, entry.name), rel);
      }
    }
  }

  await walk(dir, '');
  return files;
}

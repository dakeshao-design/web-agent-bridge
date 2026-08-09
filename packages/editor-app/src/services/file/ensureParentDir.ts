import { mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { getParentDir, isAbsolutePath } from './pathUtils';

export async function ensureParentDir(filePath: string): Promise<void> {
  const parent = getParentDir(filePath);
  if (!parent) return;

  if (isAbsolutePath(filePath)) {
    await mkdir(parent, { recursive: true });
    return;
  }
  await mkdir(parent, { recursive: true, baseDir: BaseDirectory.AppData });
}

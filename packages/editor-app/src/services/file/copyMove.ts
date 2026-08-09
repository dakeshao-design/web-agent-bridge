import {
  copyFile,
  exists,
  mkdir,
  readDir,
  rename,
  stat,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { isAbsolutePath, joinPath } from './pathUtils';
import { ensureParentDir } from './ensureParentDir';

async function pathExists(target: string, absolute: boolean): Promise<boolean> {
  return absolute
    ? exists(target)
    : exists(target, { baseDir: BaseDirectory.AppData });
}

async function ensureDestParent(dest: string): Promise<void> {
  await ensureParentDir(dest);
}

async function assertDestFree(dest: string, absolute: boolean): Promise<void> {
  if (await pathExists(dest, absolute)) {
    throw new Error(`目标已存在: ${dest}`);
  }
}

async function copyEntryRecursive(
  from: string,
  to: string,
  absolute: boolean
): Promise<void> {
  const info = absolute
    ? await stat(from)
    : await stat(from, { baseDir: BaseDirectory.AppData });

  if (info.isDirectory) {
    if (absolute) {
      await mkdir(to, { recursive: true });
    } else {
      await mkdir(to, { recursive: true, baseDir: BaseDirectory.AppData });
    }
    const entries = absolute
      ? await readDir(from)
      : await readDir(from, { baseDir: BaseDirectory.AppData });
    for (const entry of entries) {
      await copyEntryRecursive(
        joinPath(from, entry.name),
        joinPath(to, entry.name),
        absolute
      );
    }
    return;
  }

  if (absolute) {
    await copyFile(from, to);
  } else {
    await copyFile(from, to, {
      fromPathBaseDir: BaseDirectory.AppData,
      toPathBaseDir: BaseDirectory.AppData,
    });
  }
}

export async function movePathFs(from: string, to: string): Promise<void> {
  const absolute = isAbsolutePath(from) && isAbsolutePath(to);
  await assertDestFree(to, absolute);
  await ensureDestParent(to);
  if (absolute) {
    await rename(from, to);
    return;
  }
  await rename(from, to, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  });
}

export async function copyPathFs(from: string, to: string): Promise<void> {
  const absolute = isAbsolutePath(from) && isAbsolutePath(to);
  await assertDestFree(to, absolute);
  await ensureDestParent(to);
  await copyEntryRecursive(from, to, absolute);
}

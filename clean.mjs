import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const targets = [
  "packages/shared/dist",
  "packages/editor-app/dist",
  "packages/editor-app/src-tauri/target",
  "packages/editor-app/tsconfig.tsbuildinfo",
  "packages/editor-app/node_modules/.vite",
  "packages/editor-app/node_modules/.vite-temp",
];

for (const rel of targets) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.log(`skip  ${rel}`);
    continue;
  }
  rmSync(path, { recursive: true, force: true });
  console.log(`removed ${rel}`);
}

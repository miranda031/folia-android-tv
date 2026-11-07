// dev/build/clean-dist.mjs
//
// 打包前把 dist 与 android/app/src/main/assets/public 递归逐文件清空。
// 在部分 Windows 环境 / 沙箱中 fs.rmSync(dir, { recursive: true }) 会静默跳过目录内文件，
// 导致 dist/assets 与 APK assets 累积数十次历史构建的数千个冗余 chunk 文件。
// 因此这里显式深度遍历并对每个文件执行 unlinkSync。

import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = resolve(projectRoot, 'dist');
const androidPublicDir = resolve(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'public');

function cleanDirectoryContents(dir) {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += cleanDirectoryContents(fullPath);
      try {
        rmdirSync(fullPath);
      } catch {
        // ignore if directory cannot be removed
      }
    } else {
      try {
        unlinkSync(fullPath);
        removed += 1;
      } catch (err) {
        console.warn(`[clean-dist] 无法删除文件 ${fullPath}:`, err.message);
      }
    }
  }
  return removed;
}

const removedDist = cleanDirectoryContents(distDir);
console.log(`[clean-dist] 已清空 ${distDir} (${removedDist} 个文件)`);

const removedAndroid = cleanDirectoryContents(androidPublicDir);
console.log(`[clean-dist] 已清空 ${androidPublicDir} (${removedAndroid} 个文件)`);

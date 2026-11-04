// dev/build/clean-dist.mjs
//
// 打包前把 dist 清空。
//
// 为什么需要：Vite 这边的构建不会清掉上一次的产物，于是每次构建都往 dist/assets 里多留
// 一个 main-<hash>.js。留着的不只是废文件——vite-plugin-pwa 的 precache 清单是把整个
// dist 目录扫出来的，这些旧 chunk 会被一起写进 Service Worker 的预缓存里：安装包白白
// 变大，浏览器也会把这些过期代码当成离线资源留着。
//
// 手动删容易被忽略，所以放在构建前面自动跑。

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = resolve(projectRoot, 'dist');

if (existsSync(distDir)) {
    try {
        const files = readdirSync(distDir);
        for (const file of files) {
            rmSync(join(distDir, file), { recursive: true, force: true });
        }
        console.log(`[clean-dist] 已清空 ${distDir}`);
    } catch (err) {
        console.warn(`[clean-dist] 警告：清理 ${distDir} 失败：`, err.message);
    }
}


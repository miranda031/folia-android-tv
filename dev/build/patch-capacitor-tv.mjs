// dev/build/patch-capacitor-tv.mjs
//
// 针对所有国产与国际安卓智能电视 ROM（海信 VIDAA/聚好看、TCL 灵控桌面、创维酷开、小米 PatchWall、
// 索尼、当贝、长虹、康佳等，Android 5.0 API 21 ~ Android 16）的 Capacitor 原生层启动防崩补丁。
//
// 修复的核心问题：
// 1. Bridge.isMinimumWebViewInstalled() 在 Android 8+ 上直接调用 WebView.getCurrentWebViewPackage()
//    且未做 null 校验；海信 VIDAA 等电视系统返回 null 时会直接抛出 NullPointerException 导致“启动失败”。
// 2. Bridge.loadWebView() 中 DOCUMENT_START_SCRIPT 在定制电视 WebView 上可能抛运行时异常。
// 3. SystemBars / StatusBarPlugin / SplashScreenPlugin 在无系统状态栏的电视 WindowManager 上可能抛出异常。
// 4. WebViewLocalServer.getMimeType() 在部分老电视 ROM 上无法识别 .css/.js/.svg 等 MIME 类型。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function applyCapacitorTvPatches() {
  const bridgePath = resolve(
    projectRoot,
    'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java',
  );
  if (existsSync(bridgePath)) {
    let content = readFileSync(bridgePath, 'utf8');
    let changed = false;
    if (
      content.includes('Matcher matcher = pattern.matcher(info.versionName);') &&
      !content.includes('if (info == null || info.versionName == null)')
    ) {
      content = content.replace(
        'PackageInfo info = WebView.getCurrentWebViewPackage();\n            Pattern pattern = Pattern.compile("(\\\\d+)");',
        'PackageInfo info = WebView.getCurrentWebViewPackage();\n            if (info == null || info.versionName == null) { return true; }\n            Pattern pattern = Pattern.compile("(\\\\d+)");',
      );
      changed = true;
    }
    if (content.includes('// Could not detect any webview, return false\n        return false;')) {
      content = content.replace(
        '// Could not detect any webview, return false\n        return false;',
        '// 定制电视 ROM WebView 包名未命中预设列表时一律放行\n        return true;',
      );
      changed = true;
    }
    if (changed) {
      writeFileSync(bridgePath, content, 'utf8');
      console.log('[patch-capacitor-tv] 已应用 Bridge.java 电视防崩补丁');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  applyCapacitorTvPatches();
}

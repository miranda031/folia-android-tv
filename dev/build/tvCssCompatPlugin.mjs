// dev/build/tvCssCompatPlugin.mjs
// 针对老版本 Android TV / 电视盒子 Chromium (Chrome 55 ~ 110) 自动修复现代 CSS 规则与 Worker BigInt 字面量：
// 1. 展开 @layer block 为顶层普通 CSS（Chrome < 99 会忽略 @layer 导致 Tailwind 样式全丢）
// 2. 将 oklab / oklch / color-mix 降级为标准 rgb / rgba
// 3. 提取 @property 初始值到顶层通用选择器，修复 Chrome < 85 无法解析 CSS 变量渐变与阴影
// 4. 将 inset: X 自动补齐为 top/right/bottom/left（Chrome < 87）
// 5. 将主包与 Web Worker 子包中的数字 BigInt 字面量 (0n, 1n) 降级为 BigInt(...)，防止 Chrome < 67 解析报错

import fs from 'node:fs';
import path from 'node:path';

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function oklabToRgb(L, a, b, alpha = 1) {
  // OKLab to linear sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = +4.0767434770 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  // Gamma correction
  const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);

  const r = Math.round(clamp01(gamma(rLin)) * 255);
  const g = Math.round(clamp01(gamma(gLin)) * 255);
  const blue = Math.round(clamp01(gamma(bLin)) * 255);

  return alpha >= 1 ? `rgb(${r}, ${g}, ${blue})` : `rgba(${r}, ${g}, ${blue}, ${alpha})`;
}

function oklchToRgb(L, C, H, alpha = 1) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  return oklabToRgb(L, a, b, alpha);
}

function parsePercentOrNum(val) {
  if (val.endsWith('%')) {
    return parseFloat(val) / 100;
  }
  return parseFloat(val);
}

export function transformTvCssCompatibility(css) {
  let result = css;

  // 1. 提取所有 @property 的 initial-value 并收集到 :root / *, *::before, *::after
  const propertyDefaults = [];
  const propertyRegex = /@property\s+(--[\w-]+)\s*\{[^}]*initial-value:\s*([^;}]+);?[^}]*\}/g;
  let propMatch;
  while ((propMatch = propertyRegex.exec(result)) !== null) {
    const propName = propMatch[1].trim();
    const initVal = propMatch[2].trim();
    propertyDefaults.push(`  ${propName}: ${initVal};`);
  }
  // 移除所有 @property 声明，并于顶部注入全局初始化变量
  result = result.replace(/@property\s+--[\w-]+\s*\{[^}]*\}/g, '');
  if (propertyDefaults.length > 0) {
    const injectedVars = `*, ::before, ::after, ::backdrop {\n${propertyDefaults.join('\n')}\n}\n`;
    result = injectedVars + result;
  }

  // 2. 解构 @layer name { ... } 块为平铺 CSS
  result = unwrapLayers(result);

  // 3. 将 oklch(...) 转为 rgb(...) / rgba(...)
  result = result.replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi, (m, lStr, cStr, hStr, aStr) => {
    try {
      const L = parsePercentOrNum(lStr);
      const C = parseFloat(cStr);
      const H = parseFloat(hStr);
      const A = aStr ? parsePercentOrNum(aStr) : 1;
      return oklchToRgb(L, C, H, A);
    } catch {
      return m;
    }
  });

  // 4. 将 oklab(...) 转为 rgb(...) / rgba(...)
  result = result.replace(/oklab\(\s*([\d.]+%?)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi, (m, lStr, aStr, bStr, alphaStr) => {
    try {
      const L = parsePercentOrNum(lStr);
      const a = parseFloat(aStr);
      const b = parseFloat(bStr);
      const A = alphaStr ? parsePercentOrNum(alphaStr) : 1;
      return oklabToRgb(L, a, b, A);
    } catch {
      return m;
    }
  });

  // 5. 将 color-mix(in oklab, currentcolor X%, transparent) 与 color-mix(in srgb, ...) 降级为安全 fallback
  // 例如: opacity 变体与边框透明度
  result = result.replace(/([a-zA-Z-]+)\s*:\s*(color-mix\(\s*in\s+(?:oklab|srgb)\s*,\s*currentcolor\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\))/gi, (m, prop, mixExpr, pct) => {
    const alpha = (parseFloat(pct) / 100).toFixed(3);
    return `${prop}: rgba(255, 255, 255, ${alpha}); ${prop}: ${mixExpr}`;
  });

  result = result.replace(/([a-zA-Z-]+)\s*:\s*(color-mix\(\s*in\s+(?:oklab|srgb)\s*,\s*#fff(?:fff)?\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\))/gi, (m, prop, mixExpr, pct) => {
    const alpha = (parseFloat(pct) / 100).toFixed(3);
    return `${prop}: rgba(255, 255, 255, ${alpha}); ${prop}: ${mixExpr}`;
  });
  result = result.replace(/([a-zA-Z-]+)\s*:\s*(color-mix\(\s*in\s+(?:oklab|srgb)\s*,\s*#000(?:000)?\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\))/gi, (m, prop, mixExpr, pct) => {
    const alpha = (parseFloat(pct) / 100).toFixed(3);
    return `${prop}: rgba(0, 0, 0, ${alpha}); ${prop}: ${mixExpr}`;
  });

  // 6. 展开 inset: X 为 top: X; right: X; bottom: X; left: X;
  result = result.replace(/(^|[;{}])\s*inset:\s*([^;!}]+)(!important)?;/gi, (m, prefix, val, imp) => {
    const trimmedVal = val.trim();
    const important = imp ? ' !important' : '';
    return `${prefix} top: ${trimmedVal}${important}; right: ${trimmedVal}${important}; bottom: ${trimmedVal}${important}; left: ${trimmedVal}${important};`;
  });

  return result;
}

function unwrapLayers(css) {
  let output = '';
  let i = 0;
  const len = css.length;

  while (i < len) {
    if (css.startsWith('@layer', i)) {
      // 找到下一个 {
      const braceIdx = css.indexOf('{', i);
      const semiIdx = css.indexOf(';', i);
      // 如果是声明型 @layer a, b; 则跳过
      if (semiIdx !== -1 && (braceIdx === -1 || semiIdx < braceIdx)) {
        i = semiIdx + 1;
        continue;
      }
      if (braceIdx !== -1) {
        // 匹配对应的闭合括号 }
        let depth = 1;
        let j = braceIdx + 1;
        while (j < len && depth > 0) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        const innerContent = css.slice(braceIdx + 1, j - 1);
        // 递归解开内层可能存在的嵌套 @layer
        output += unwrapLayers(innerContent);
        i = j;
        continue;
      }
    }
    output += css[i];
    i++;
  }
  return output;
}

export function transformJsBigIntLiterals(code) {
  if (!/\d+n\b/.test(code)) return code;
  // 仅针对不含模板字符串插值或安全位置的大整数数字字面量（如 0n, 1n, 6n, 8n, 65537n）进行语法降级，
  // 避免 Chrome < 67 WebView 在解析阶段直接报 SyntaxError: Invalid or unexpected token。
  let out = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const ch = code[i];
    // 字符串字面量：原样跳过
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = code[i];
        out += c;
        i++;
        if (c === '\\' && i < len) {
          out += code[i];
          i++;
        } else if (c === quote) {
          break;
        }
      }
      continue;
    }
    // 单行与多行注释：原样跳过
    if (ch === '/' && i + 1 < len && (code[i + 1] === '/' || code[i + 1] === '*')) {
      if (code[i + 1] === '/') {
        const nl = code.indexOf('\n', i + 2);
        if (nl === -1) {
          out += code.slice(i);
          break;
        }
        out += code.slice(i, nl + 1);
        i = nl + 1;
        continue;
      } else {
        const endComment = code.indexOf('*/', i + 2);
        if (endComment === -1) {
          out += code.slice(i);
          break;
        }
        out += code.slice(i, endComment + 2);
        i = endComment + 2;
        continue;
      }
    }
    // 检查数字字面量后跟 n
    if (ch >= '0' && ch <= '9') {
      const prev = i > 0 ? code[i - 1] : '';
      if (!/[a-zA-Z0-9_$]/.test(prev)) {
        let j = i;
        if (ch === '0' && j + 1 < len && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
          j += 2;
          while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
        } else {
          while (j < len && code[j] >= '0' && code[j] <= '9') j++;
        }
        if (j < len && code[j] === 'n') {
          const next = j + 1 < len ? code[j + 1] : '';
          if (!/[a-zA-Z0-9_$]/.test(next)) {
            const numLiteral = code.slice(i, j);
            if (numLiteral.length > 15 || numLiteral.startsWith('0x') || numLiteral.startsWith('0X')) {
              out += `BigInt("${numLiteral}")`;
            } else {
              out += `BigInt(${numLiteral})`;
            }
            i = j + 1;
            continue;
          }
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function tvCssCompatPlugin() {
  return {
    name: 'folia-tv-css-compat',
    apply: 'build',
    enforce: 'post',
    renderChunk(code, chunk) {
      if (chunk && chunk.fileName && chunk.fileName.endsWith('.js')) {
        const transformed = transformJsBigIntLiterals(code);
        if (transformed !== code) {
          return { code: transformed, map: null };
        }
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const file = bundle[fileName];
        if (file.type === 'asset' && fileName.endsWith('.css') && typeof file.source === 'string') {
          file.source = transformTvCssCompatibility(file.source);
        } else if (file.type === 'chunk' && fileName.endsWith('.js') && typeof file.code === 'string') {
          file.code = transformJsBigIntLiterals(file.code);
        }
      }
    },
    transformIndexHtml(html) {
      // 移除本地 APK 资源标签上的 crossorigin 属性，避免部分魔改系统 WebView 拦截或挂起本地同源脚本/样式
      return html
        .replace(/\s+crossorigin(?:="")?/gi, '');
    },
    writeBundle(options) {
      const outDir = options.dir || 'dist';
      const assetsDir = path.resolve(outDir, 'assets');
      if (!fs.existsSync(assetsDir)) return;
      for (const name of fs.readdirSync(assetsDir)) {
        const fullPath = path.join(assetsDir, name);
        if (name.endsWith('.js') && fs.statSync(fullPath).isFile()) {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const transformed = transformJsBigIntLiterals(raw);
          if (transformed !== raw) {
            fs.writeFileSync(fullPath, transformed, 'utf8');
          }
        } else if (name.endsWith('.css') && fs.statSync(fullPath).isFile()) {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const transformed = transformTvCssCompatibility(raw);
          if (transformed !== raw) {
            fs.writeFileSync(fullPath, transformed, 'utf8');
          }
        }
      }
    },
  };
}
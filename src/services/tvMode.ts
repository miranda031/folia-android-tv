// src/services/tvMode.ts
//
// 电视模式：把桌面/手机版界面重构为符合 10-foot 客厅观看与纯遥控器交互的电视体验。
//
// 判定见 platform/runtime 的 isAndroidTv（原生打在 UA 上的 "FoliaTV" 标记）：
//   1. 舒适字号：1920x1080 / density 320 下 CSS 视口为 960x540，根字号 15px 对应物理 30px，
//      2~3 米外清晰锐利，同时保证双栏主题工坊、设置面板与弹窗不挤压溢出。
//   2. 彻底隐藏鼠标指针并加粗滚动条。
//   3. 关闭高开销的全屏/多层 CSS backdrop-filter 高斯模糊（电视芯片 GPU 杀手），改用高对比度深色/浅色半透面板，
//      确保 60Hz VSync 焦点滑动与动画零掉帧。
//   4. 全覆盖遥控器焦点环：支持编程式 .focus()（不仅限 :focus-visible），覆盖所有快捷菜单、下拉框（data-active）、
//      分段胶囊（st-focus-inside）、工具气泡、命令面板、Bravais 书库墙磁贴与折叠侧栏恢复手柄。

import { isAndroidTv } from '../platform/runtime';

const TV_ROOT_FONT_SIZE = '15px';

const TV_STYLE_ID = 'folia-tv-mode';

const TV_STYLES = `
html.folia-tv { font-size: ${TV_ROOT_FONT_SIZE}; }

/* 全局彻底隐藏鼠标和手型指针 */
html.folia-tv,
html.folia-tv * {
    cursor: none !important;
}

/* 电视端禁用高开销 CSS 实时背景模糊，释放 Mali/嵌入式 GPU 带宽给 60fps UI 与动效 */
html.folia-tv *,
html.folia-tv *::before,
html.folia-tv *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}

/* 去模糊后面板与快捷菜单保持高可读性与高级层次感 */
html.folia-tv .theme-glass-panel {
    background-color: rgba(18, 20, 26, 0.92) !important;
}
html.folia-tv [data-testid="unified-panel-surface"] {
    background-color: rgba(16, 18, 24, 0.95) !important;
}
html.folia-tv .lattice-tools-panel {
    background-color: rgba(18, 20, 26, 0.96) !important;
}
html.folia-tv .lattice-tools.is-daylight .lattice-tools-panel {
    background-color: rgba(250, 250, 249, 0.97) !important;
}

html.folia-tv ::-webkit-scrollbar { width: 10px; height: 10px; }
html.folia-tv ::-webkit-scrollbar-thumb { border-radius: 5px; background-color: rgba(255, 255, 255, 0.28); }

/* 内容区及大容器默认不绘制焦点框 */
html.folia-tv [data-tv-content]:focus,
html.folia-tv [data-folia-settings-content]:focus,
html.folia-tv [data-folia-settings-panel]:focus,
html.folia-tv [data-folia-studio-window]:focus,
html.folia-tv [data-folia-themed-dialog]:focus,
html.folia-tv [data-folia-keyboard-window]:focus,
html.folia-tv [data-tv-grid-surface]:focus,
html.folia-tv .lattice-field:focus {
    outline: none !important;
    box-shadow: none !important;
    transform: none !important;
}

/* 现代 10-foot 电视 UI 通用外扩焦点环：覆盖编程式 .focus() 与原生焦点 */
html.folia-tv [data-tv-nav]:not(.st-focus-inside):not([data-tv-nav="settings-row-link"]):focus,
html.folia-tv [data-folia-player-bar-play]:focus,
html.folia-tv [data-explore-card]:focus,
html.folia-tv button:not([tabindex="-1"]):not(.st-focus-inside):not(.bravais-seam-tab):not([data-tv-nav="settings-row-link"]):focus,
html.folia-tv select:focus,
html.folia-tv [role="button"]:not([tabindex="-1"]):not(.st-focus-inside):focus,
html.folia-tv [role="tab"]:not(.st-focus-inside):focus,
html.folia-tv [role="radio"]:not(.st-focus-inside):focus,
html.folia-tv [role="combobox"]:focus,
html.folia-tv [role="listbox"]:focus,
html.folia-tv [role="option"]:focus,
html.folia-tv [role="menuitem"]:not(.st-focus-inside):focus,
html.folia-tv [role="menuitemcheckbox"]:not(.st-focus-inside):focus,
html.folia-tv [role="menuitemradio"]:not(.st-focus-inside):focus,
html.folia-tv [role="switch"]:not(.st-focus-inside):focus,
html.folia-tv [role="checkbox"]:not(.st-focus-inside):focus,
html.folia-tv [tabindex="0"]:not([data-tv-content]):not([data-folia-settings-content]):not(.st-focus-inside):focus {
    outline: none !important;
    box-shadow: 0 0 0 2.5px rgba(255, 255, 255, 0.96),
                0 0 0 4.5px rgba(0, 0, 0, 0.55),
                0 0 18px 2px rgba(255, 255, 255, 0.34),
                0 8px 24px rgba(0, 0, 0, 0.55) !important;
    transform: scale(1.025) translateZ(0) !important;
    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                background-color 0.12s ease !important;
    z-index: 30 !important;
}

/* Row 整行入口按钮（如「打开主题工坊」「歌词动效调整」）：仅隐藏铺满整行的隐形触发层本身，高亮外层 .st-row */
html.folia-tv button[data-tv-nav="settings-row-link"]:focus {
    outline: none !important;
    box-shadow: none !important;
    transform: none !important;
}
html.folia-tv .st-row:has(> button[data-tv-nav="settings-row-link"]:focus) {
    border-radius: 10px !important;
    background-color: rgba(255, 255, 255, 0.14) !important;
    box-shadow: inset 0 0 0 2.5px rgba(255, 255, 255, 0.96),
                0 0 18px 2px rgba(255, 255, 255, 0.3) !important;
    z-index: 25 !important;
}

/* 快捷菜单、分段器、步进器、工具气泡与侧缝内嵌控件（父容器常带 overflow:hidden，采用双层高对比内嵌光标，绝不裁切） */
html.folia-tv .st-focus-inside:not([data-tv-nav="settings-row-link"]):focus,
html.folia-tv .st-pop button:focus,
html.folia-tv .st-pop [role="menuitem"]:focus,
html.folia-tv .st-pop [role="option"]:focus,
html.folia-tv .lattice-tools-panel button:focus,
html.folia-tv [data-bravais-seam-menu] button:focus,
html.folia-tv .bravais-seam button:focus {
    outline: none !important;
    box-shadow: inset 0 0 0 2.5px rgba(255, 255, 255, 0.98),
                inset 0 0 0 4.5px rgba(0, 0, 0, 0.58),
                0 0 14px rgba(255, 255, 255, 0.32) !important;
    background-color: color-mix(in srgb, var(--st-accent, var(--text-accent, #ffffff)) 26%, rgba(255, 255, 255, 0.18)) !important;
    transform: none !important;
    position: relative;
    z-index: 32 !important;
}

/* CustomSelect 下拉菜单与命令面板列表的高亮游标（仅当焦点留在触发器或搜索输入框时显示虚拟高亮，避免与真实聚焦按钮出现双光标） */
html.folia-tv [role="option"][data-active="true"],
html.folia-tv [data-testid="command-palette-panel"]:has(input:focus) [data-tv-command-active="true"] {
    outline: none !important;
    box-shadow: inset 0 0 0 2.5px rgba(255, 255, 255, 0.98),
                inset 0 0 0 4.5px rgba(0, 0, 0, 0.55),
                0 0 14px rgba(255, 255, 255, 0.28) !important;
    background-color: color-mix(in srgb, var(--text-accent, #ffffff) 26%, rgba(255, 255, 255, 0.2)) !important;
}

/* Bravais 书库墙磁贴键盘焦点环（仅在墙体 .bravais-field 真正持有焦点时亮起醒目白框，进入侧栏/弹窗后自动退隐，杜绝双光标干扰） */
html.folia-tv .bravais-field:focus .bravais-tile.is-focused > .bravais-tile-face:not(.is-wall):not(.is-expanded) {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.98),
                0 0 0 5px rgba(0, 0, 0, 0.62),
                0 0 24px 4px rgba(255, 255, 255, 0.38),
                0 14px 32px rgba(0, 0, 0, 0.7) !important;
}

/* 墙面右下角快捷工具面板：在电视端关闭高开销高斯模糊后改为高对比不透明深浅色底板，提升层级与可读性 */
html.folia-tv .lattice-tools {
    z-index: 65 !important;
}
html.folia-tv .lattice-tools-panel {
    background: rgba(18, 20, 26, 0.96) !important;
    border-color: rgba(255, 255, 255, 0.18) !important;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.86) !important;
    backdrop-filter: none !important;
}
html.folia-tv .lattice-tools.is-daylight .lattice-tools-panel {
    background: rgba(248, 248, 250, 0.96) !important;
    border-color: rgba(0, 0, 0, 0.14) !important;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24) !important;
}

/* Bravais 聚焦展开卡内的文字链接按钮（歌手 / 专辑）聚焦态 */
html.folia-tv .bravais-focus-links button:focus {
    border-radius: 6px !important;
    padding: 2px 6px !important;
    background-color: rgba(255, 255, 255, 0.2) !important;
}

/* Bravais 书库墙菜单缩小/收起后的屏幕边缘恢复手柄：放大触控/视觉尺寸并保留垂直居中 translateY(-50%) */
html.folia-tv .bravais-seam-tab {
    z-index: 45 !important;
    padding: 16px 11px !important;
    font-size: 14px !important;
    font-weight: 800 !important;
    border: 1.5px solid rgba(255, 255, 255, 0.36) !important;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(0, 0, 0, 0.4) !important;
}
html.folia-tv .bravais-root.is-daylight .bravais-seam-tab {
    border-color: rgba(0, 0, 0, 0.28) !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22) !important;
}
html.folia-tv .bravais-seam-tab:focus {
    outline: none !important;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.98),
                0 0 0 5px rgba(0, 0, 0, 0.62),
                0 0 24px 4px rgba(255, 255, 255, 0.45),
                0 10px 30px rgba(0, 0, 0, 0.75) !important;
    transform: translateY(-50%) scale(1.06) translateZ(0) !important;
    background-color: color-mix(in srgb, var(--text-accent, #ffffff) 28%, var(--bravais-seam-paper, #18181b)) !important;
}

/* 左下角全局搜索/命令快捷按钮在电视端提高静止辨识度，并在 Bravais 书库墙下沉到底栏安全区避免遮挡信息条「列表」按钮 */
html.folia-tv [data-folia-command-palette-button="true"] {
    width: 46px !important;
    height: 46px !important;
    border-color: rgba(255, 255, 255, 0.28) !important;
    background-color: rgba(16, 18, 24, 0.84) !important;
    color: rgba(255, 255, 255, 0.92) !important;
}
html.folia-tv body:has([data-library-stage="bravais"][data-bravais-active]) [data-folia-command-palette-button="true"] {
    bottom: 24px !important;
    left: 20px !important;
}

/* 探索页卡片 */
html.folia-tv [data-explore-card]:focus {
    border-radius: 14px !important;
    transform: scale(1.035) translateY(-2px) translateZ(0) !important;
}

/* 3D 封面轨道卡片 */
html.folia-tv [data-tv-nav="card"]:focus,
html.folia-tv [data-grid3d-index]:focus {
    outline: none !important;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.96),
                0 0 26px 4px rgba(255, 255, 255, 0.38),
                0 14px 32px rgba(0, 0, 0, 0.72) !important;
    transform: scale(1.055) translateY(-4px) translateZ(0) !important;
    border-radius: 1rem !important;
    z-index: 40 !important;
}

/* 顶部导航、底部胶囊与控制圆钮保持胶囊形态 */
html.folia-tv [data-tv-nav="tab"]:focus,
html.folia-tv [data-tv-nav="settings"]:focus,
html.folia-tv [data-tv-nav="search"]:focus,
html.folia-tv [data-tv-nav="palette"]:focus,
html.folia-tv [data-tv-nav="player-bar"]:focus,
html.folia-tv [data-tv-nav="account-switcher"]:focus,
html.folia-tv [data-tv-nav="back-to-player"]:focus {
    border-radius: 9999px !important;
}

/* 「正在播放」浮窗圆角跟随 */
html.folia-tv [data-tv-nav="now-playing"]:focus {
    border-radius: 1rem !important;
}

/* 设置侧边栏项目：高光背景 + 纯白文字 + 贴合圆角 */
html.folia-tv aside button[data-tv-nav="settings-side"]:focus,
html.folia-tv [data-folia-settings-panel] aside button:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.92),
                0 0 14px 2px rgba(255, 255, 255, 0.28) !important;
    background-color: rgba(255, 255, 255, 0.18) !important;
    color: #ffffff !important;
    transform: scale(1.015) translateZ(0) !important;
    border-radius: 8px !important;
}

/* 滑块（音量、进度条、主题色相/饱和度/明度）聚焦高亮 */
html.folia-tv input[type="range"]:not([data-tv-nav="player-progress"]):focus,
html.folia-tv input[type="range"]:not([data-tv-nav="player-progress"]):focus-visible,
html.folia-tv [data-folium-part="progress.track"]:has(> input[type="range"]:focus) {
    outline: none !important;
    box-shadow: 0 0 0 2.5px rgba(255, 255, 255, 0.95),
                0 0 14px 2px rgba(255, 255, 255, 0.32) !important;
    border-radius: 9999px !important;
}
html.folia-tv [data-folium-part="progress.track"]:has(> input[type="range"]:focus) {
    height: 8px !important;
}

/* 文本输入框聚焦样式 */
html.folia-tv input:not([type="range"]):focus,
html.folia-tv textarea:focus {
    outline: none !important;
    box-shadow: 0 0 0 2.5px rgba(255, 255, 255, 0.95),
                0 0 0 4.5px rgba(0, 0, 0, 0.55),
                0 0 14px rgba(255, 255, 255, 0.28) !important;
    border-radius: 8px !important;
}

/* 设置弹窗双栏布局适配 960x540 CSS 视口，留足呼吸边距 */
html.folia-tv [data-folia-settings-panel="true"] {
    width: min(94vw, 900px) !important;
    max-width: min(94vw, 900px) !important;
    height: 90vh !important;
    max-height: 90vh !important;
    box-shadow: 0 32px 84px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
}

/* 省电流畅档（lite）下进一步精简非必要阴影过渡开销 */
html.folia-tv[data-tv-perf-tier="lite"] [data-tv-nav]:focus,
html.folia-tv[data-tv-perf-tier="lite"] button:focus {
    transition: none !important;
}

/* 系统强制高对比度模式（Forced Colors）轮廓线回退 */
@media (forced-colors: active) {
    html.folia-tv :focus,
    html.folia-tv [role="option"][data-active="true"],
    html.folia-tv [data-tv-command-active="true"] {
        outline: 2px solid Highlight !important;
        outline-offset: -2px !important;
    }
}
`;

export const installTvMode = (): boolean => {
    if (typeof document === 'undefined') return false;
    if (!isAndroidTv()) return false;
    document.documentElement.classList.add('folia-tv');
    if (!document.getElementById(TV_STYLE_ID)) {
        const style = document.createElement('style');
        style.id = TV_STYLE_ID;
        style.textContent = TV_STYLES;
        document.head.appendChild(style);
    }
    return true;
};

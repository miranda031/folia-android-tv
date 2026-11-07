// src/services/tvNavigationEngine.ts
//
// 全局统一电视遥控器导航引擎（Android TV D-Pad Spatial & Layered Navigation Engine）。
//
// 按真实视觉层级（从最顶层浮层到底层视图）严格分发方向键与返回键，彻底杜绝底层页面或父级弹窗
// 抢夺子弹窗（如主题工坊、歌词工作台、登录弹窗、下拉框、快捷调色器）焦点的冲突。

import { isTextEntryTarget } from '../utils/keyboardTargets';
import { useBravaisSeamStore } from '../library/suites/bravais/bravaisSeamLevel';
import { useBravaisUiStore } from '../library/suites/bravais/bravaisUiStore';
import { setIsPanelOpen, useAppViewStore } from '../stores/useAppViewStore';
import { useCollectionNavigationStore } from '../stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useExitModalStore } from '../stores/useExitModalStore';
import {
    activateTvElement,
    collectTvFocusables,
    findTvFocusTarget,
    focusTvElement,
    isTvFocusableVisible,
    tvDirectionOf,
    type TvDirection,
} from '../utils/tvSpatialFocus';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
let isSyntheticBravaisSeed = false;

/** 触发 React 受控与非受控 <input type="range"> 均能识别的步进更新。 */
export function stepRangeInput(input: HTMLInputElement, deltaDirection: -1 | 1): boolean {
    if (input.disabled) return false;
    const prev = input.value;
    if (deltaDirection < 0) {
        input.stepDown();
    } else {
        input.stepUp();
    }
    const next = input.value;
    if (next === prev) return false;

    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeValueSetter) {
        nativeValueSetter.call(input, prev);
        nativeValueSetter.call(input, next);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

/** 查询 DOM 中可见且未处于 inert 状态的最后一个（即最顶层 Portal）匹配节点。 */
function queryTopmostVisible(selector: string): HTMLElement | null {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (node.closest('[inert], [aria-hidden="true"]')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        return node;
    }
    return null;
}

/**
 * 判断当前聚焦控件是否应该将特定方向键交还给组件自身（如 Tabs 左右切换、PictureGrid 网格内走位、
 * PlatformColumn 纵向列表上下移动、input[type="range"] 左右调节）。
 *
 * 返回：
 * - `'pass-through'`：不拦截，交给组件自身的 React onKeyDown 处理；
 * - `'handled'`：已在此处完成处理（例如滑块步进），外层无需再做空间导航；
 * - `'spatial'`：应由外层在容器内执行空间几何寻路。
 */
function resolveWidgetKeyBehavior(
    active: HTMLElement | null,
    key: string,
    event: KeyboardEvent,
): 'pass-through' | 'handled' | 'spatial' {
    if (!active) return 'spatial';

    // 1. 滑块：左右键步进数值，上下键交给空间导航离开滑块
    if (active instanceof HTMLInputElement && active.type === 'range') {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            stepRangeInput(active, key === 'ArrowLeft' ? -1 : 1);
            return 'handled';
        }
        return 'spatial';
    }

    // 2. 文本输入框：左右键留给光标移动，上下键在电视端允许平滑脱离输入框前往相邻控件
    if (isTextEntryTarget(active)) {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            return 'pass-through';
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            active.blur();
            return 'spatial';
        }
        return 'pass-through';
    }

    // 3. 自管理焦点的 Listbox（如登录窗口左侧平台列表 PlatformColumn）
    if (active.matches('[role="listbox"][tabindex="0"]')) {
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            return 'pass-through';
        }
        return 'spatial';
    }

    // 4. Tabs 条（StudioWindow / Sheet 顶部的横向页签）：左右键由 Tabs 自身循环切换并激活
    if (active.closest('[role="tablist"]') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        return 'pass-through';
    }

    // 5. PictureGrid（歌词样式、字体、背景缩略图网格）：只要目标方向仍在网格内，交给 PictureGrid 自身处理
    const radioGroup = active.closest<HTMLElement>('[role="radiogroup"]');
    if (radioGroup && active.hasAttribute('data-value')) {
        const tiles = Array.from(radioGroup.querySelectorAll<HTMLElement>('[data-value]'));
        const idx = tiles.indexOf(active);
        if (idx >= 0 && tiles.length > 0) {
            const templateCols = window.getComputedStyle(radioGroup).gridTemplateColumns;
            const cols = Math.max(1, templateCols ? templateCols.trim().split(/\s+/).length : 1);
            const last = tiles.length - 1;
            if (key === 'ArrowLeft' && idx > 0) return 'pass-through';
            if (key === 'ArrowRight' && idx < last) return 'pass-through';
            if (key === 'ArrowUp' && idx >= cols) return 'pass-through';
            if (key === 'ArrowDown' && Math.floor(idx / cols) < Math.floor(last / cols)) return 'pass-through';
        }
    }

    return 'spatial';
}

/** 查找元素在指定边界容器内部最近的可纵向滚动祖先（如 UnifiedPanel 的 ControlsTab/PlaylistTab、StudioWindow 右侧参数栏）。 */
function findInnerScrollableAncestor(el: HTMLElement, boundary: HTMLElement): HTMLElement | null {
    let curr: HTMLElement | null = el.parentElement;
    while (curr && curr !== boundary && boundary.contains(curr)) {
        const style = window.getComputedStyle(curr);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && curr.scrollHeight > curr.clientHeight + 4) {
            return curr;
        }
        curr = curr.parentElement;
    }
    return null;
}

/** 在指定模态/面板容器内执行四向空间导航（优先在可滚动子区域内推进并自动滚屏，到底后再跨向固定底栏/顶栏）。 */
function navigateWithinContainer(
    container: HTMLElement,
    event: KeyboardEvent,
    key: string,
): boolean {
    const direction = tvDirectionOf(key);
    if (!direction) return false;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inside = Boolean(active && container.contains(active) && isTvFocusableVisible(active));

    if (inside) {
        const widgetResult = resolveWidgetKeyBehavior(active, key, event);
        if (widgetResult === 'pass-through') return true;
        if (widgetResult === 'handled') return true;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!inside) {
        const first = collectTvFocusables(container)[0] ?? null;
        if (first) focusTvElement(first);
        return true;
    }

    if (active && (direction === 'down' || direction === 'up')) {
        const scrollEl = findInnerScrollableAncestor(active, container);
        if (scrollEl) {
            const innerNext = findTvFocusTarget(scrollEl, active, direction);
            if (innerNext) {
                focusTvElement(innerNext);
                return true;
            }
            const canScrollMore = direction === 'down'
                ? scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 4
                : scrollEl.scrollTop > 4;
            if (canScrollMore) {
                scrollEl.scrollTop += direction === 'down' ? 160 : -160;
                window.requestAnimationFrame(() => {
                    const afterScroll = findTvFocusTarget(scrollEl, active, direction)
                        ?? findTvFocusTarget(container, active, direction);
                    if (afterScroll) focusTvElement(afterScroll);
                });
                return true;
            }
        }
    }

    const next = findTvFocusTarget(container, active, direction);
    if (next) {
        focusTvElement(next);
    }
    return true;
}

/** 双栏设置面板（SettingsModal）专属遥控器导航。 */
export function handleSettingsTvNavigation(
    settingsPanel: HTMLElement,
    event: KeyboardEvent,
    key: string,
): boolean {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sideButtons = Array.from(
        settingsPanel.querySelectorAll<HTMLButtonElement>('aside button[data-tv-nav="settings-side"]'),
    );
    const closeBtn = settingsPanel.querySelector<HTMLElement>(
        'button[data-tv-nav="settings-close"], header button[aria-label="关闭"], header button[aria-label="Close"], header button[data-tv-nav="close"]',
    );
    const headerTabs = Array.from(
        settingsPanel.querySelectorAll<HTMLButtonElement>('header button[data-tv-nav="settings-tab"]'),
    );
    const contentArea = settingsPanel.querySelector<HTMLElement>('[data-folia-settings-content]');

    const sideIndex = active instanceof HTMLButtonElement ? sideButtons.indexOf(active) : -1;
    const inSide = sideIndex >= 0;
    const tabIndex = active instanceof HTMLButtonElement ? headerTabs.indexOf(active) : -1;
    const inTabs = tabIndex >= 0;
    const inRight = Boolean(active && !inSide && settingsPanel.contains(active));

    const getActiveSideBtn = () =>
        settingsPanel.querySelector<HTMLButtonElement>(
            'aside button[data-tv-nav="settings-side"][aria-current="page"]',
        ) || sideButtons[0];

    const getActiveHeaderTab = () =>
        headerTabs.find(
            t => t.getAttribute('aria-current') === 'true' || t.getAttribute('aria-selected') === 'true',
        ) || headerTabs[0];

    // 0. 焦点掉出设置面板时：拉回当前侧栏分类
    if (!inSide && !inRight) {
        if (key === 'Escape' || ARROW_KEYS.has(key)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const activeAsideBtn = getActiveSideBtn();
            if (activeAsideBtn) {
                focusTvElement(activeAsideBtn);
            } else if (key === 'Escape' && closeBtn) {
                closeBtn.click();
            }
            return true;
        }
        return false;
    }

    // 1. 正在编辑文本输入框（如 Navidrome URL / API Key）
    if (active && isTextEntryTarget(active) && !(active instanceof HTMLInputElement && active.type === 'range')) {
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            active.blur();
            getActiveSideBtn()?.focus({ preventScroll: true });
            return true;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            active.blur();
            // 继续向下执行空间导航
        } else {
            return false;
        }
    }

    // 2. 左侧分类栏
    if (inSide) {
        if (key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (sideIndex < sideButtons.length - 1) {
                const nextBtn = sideButtons[sideIndex + 1];
                nextBtn.focus({ preventScroll: true });
                nextBtn.scrollIntoView({ block: 'nearest' });
                nextBtn.click();
            }
            return true;
        }
        if (key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (sideIndex > 0) {
                const prevBtn = sideButtons[sideIndex - 1];
                prevBtn.focus({ preventScroll: true });
                prevBtn.scrollIntoView({ block: 'nearest' });
                prevBtn.click();
            }
            return true;
        }
        if (key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const targetTab = getActiveHeaderTab();
            if (targetTab) {
                focusTvElement(targetTab);
                return true;
            }
            const rightTarget = (contentArea ? collectTvFocusables(contentArea)[0] : null) ?? closeBtn ?? null;
            if (rightTarget) {
                focusTvElement(rightTarget);
            }
            return true;
        }
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeBtn?.click();
            window.setTimeout(() => {
                const settingsBtn = document.querySelector<HTMLElement>('[data-tv-nav="settings"]');
                if (settingsBtn && isTvFocusableVisible(settingsBtn)) {
                    focusTvElement(settingsBtn);
                }
            }, 60);
            return true;
        }
        if (key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        return false;
    }

    // 3. 右上子分类 Tabs
    if (inTabs && active) {
        if (key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (tabIndex < headerTabs.length - 1) {
                const nextTab = headerTabs[tabIndex + 1];
                focusTvElement(nextTab);
                nextTab.click();
            } else if (closeBtn) {
                focusTvElement(closeBtn);
            }
            return true;
        }
        if (key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (tabIndex > 0) {
                const prevTab = headerTabs[tabIndex - 1];
                focusTvElement(prevTab);
                prevTab.click();
            } else {
                const activeAsideBtn = getActiveSideBtn();
                if (activeAsideBtn) focusTvElement(activeAsideBtn);
            }
            return true;
        }
        if (key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (contentArea) {
                const tabId = active.getAttribute('data-settings-tab-id');
                const section = tabId ? contentArea.querySelector<HTMLElement>(`[data-settings-anchor="${tabId}"]`) : null;
                const targetFocusable = (section ? collectTvFocusables(section)[0] : null)
                    ?? collectTvFocusables(contentArea)[0]
                    ?? null;
                if (targetFocusable) focusTvElement(targetFocusable);
            }
            return true;
        }
        if (key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (closeBtn) focusTvElement(closeBtn);
            return true;
        }
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const activeAsideBtn = getActiveSideBtn();
            if (activeAsideBtn) focusTvElement(activeAsideBtn);
            return true;
        }
        return false;
    }

    // 4. 右上角关闭按钮
    if (active === closeBtn) {
        if (key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const target = headerTabs[headerTabs.length - 1] ?? getActiveSideBtn() ?? null;
            if (target) focusTvElement(target);
            return true;
        }
        if (key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const target = getActiveHeaderTab() ?? (contentArea ? collectTvFocusables(contentArea)[0] : null) ?? null;
            if (target) focusTvElement(target);
            return true;
        }
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const activeAsideBtn = getActiveSideBtn();
            if (activeAsideBtn) focusTvElement(activeAsideBtn);
            return true;
        }
        return false;
    }

    // 5. 右侧内容区控件
    if (inRight && active) {
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const activeAsideBtn = getActiveSideBtn();
            if (activeAsideBtn) focusTvElement(activeAsideBtn);
            return true;
        }

        const widgetResult = resolveWidgetKeyBehavior(active, key, event);
        if (widgetResult === 'pass-through' || widgetResult === 'handled') {
            return true;
        }

        // Segmented 按钮组（如浅色/深色/跟随系统）：左右键直接切换选项，最左按左退回侧边栏
        if (active instanceof HTMLButtonElement && active.getAttribute('data-tv-nav') === 'settings-choice') {
            const group = active.closest<HTMLElement>('[role="group"]');
            if (group) {
                const buttons = Array.from(
                    group.querySelectorAll<HTMLButtonElement>('button[data-tv-nav="settings-choice"]:not([disabled])'),
                );
                const idx = buttons.indexOf(active);
                if (idx >= 0) {
                    if (key === 'ArrowRight' && idx < buttons.length - 1) {
                        event.preventDefault();
                        event.stopPropagation();
                        event.stopImmediatePropagation();
                        const next = buttons[idx + 1];
                        focusTvElement(next);
                        next.click();
                        return true;
                    }
                    if (key === 'ArrowLeft') {
                        event.preventDefault();
                        event.stopPropagation();
                        event.stopImmediatePropagation();
                        if (idx > 0) {
                            const prev = buttons[idx - 1];
                            focusTvElement(prev);
                            prev.click();
                        } else {
                            const activeAsideBtn = getActiveSideBtn();
                            if (activeAsideBtn) focusTvElement(activeAsideBtn);
                        }
                        return true;
                    }
                }
            }
        }

        const direction = tvDirectionOf(key);
        if (direction) {
            const container = contentArea || settingsPanel;
            if (direction === 'left') {
                const localTarget = findTvFocusTarget(container, active, 'left');
                if (!localTarget) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    const activeAsideBtn = getActiveSideBtn();
                    if (activeAsideBtn) focusTvElement(activeAsideBtn);
                    return true;
                }
            }
            if (direction === 'up') {
                const localTarget = findTvFocusTarget(container, active, 'up');
                if (!localTarget) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    const parentSection = active.closest<HTMLElement>('[data-settings-anchor]');
                    const anchorId = parentSection?.getAttribute('data-settings-anchor');
                    const targetTab = (anchorId
                        ? headerTabs.find(t => t.getAttribute('data-settings-tab-id') === anchorId)
                        : null) ?? getActiveHeaderTab() ?? closeBtn ?? null;
                    if (targetTab) focusTvElement(targetTab);
                    return true;
                }
            }
            const target = findTvFocusTarget(container, active, direction);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (target) {
                focusTvElement(target);
            }
            return true;
        }
    }

    return false;
}

/** 搜索工作区（SearchWorkspace）遥控器导航，支持 react-window 虚拟列表自动翻滚。 */
function handleSearchWorkspaceNavigation(workspace: HTMLElement, event: KeyboardEvent, key: string): boolean {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const searchInput = workspace.querySelector<HTMLInputElement>('header input');

    if (key === 'Escape') {
        if (searchInput && active === searchInput) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            searchInput.blur();
            const closeOrTab = workspace.querySelector<HTMLElement>('header nav button, [data-tv-nav="search-close"]');
            if (closeOrTab) focusTvElement(closeOrTab);
            return true;
        }
        // 非输入框状态下保留默认冒泡，交给 SearchWorkspace 的 Escape 监听关闭搜索页
        return true;
    }

    const direction = tvDirectionOf(key);
    if (!direction) return false;

    if (searchInput && active === searchInput) {
        if (direction === 'left' || direction === 'up') return true;
        if (direction === 'right') {
            const closeBtn = workspace.querySelector<HTMLElement>('[data-tv-nav="search-close"]');
            if (closeBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                searchInput.blur();
                focusTvElement(closeBtn);
            }
            return true;
        }
        // ArrowDown：离开输入框，进入搜索源切换或结果列表
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        searchInput.blur();
        const firstTabOrResult = workspace.querySelector<HTMLElement>('header nav button') ?? collectTvFocusables(workspace)[0];
        if (firstTabOrResult) focusTvElement(firstTabOrResult);
        return true;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const inside = Boolean(active && workspace.contains(active) && isTvFocusableVisible(active));
    if (!inside) {
        const initial = workspace.querySelector<HTMLElement>('header nav button') ?? searchInput ?? collectTvFocusables(workspace)[0];
        if (initial) focusTvElement(initial);
        return true;
    }

    let next = findTvFocusTarget(workspace, active, direction);
    const virtualList = workspace.querySelector<HTMLElement>('.custom-scrollbar');
    if (!next && virtualList && active && virtualList.contains(active) && (direction === 'down' || direction === 'up')) {
        virtualList.scrollTop += direction === 'down' ? 76 * 3 : -76 * 3;
        window.requestAnimationFrame(() => {
            const afterScroll = findTvFocusTarget(workspace, active, direction);
            if (afterScroll) focusTvElement(afterScroll);
        });
        return true;
    }
    if (next) {
        focusTvElement(next);
    }
    return true;
}

/** 六边形集合/歌手/目录视图（GridView / ArtistGridView / GridMap）遥控器协调。 */
function handleGridOverlayNavigation(gridOverlay: HTMLElement, event: KeyboardEvent, key: string): boolean {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const gridCanvas = gridOverlay.querySelector<HTMLElement>('[data-tv-grid-surface="true"]');

    // 检查是否有展开的切入信息面板或侧边曲目面板
    const innerPanel = Array.from(gridOverlay.querySelectorAll<HTMLElement>('.theme-glass-panel'))
        .find(panel => {
            const rect = panel.getBoundingClientRect();
            return rect.width > 120 && rect.height > 80 && !panel.closest('[inert], [aria-hidden="true"]');
        }) ?? null;

    if (innerPanel) {
        if (key === 'Escape') {
            // 交给 GridView / ArtistGridView / GridMap 自身的 Escape 处理器先关内部面板
            return true;
        }
        if (ARROW_KEYS.has(key)) {
            return navigateWithinContainer(innerPanel, event, key);
        }
        return false;
    }

    if (key === 'Escape') {
        // 如果焦点停在顶部标题或按钮上，按一次返回先回到六边形网格，或若已在网格上则交给组件自身返回上一页
        if (active && gridOverlay.contains(active) && active !== gridCanvas) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            gridCanvas?.focus({ preventScroll: true });
            return true;
        }
        return true;
    }

    const direction = tvDirectionOf(key);
    if (!direction) return false;

    // 焦点若意外落在遮罩外（例如触发打开该网格的首页按钮上），立即救回六边形画布，并放行本次方向键
    if (!active || !gridOverlay.contains(active)) {
        gridCanvas?.focus({ preventScroll: true });
        return true;
    }

    // 焦点在六边形画布本体上：放行给 GridView / ArtistGridView / GridMap 自身的六边形几何寻路
    if (active === gridCanvas) {
        return true;
    }

    // 焦点在顶部栏按钮（返回、标题胶囊、重试/全部入队等）上：
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (direction === 'down' && gridCanvas) {
        gridCanvas.focus({ preventScroll: true });
        return true;
    }

    const headerFocusables = collectTvFocusables(gridOverlay).filter(el => el !== gridCanvas);
    if (!headerFocusables.length) {
        gridCanvas?.focus({ preventScroll: true });
        return true;
    }
    const nextHeader = findTvFocusTarget(gridOverlay, active, direction);
    if (nextHeader && nextHeader !== gridCanvas) {
        focusTvElement(nextHeader);
    }
    return true;
}

/** 播放页（Player View + 右侧 UnifiedPanel）遥控器导航。 */
function handlePlayerViewNavigation(event: KeyboardEvent, key: string): boolean {
    const { isPanelOpen } = useAppViewStore.getState();
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 情况 A：右侧 UnifiedPanel 打开时，将焦点约束在面板与开关手柄内部
    if (isPanelOpen) {
        const panelSurface = document.querySelector<HTMLElement>('[data-testid="unified-panel-surface"]');
        if (!panelSurface) return false;

        if (key === 'Escape') {
            if (active && isTextEntryTarget(active) && !(active instanceof HTMLInputElement && active.type === 'range')) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                active.blur();
                return true;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            setIsPanelOpen(false);
            window.setTimeout(() => {
                const handleOrPlay = document.querySelector<HTMLElement>(
                    '[data-tv-nav="player-panel-toggle"], [data-folia-player-bar-play="true"]',
                );
                if (handleOrPlay && isTvFocusableVisible(handleOrPlay)) {
                    focusTvElement(handleOrPlay);
                }
            }, 40);
            return true;
        }

        return navigateWithinContainer(panelSurface, event, key);
    }

    // 情况 B：播放页全屏状态（UnifiedPanel 关闭）
    if (key === 'Escape') {
        // 交给 usePlaybackInteractionBridge 的 resolvePlayerEscapeAction 执行返回上一级视图
        return true;
    }

    const direction = tvDirectionOf(key);
    if (!direction) return false;

    const playerRoot = document.body;
    const playerBar = document.querySelector<HTMLElement>('[data-ponder="player-bar"]');
    const panelToggle = document.querySelector<HTMLElement>('[data-tv-nav="player-panel-toggle"]');
    const playButton = document.querySelector<HTMLElement>('[data-folia-player-bar-play="true"]');

    const isInsidePlayerChrome = Boolean(
        active
        && active !== document.body
        && isTvFocusableVisible(active)
        && (playerBar?.contains(active) || active === panelToggle || active.hasAttribute('data-folia-command-palette-button')),
    );

    if (isInsidePlayerChrome && active instanceof HTMLInputElement && active.type === 'range') {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            stepRangeInput(active, key === 'ArrowLeft' ? -1 : 1);
            return true;
        }
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!isInsidePlayerChrome) {
        const entry = (playButton && isTvFocusableVisible(playButton) ? playButton : null)
            ?? (panelToggle && isTvFocusableVisible(panelToggle) ? panelToggle : null)
            ?? (playerBar ? collectTvFocusables(playerBar)[0] : null);
        if (entry) focusTvElement(entry);
        return true;
    }

    // 仅在播放页可见控件集合中做空间寻路（避免跳进隐藏的背景层）
    const allowedSet = new Set<HTMLElement>();
    if (playerBar) {
        for (const el of collectTvFocusables(playerBar)) allowedSet.add(el);
    }
    if (panelToggle && isTvFocusableVisible(panelToggle)) allowedSet.add(panelToggle);
    const cmdBtn = document.querySelector<HTMLElement>('[data-folia-command-palette-button="true"]');
    if (cmdBtn && isTvFocusableVisible(cmdBtn)) allowedSet.add(cmdBtn);

    let best: HTMLElement | null = null;
    const originRect = active!.getBoundingClientRect();
    const ox = originRect.left + originRect.width / 2;
    const oy = originRect.top + originRect.height / 2;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of allowedSet) {
        if (candidate === active) continue;
        const r = candidate.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - ox;
        const dy = cy - oy;
        let along = 0;
        let across = 0;
        if (direction === 'left') { along = -dx; across = Math.abs(dy); }
        else if (direction === 'right') { along = dx; across = Math.abs(dy); }
        else if (direction === 'up') { along = -dy; across = Math.abs(dx); }
        else { along = dy; across = Math.abs(dx); }
        if (along <= 2) continue;
        const score = along + across * 1.8;
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    if (best) {
        focusTvElement(best);
    } else if (direction === 'right' && panelToggle && isTvFocusableVisible(panelToggle) && active !== panelToggle) {
        focusTvElement(panelToggle);
    } else if (direction === 'left' && active === panelToggle && playButton && isTvFocusableVisible(playButton)) {
        focusTvElement(playButton);
    }
    void playerRoot;
    return true;
}

/** 等 Bravais 信息条展开落定后将遥控器焦点移入其中的首选控件。 */
export function focusBravaisSeamWhenReady(bravaisRoot?: HTMLElement | null): void {
    const startedAt = performance.now();
    const tick = () => {
        const stage = bravaisRoot?.isConnected
            ? bravaisRoot
            : queryTopmostVisible('[data-library-stage="bravais"][data-bravais-active]');
        const seam = stage?.querySelector<HTMLElement>('.bravais-seam');
        if (seam) {
            const rect = seam.getBoundingClientRect();
            const content = seam.querySelector<HTMLElement>('.bravais-seam-content');
            const opacity = content ? Number(content.style.opacity || '1') : 1;
            const leaving = Boolean(seam.querySelector('[data-bravais-seam-leaving]'));
            if (rect.width >= 36 && rect.height >= 36 && opacity >= 0.85 && !leaving) {
                const preferred = seam.querySelector<HTMLElement>(
                    '[role="tab"][aria-selected="true"]:not([disabled]), [data-bravais-seam-action="play-scope"]:not([disabled]), [data-bravais-seam-action="search"]:not([disabled])',
                );
                const target = (preferred && isTvFocusableVisible(preferred) ? preferred : null)
                    ?? collectTvFocusables(seam)[0]
                    ?? null;
                if (target) {
                    focusTvElement(target);
                    return;
                }
            }
        }
        if (performance.now() - startedAt < 900) {
            window.requestAnimationFrame(tick);
        }
    };
    window.requestAnimationFrame(tick);
}

/** 等 Bravais 信息条收起为屏幕边缘手柄（.bravais-seam-tab）后将焦点稳稳停在手柄上。 */
function focusBravaisSeamTabWhenReady(bravaisRoot?: HTMLElement | null): void {
    const startedAt = performance.now();
    const tick = () => {
        const stage = bravaisRoot?.isConnected
            ? bravaisRoot
            : queryTopmostVisible('[data-library-stage="bravais"][data-bravais-active]');
        const seamTab = stage?.querySelector<HTMLButtonElement>('.bravais-seam-tab');
        if (seamTab && isTvFocusableVisible(seamTab)) {
            focusTvElement(seamTab);
            return;
        }
        if (performance.now() - startedAt < 700) {
            window.requestAnimationFrame(tick);
        }
    };
    window.requestAnimationFrame(tick);
}

/** 将焦点从侧缝、边缘手柄或底部外围按钮交还给 Bravais 书库墙磁贴。 */
function returnFocusToBravaisWall(bravaisRoot: HTMLElement, fromSeamNode?: HTMLElement | null): void {
    const seam = bravaisRoot.querySelector<HTMLElement>('.bravais-seam');
    const seamTab = bravaisRoot.querySelector<HTMLButtonElement>('.bravais-seam-tab');
    if (fromSeamNode && (seam?.contains(fromSeamNode) || fromSeamNode === seamTab)) {
        fromSeamNode.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab',
            code: 'Tab',
            bubbles: true,
            cancelable: true,
        }));
        return;
    }
    const field = bravaisRoot.querySelector<HTMLElement>('.bravais-field');
    if (!field) return;
    field.focus({ preventScroll: true });
    if (!bravaisRoot.querySelector('.bravais-tile.is-focused')) {
        isSyntheticBravaisSeed = true;
        try {
            field.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                code: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            }));
        } finally {
            isSyntheticBravaisSeed = false;
        }
    }
}

/** 命令面板（CommandPalette）四向遥控器导航：打通搜索框、右上角全部命令/关闭、匹配列表与底部常驻快捷胶囊。 */
function handleCommandPaletteNavigation(palette: HTMLElement, event: KeyboardEvent, key: string): boolean {
    if (key === 'Escape') {
        // 交由 CommandPalette 自身的 Escape 阶梯（退回全部命令 -> surface.onEscape -> 关闭面板）
        return true;
    }

    const direction = tvDirectionOf(key);
    if (!direction) return false;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const queryInput = palette.querySelector<HTMLInputElement>('input[name="folia-command-palette-query"]');
    const body = palette.querySelector<HTMLElement>('[data-testid="command-palette-body"]');
    const pinnedRow = palette.querySelector<HTMLElement>('[data-testid="command-palette-pinned-row"]');

    // 1. 焦点在顶部查询输入框
    if (queryInput && active === queryInput) {
        if (direction === 'left') {
            if ((queryInput.selectionStart ?? 0) > 0 || (queryInput.selectionEnd ?? 0) > 0) {
                return true;
            }
            const headerEl = queryInput.parentElement;
            const prevHeaderBtn = headerEl ? findTvFocusTarget(headerEl, queryInput, 'left') : null;
            if (prevHeaderBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                queryInput.blur();
                focusTvElement(prevHeaderBtn);
            }
            return true;
        }
        if (direction === 'right') {
            const len = queryInput.value.length;
            if ((queryInput.selectionStart ?? 0) < len || (queryInput.selectionEnd ?? 0) < len) {
                return true;
            }
            const headerEl = queryInput.parentElement;
            const nextHeaderBtn = headerEl ? findTvFocusTarget(headerEl, queryInput, 'right') : null;
            if (nextHeaderBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                queryInput.blur();
                focusTvElement(nextHeaderBtn);
            }
            return true;
        }
        if (direction === 'up') {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        // ArrowDown：离开输入框，进入匹配列表第一项或底部常驻快捷行
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        queryInput.blur();
        const firstBodyTarget = (body ? collectTvFocusables(body)[0] : null)
            ?? (pinnedRow ? collectTvFocusables(pinnedRow)[0] : null);
        if (firstBodyTarget) focusTvElement(firstBodyTarget);
        return true;
    }

    // 2. 焦点在命令匹配行（data-command-match-index）
    if (active && active.hasAttribute('data-command-match-index') && body) {
        const idx = Number(active.getAttribute('data-command-match-index'));
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (direction === 'down') {
            const nextMatch = body.querySelector<HTMLElement>(`[data-command-match-index="${idx + 1}"]:not([disabled])`);
            if (nextMatch) {
                focusTvElement(nextMatch);
                return true;
            }
            const firstPinned = pinnedRow ? (findTvFocusTarget(palette, active, 'down') ?? collectTvFocusables(pinnedRow)[0]) : null;
            if (firstPinned) focusTvElement(firstPinned);
            return true;
        }
        if (direction === 'up') {
            if (idx > 0) {
                const prevMatch = body.querySelector<HTMLElement>(`[data-command-match-index="${idx - 1}"]:not([disabled])`);
                if (prevMatch) {
                    focusTvElement(prevMatch);
                    return true;
                }
            }
            if (queryInput && !queryInput.disabled) {
                focusTvElement(queryInput);
            } else {
                const headerBtn = findTvFocusTarget(palette, active, 'up');
                if (headerBtn) focusTvElement(headerBtn);
            }
            return true;
        }
        // 在整行命令上按右键可快捷前往顶栏「显示全部命令 (?)」
        if (direction === 'right') {
            const headerEl = queryInput?.parentElement;
            const helpBtn = headerEl ? collectTvFocusables(headerEl).find(el => el !== queryInput) : null;
            if (helpBtn) focusTvElement(helpBtn);
        }
        return true;
    }

    // 3. 焦点在底部常驻快捷胶囊行（PinnedCommandRow）：按上键回到列表末尾项
    if (active && pinnedRow?.contains(active) && direction === 'up') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const bodyItems = body ? collectTvFocusables(body) : [];
        const lastBodyItem = bodyItems[bodyItems.length - 1]
            ?? (queryInput && !queryInput.disabled ? queryInput : null);
        if (lastBodyItem) focusTvElement(lastBodyItem);
        return true;
    }

    return navigateWithinContainer(palette, event, key);
}

/**
 * Bravais 书库墙（首页与集合/歌手/专辑全层级）遥控器协调：
 * - 支持从无限循环海报墙按左键自然跨入左侧信息条（.bravais-seam）、缩小后的边缘手柄（.bravais-seam-tab）及左下角搜索快捷钮（⌘）；
 * - 优化信息条内全局搜索框（BravaisSeamSearch）的上下进出与返回关闭；
 * - 支持将缩小隐藏的信息条通过边缘手柄（左移对准按确定或继续按左）、返回键（根墙面）或电视菜单键一键唤出；
 * - 支持歌曲展开聚焦卡内按钮（立即播放 / 加入队列 / 歌手 / 专辑 / 更多）的四向走位。
 */
function handleBravaisTvNavigation(bravaisRoot: HTMLElement, event: KeyboardEvent, key: string): boolean {
    if (isSyntheticBravaisSeed) return true;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const field = bravaisRoot.querySelector<HTMLElement>('.bravais-field');
    const seam = bravaisRoot.querySelector<HTMLElement>('.bravais-seam');
    const seamTab = bravaisRoot.querySelector<HTMLButtonElement>('.bravais-seam-tab');
    const cmdBtn = document.querySelector<HTMLElement>('[data-folia-command-palette-button="true"]');
    const wallToolsRoot = document.querySelector<HTMLElement>('.lattice-tools');
    const playerBar = document.querySelector<HTMLElement>('[data-ponder="player-bar"]');
    const backBtn = bravaisRoot.querySelector<HTMLElement>('.wall-back-button');
    const expandedTile = bravaisRoot.querySelector<HTMLElement>('.bravais-tile.is-expanded');

    const seamRect = seam?.getBoundingClientRect() ?? null;
    const seamOpen = Boolean(
        seam
        && seamRect
        && seamRect.width >= 36
        && seamRect.height >= 36
        && !seam.querySelector('[data-bravais-seam-leaving]'),
    );
    const seamAxis = bravaisRoot.getAttribute('data-bravais-seam-axis')
        || seam?.getAttribute('data-bravais-seam-axis')
        || 'x';

    // 1. 信息条内全局搜索面板（BravaisSeamSearch）处于打开状态
    const seamSearch = seamOpen ? seam?.querySelector<HTMLElement>('[data-bravais-search]') : null;
    if (seamSearch && isTvFocusableVisible(seamSearch)) {
        const searchInput = seamSearch.querySelector<HTMLInputElement>('input[name="bravais-search"]');
        const closeSearchBtn = seamSearch.querySelector<HTMLElement>('[data-bravais-seam-action="close-search"]');
        const submitSearchBtn = seamSearch.querySelector<HTMLElement>('[data-bravais-seam-action="submit-search"]');

        if (key === 'Escape') {
            if (searchInput && active === searchInput) {
                // 放行给 BravaisSeamSearch 自身的 Escape 处理（关闭搜索并自动恢复搜索图标焦点）
                return true;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeSearchBtn?.click();
            return true;
        }

        const direction = tvDirectionOf(key);
        if (!direction) return false;

        if (searchInput && active === searchInput) {
            if (direction === 'left') return true;
            if (direction === 'right') {
                const len = searchInput.value.length;
                if ((searchInput.selectionStart ?? 0) < len || (searchInput.selectionEnd ?? 0) < len) {
                    return true;
                }
                const clearBtn = seamSearch.querySelector<HTMLElement>('form button');
                if (clearBtn && isTvFocusableVisible(clearBtn)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    searchInput.blur();
                    focusTvElement(clearBtn);
                }
                return true;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            searchInput.blur();
            if (direction === 'down' && submitSearchBtn && isTvFocusableVisible(submitSearchBtn)) {
                focusTvElement(submitSearchBtn);
            } else if (direction === 'up' && closeSearchBtn && isTvFocusableVisible(closeSearchBtn)) {
                focusTvElement(closeSearchBtn);
            }
            return true;
        }

        if (active && seamSearch.contains(active)) {
            if (direction === 'right') {
                const localRight = findTvFocusTarget(seamSearch, active, 'right');
                if (!localRight) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    returnFocusToBravaisWall(bravaisRoot, active);
                    return true;
                }
            }
            if (direction === 'down' && active === submitSearchBtn && cmdBtn && isTvFocusableVisible(cmdBtn)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                focusTvElement(cmdBtn);
                return true;
            }
            return navigateWithinContainer(seamSearch, event, key);
        }
    }

    // 2. 焦点在展开的信息条（.bravais-seam）内部
    if (seam && active && seam.contains(active)) {
        if (key === 'Escape') {
            if (isTextEntryTarget(active)) return true;
            const hasSubLayer = Boolean(useCollectionNavigationStore.getState().snapshot?.stack.length);
            if (!hasSubLayer) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                returnFocusToBravaisWall(bravaisRoot, active);
                return true;
            }
            return true;
        }

        const direction = tvDirectionOf(key);
        if (!direction) return false;

        const widgetResult = resolveWidgetKeyBehavior(active, key, event);
        if (widgetResult === 'pass-through' || widgetResult === 'handled') {
            return true;
        }

        const nextInSeam = findTvFocusTarget(seam, active, direction);
        if (nextInSeam) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            focusTvElement(nextInSeam);
            return true;
        }

        // 到达信息条边界：顺滑跨向左下角快捷搜索钮（⌘）、底部播放栏或右侧海报墙
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (direction === 'down') {
            if (seamAxis === 'y') {
                returnFocusToBravaisWall(bravaisRoot, active);
                return true;
            }
            const bottomEntry = (cmdBtn && isTvFocusableVisible(cmdBtn) ? cmdBtn : null)
                ?? (playerBar ? collectTvFocusables(playerBar)[0] : null)
                ?? (wallToolsRoot ? collectTvFocusables(wallToolsRoot)[0] : null);
            if (bottomEntry) focusTvElement(bottomEntry);
            return true;
        }

        if (direction === 'right' && seamAxis === 'x') {
            returnFocusToBravaisWall(bravaisRoot, active);
            return true;
        }

        if (direction === 'left' && seamAxis === 'x' && seamRect) {
            const rememberedTile = bravaisRoot.querySelector<HTMLElement>('.bravais-tile.is-focused');
            const rememberedOnLeft = Boolean(
                rememberedTile && rememberedTile.getBoundingClientRect().right <= seamRect.left + 16,
            );
            if (rememberedOnLeft) {
                returnFocusToBravaisWall(bravaisRoot, active);
            } else if (cmdBtn && isTvFocusableVisible(cmdBtn)) {
                focusTvElement(cmdBtn);
            } else {
                returnFocusToBravaisWall(bravaisRoot, active);
            }
            return true;
        }

        if (direction === 'up' && seamAxis === 'y') {
            returnFocusToBravaisWall(bravaisRoot, active);
            return true;
        }

        return true;
    }

    // 3. 焦点在菜单缩小后的屏幕边缘恢复手柄（.bravais-seam-tab）上
    if (seamTab && active === seamTab) {
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            returnFocusToBravaisWall(bravaisRoot, seamTab);
            return true;
        }
        const direction = tvDirectionOf(key);
        if (!direction) return false;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const side = seamTab.getAttribute('data-side') || 'left';
        if ((side === 'left' && direction === 'left') || (side === 'right' && direction === 'right')) {
            // 在左侧边缘手柄上继续按左（或按 OK）均可直接展开恢复菜单
            seamTab.click();
            focusBravaisSeamWhenReady(bravaisRoot);
            return true;
        }
        if (side === 'left' && direction === 'right') {
            returnFocusToBravaisWall(bravaisRoot, null);
            return true;
        }
        if (side === 'right' && direction === 'left') {
            returnFocusToBravaisWall(bravaisRoot, null);
            return true;
        }
        if (direction === 'down' && cmdBtn && isTvFocusableVisible(cmdBtn)) {
            focusTvElement(cmdBtn);
            return true;
        }
        if (direction === 'up' && backBtn && isTvFocusableVisible(backBtn)) {
            focusTvElement(backBtn);
            return true;
        }
        return true;
    }

    // 4. 焦点在外围悬浮控件（左下角 ⌘ 快捷命令按钮、底部迷你播放条、右下角墙面工具按钮、左上角返回按钮）
    const inPeripheral = Boolean(
        active
        && (
            active === cmdBtn
            || playerBar?.contains(active)
            || wallToolsRoot?.contains(active)
            || backBtn?.contains(active)
        ),
    );
    if (inPeripheral && active) {
        if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            returnFocusToBravaisWall(bravaisRoot, null);
            return true;
        }

        const widgetResult = resolveWidgetKeyBehavior(active, key, event);
        if (widgetResult === 'pass-through' || widgetResult === 'handled') {
            return true;
        }

        const direction = tvDirectionOf(key);
        if (!direction) return false;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (active === cmdBtn && direction === 'up') {
            if (seamOpen && seam) {
                const searchBtn = seam.querySelector<HTMLElement>('[data-bravais-seam-action="search"]:not([disabled])');
                if (searchBtn && isTvFocusableVisible(searchBtn)) {
                    focusTvElement(searchBtn);
                    return true;
                }
                const seamItems = collectTvFocusables(seam);
                const bottomSeamItem = seamItems[seamItems.length - 1];
                if (bottomSeamItem) {
                    focusTvElement(bottomSeamItem);
                    return true;
                }
            }
            if (seamTab && isTvFocusableVisible(seamTab)) {
                focusTvElement(seamTab);
                return true;
            }
            returnFocusToBravaisWall(bravaisRoot, null);
            return true;
        }

        if (direction === 'up' && (playerBar?.contains(active) || wallToolsRoot?.contains(active))) {
            const localUp = wallToolsRoot?.contains(active) ? findTvFocusTarget(wallToolsRoot, active, 'up') : null;
            if (localUp) {
                focusTvElement(localUp);
                return true;
            }
            returnFocusToBravaisWall(bravaisRoot, null);
            return true;
        }

        const pool: HTMLElement[] = [];
        if (cmdBtn && isTvFocusableVisible(cmdBtn)) pool.push(cmdBtn);
        if (playerBar) pool.push(...collectTvFocusables(playerBar));
        if (wallToolsRoot) pool.push(...collectTvFocusables(wallToolsRoot));
        if (backBtn) pool.push(...collectTvFocusables(backBtn));

        const originRect = active.getBoundingClientRect();
        const ox = originRect.left + originRect.width / 2;
        const oy = originRect.top + originRect.height / 2;
        let best: HTMLElement | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const item of pool) {
            if (item === active) continue;
            const r = item.getBoundingClientRect();
            const dx = (r.left + r.width / 2) - ox;
            const dy = (r.top + r.height / 2) - oy;
            let along = 0;
            let across = 0;
            if (direction === 'left') { along = -dx; across = Math.abs(dy); }
            else if (direction === 'right') { along = dx; across = Math.abs(dy); }
            else if (direction === 'up') { along = -dy; across = Math.abs(dx); }
            else { along = dy; across = Math.abs(dx); }
            if (along <= 2) continue;
            const score = along + across * 1.8;
            if (score < bestScore) {
                bestScore = score;
                best = item;
            }
        }
        if (best) {
            focusTvElement(best);
        } else if (direction === 'right' || direction === 'down') {
            returnFocusToBravaisWall(bravaisRoot, null);
        }
        return true;
    }

    // 5. 歌曲聚焦展开卡（.bravais-tile.is-expanded）内的按钮导航
    if (expandedTile && active && expandedTile.contains(active)) {
        if (key === 'Escape') {
            field?.focus({ preventScroll: true });
            return true;
        }
        const direction = tvDirectionOf(key);
        if (!direction) return false;
        const nextInCard = findTvFocusTarget(expandedTile, active, direction);
        if (nextInCard) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            focusTvElement(nextInCard);
            return true;
        }
        // 在展开卡边缘继续向外按方向键时，平顺退回海报墙并继续向外移动，不把遥控器困在单张卡片内
        field?.focus({ preventScroll: true });
    }

    // 6. 焦点在海报墙（.bravais-field）上或尚未聚焦时
    if (key === 'Escape') {
        const hasSubLayer = Boolean(useCollectionNavigationStore.getState().snapshot?.stack.length);
        const focusedTile = bravaisRoot.querySelector<HTMLElement>('.bravais-tile.is-focused');
        const hasOpenPanel = useBravaisUiStore.getState().panelFor !== null;
        // 根墙面且菜单被缩小隐藏时，按返回键直接把左侧菜单恢复出来（防迷路兜底）
        if (!hasSubLayer && !expandedTile && !focusedTile && !hasOpenPanel && useBravaisSeamStore.getState().level === 'hidden') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            useBravaisSeamStore.getState().restore();
            focusBravaisSeamWhenReady(bravaisRoot);
            return true;
        }
        return true;
    }

    const direction = tvDirectionOf(key);
    if (!direction) return false;

    const focusedTile = bravaisRoot.querySelector<HTMLElement>('.bravais-tile.is-focused');
    if (focusedTile && (direction === 'left' || direction === 'right')) {
        const tileRect = focusedTile.getBoundingClientRect();
        const tileCenterY = tileRect.top + tileRect.height / 2;

        const otherContentTiles = Array.from(
            bravaisRoot.querySelectorAll<HTMLElement>('.bravais-tile:not([inert])'),
        ).filter((tile) => {
            if (tile === focusedTile) return false;
            const face = tile.querySelector('.bravais-tile-face');
            if (!face || face.classList.contains('is-wall') || face.classList.contains('is-window')) return false;
            const r = tile.getBoundingClientRect();
            return (
                r.width > 12
                && r.height > 12
                && r.right > 6
                && r.left < window.innerWidth - 6
                && r.bottom > 6
                && r.top < window.innerHeight - 6
            );
        });

        // 6a. 向左跨入展开的竖向信息条（.bravais-seam）
        if (direction === 'left' && seamOpen && seam && seamRect && seamAxis === 'x' && tileRect.left >= seamRect.right - 28) {
            const hasTileBetween = otherContentTiles.some((t) => {
                const r = t.getBoundingClientRect();
                const cy = r.top + r.height / 2;
                return (
                    r.left >= seamRect.right - 12
                    && r.left < tileRect.left - 14
                    && Math.abs(cy - tileCenterY) < Math.max(tileRect.height, r.height) * 1.15
                );
            });
            if (!hasTileBetween) {
                const seamFocusables = collectTvFocusables(seam);
                if (seamFocusables.length > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    // 优先按当前磁贴所在纵向高度就近落入信息条（底部靠近搜索图标时直接对准搜索）
                    let bestSeamEl = seamFocusables[0];
                    let bestDy = Number.POSITIVE_INFINITY;
                    for (const el of seamFocusables) {
                        const er = el.getBoundingClientRect();
                        const dy = Math.abs((er.top + er.height / 2) - tileCenterY);
                        if (dy < bestDy) {
                            bestDy = dy;
                            bestSeamEl = el;
                        }
                    }
                    focusTvElement(bestSeamEl);
                    return true;
                }
            }
        }

        // 6b. 当信息条位于屏幕中部时，从其左侧磁贴向右跨入信息条
        if (direction === 'right' && seamOpen && seam && seamRect && seamAxis === 'x' && tileRect.right <= seamRect.left + 28) {
            const hasTileBetween = otherContentTiles.some((t) => {
                const r = t.getBoundingClientRect();
                const cy = r.top + r.height / 2;
                return (
                    r.right <= seamRect.left + 12
                    && r.right > tileRect.right + 14
                    && Math.abs(cy - tileCenterY) < Math.max(tileRect.height, r.height) * 1.15
                );
            });
            if (!hasTileBetween) {
                const seamFocusables = collectTvFocusables(seam);
                if (seamFocusables.length > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    focusTvElement(seamFocusables[0]);
                    return true;
                }
            }
        }

        // 6c. 信息条已缩小/收起（或不在左侧）时，在屏幕最左列继续按左键，进入边缘恢复手柄（.bravais-seam-tab）或左下角快捷钮（⌘）
        if (direction === 'left' && tileRect.left <= Math.max(190, window.innerWidth * 0.24)) {
            const hasTileFurtherLeft = otherContentTiles.some((t) => {
                const r = t.getBoundingClientRect();
                const cy = r.top + r.height / 2;
                return (
                    r.left >= -24
                    && r.left < tileRect.left - 18
                    && Math.abs(cy - tileCenterY) < Math.max(tileRect.height, r.height) * 1.15
                );
            });
            if (!hasTileFurtherLeft) {
                const leftTabVisible = Boolean(
                    seamTab
                    && isTvFocusableVisible(seamTab)
                    && (seamTab.getAttribute('data-side') || 'left') === 'left',
                );
                if (leftTabVisible && seamTab) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    focusTvElement(seamTab);
                    return true;
                }
                if (cmdBtn && isTvFocusableVisible(cmdBtn)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    focusTvElement(cmdBtn);
                    return true;
                }
            }
        }

        // 6d. 若边缘恢复手柄挂在屏幕右侧（data-side="right"），在最右列按右键可进入手柄
        if (direction === 'right' && seamTab && isTvFocusableVisible(seamTab) && seamTab.getAttribute('data-side') === 'right') {
            if (tileRect.right >= window.innerWidth - Math.max(190, window.innerWidth * 0.24)) {
                const hasTileFurtherRight = otherContentTiles.some((t) => {
                    const r = t.getBoundingClientRect();
                    const cy = r.top + r.height / 2;
                    return (
                        r.right <= window.innerWidth + 24
                        && r.right > tileRect.right + 18
                        && Math.abs(cy - tileCenterY) < Math.max(tileRect.height, r.height) * 1.15
                    );
                });
                if (!hasTileFurtherRight) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    focusTvElement(seamTab);
                    return true;
                }
            }
        }
    }

    // 其余情况放行给 useBravaisKeyboard 在冒泡阶段驱动海报墙自身移动与翻牌
    return true;
}

/**
 * 判断当前是否存在高于首页（Home / Grid3D）的顶层弹窗、播放页、集合网格或全屏搜索层。
 * 供首页捕获监听快速让权，避免因 React 子组件 useEffect 先于父组件挂载而抢先拦截方向键。
 */
export function hasActiveTvOverlayOrHigherView(): boolean {
    if (document.querySelector('[role="combobox"][aria-expanded="true"]')) return true;
    if (queryTopmostVisible(
        '.st-pop:not([inert]), .lattice-tools-panel:not([inert]), [data-bravais-seam-menu]:not([inert]), [data-bravais-focus-menu]:not([inert]), [data-folia-sheet="true"]:not([inert]), [data-folia-studio-window="true"]:not([inert]), [data-folia-settings-panel="true"], [data-folia-keyboard-window="true"]',
    )) {
        return true;
    }
    const currentView = useAppViewStore.getState().view;
    if (currentView === 'player' || currentView === 'lattice') return true;
    if (currentView === 'home') {
        if (useCollectionNavigationStore.getState().snapshot?.stack.length) return true;
        if (queryTopmostVisible('[data-library-renderer="grid"], [data-folia-grid-overlay="true"], [data-library-stage="bravais"][data-bravais-active]')) {
            return true;
        }
        if (useSearchNavigationStore.getState().isSearchOpen && queryTopmostVisible('[data-folia-search-workspace="true"]')) {
            return true;
        }
    }
    return false;
}

/**
 * 顶层捕获阶段统一入口。返回 true 表示事件已被对应高层级接管（底层 Home 等无需再插手）。
 */
export function dispatchTvKeyCapture(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    const key = event.key;
    if (!ARROW_KEYS.has(key) && key !== 'Escape') return false;

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 层级 0：专属退出确认弹窗（ExitConfirmModal）
    const exitModal = queryTopmostVisible('[data-folia-exit-modal="true"]');
    if (exitModal) {
        if (key === 'Escape') {
            useExitModalStore.getState().closeExitModal();
            return true;
        }
        return navigateWithinContainer(exitModal, event, key);
    }

    // 层级 1：展开的 CustomSelect 下拉框（触发器自身监听上下方向键、回车与 Escape）
    const openCombobox = document.querySelector<HTMLElement>('[role="combobox"][aria-expanded="true"]');
    if (openCombobox) {
        if (active !== openCombobox) {
            openCombobox.focus({ preventScroll: true });
        }
        return true;
    }

    // 层级 2：展开的 Popover 浮层（如播放控制面板的歌词样式/背景小图选择器、主题工坊取色器气泡）
    const openPopover = queryTopmostVisible('.st-pop:not([inert])');
    if (openPopover) {
        if (key === 'Escape') {
            if (!openPopover.contains(event.target as Node)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                openPopover.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true,
                    cancelable: true,
                }));
                return true;
            }
            // 目标在 Popover 内部时保留冒泡，由 Popover 自身的 onKeyDown 关闭并把焦点归还给 anchor
            return true;
        }
        return navigateWithinContainer(openPopover, event, key);
    }

    // 层级 2.5：墙面右下角快捷菜单面板（.lattice-tools-panel）、侧缝「⋯」菜单（[data-bravais-seam-menu]）与歌曲卡「⋯」菜单
    const openQuickMenu = queryTopmostVisible(
        '.lattice-tools-panel:not([inert]), [data-bravais-seam-menu]:not([inert]), [data-bravais-focus-menu]:not([inert])',
    );
    if (openQuickMenu) {
        if (key === 'Escape') {
            if (openQuickMenu.hasAttribute('data-bravais-seam-menu') && !openQuickMenu.contains(event.target as Node)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                openQuickMenu.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    bubbles: true,
                    cancelable: true,
                }));
                return true;
            }
            return true;
        }
        const quickScope = openQuickMenu.classList.contains('lattice-tools-panel')
            ? (openQuickMenu.closest<HTMLElement>('.lattice-tools-stack') ?? openQuickMenu)
            : openQuickMenu;
        return navigateWithinContainer(quickScope, event, key);
    }

    // 层级 3：最顶层 Sheet 对话框（登录窗口、主题快编器、均衡器、歌词偏移/过滤、确认框等）
    const topSheet = queryTopmostVisible('[data-folia-sheet="true"]:not([inert])');
    if (topSheet) {
        if (key === 'Escape') {
            // 让 Sheet.tsx 自己的 document 监听按 LIFO 关闭最顶层 Sheet 并自动恢复 opener 焦点
            return true;
        }
        return navigateWithinContainer(topSheet, event, key);
    }

    // 层级 4：StudioWindow 二级工作台（ThemePark 主题工坊 / VisPlayground 歌词动效工作台）
    const studioWindow = queryTopmostVisible('[data-folia-studio-window="true"]:not([inert])');
    if (studioWindow) {
        if (key === 'Escape') {
            // 若有 over 覆盖层则 StudioWindow 自身关闭 over；否则冒泡给 SettingsModal 关闭工作台并恢复 opener 焦点
            return true;
        }
        return navigateWithinContainer(studioWindow, event, key);
    }

    // 层级 5：SettingsModal 主设置窗口
    const settingsPanel = queryTopmostVisible('[data-folia-settings-panel="true"]');
    if (settingsPanel) {
        return handleSettingsTvNavigation(settingsPanel, event, key);
    }

    // 层级 6：命令面板（CommandPalette）
    const commandPalette = queryTopmostVisible('[data-folia-keyboard-window="true"]');
    if (commandPalette) {
        return handleCommandPaletteNavigation(commandPalette, event, key);
    }

    const currentView = useAppViewStore.getState().view;

    // 层级 7：播放页（currentView === 'player' 的层级高于主页与搜索页，因为从搜索页点播歌曲后会切到 player）
    if (currentView === 'player') {
        return handlePlayerViewNavigation(event, key);
    }

    // 层级 7.5：Lattice 海报墙视图（队列墙 / 探索墙）
    if (currentView === 'lattice') {
        const latticeField = queryTopmostVisible('.lattice-field');
        if (latticeField && (!active || !latticeField.contains(active))) {
            latticeField.focus({ preventScroll: true });
        }
        return true;
    }

    // 层级 8：集合 / 歌手 / 目录全屏层（GridView / ArtistGridView / GridMap / Bravais 书库墙）与全屏搜索
    if (currentView === 'home') {
        const gridOverlay = queryTopmostVisible('[data-library-renderer="grid"], [data-folia-grid-overlay="true"]');
        if (gridOverlay) {
            return handleGridOverlayNavigation(gridOverlay, event, key);
        }

        const bravaisStage = queryTopmostVisible('[data-library-stage="bravais"][data-bravais-active]');
        if (bravaisStage) {
            return handleBravaisTvNavigation(bravaisStage, event, key);
        }

        if (useCollectionNavigationStore.getState().snapshot?.stack.length) {
            return true;
        }

        // 层级 9：全屏搜索工作区（SearchWorkspace）
        if (useSearchNavigationStore.getState().isSearchOpen) {
            const searchWorkspace = queryTopmostVisible('[data-folia-search-workspace="true"]');
            if (searchWorkspace) {
                return handleSearchWorkspaceNavigation(searchWorkspace, event, key);
            }
        }
    }

    return false;
}

/** 冒泡阶段确认键兜底：让非原生 <button>/<a> 的可聚焦卡片与选项响应遥控器 OK 键，并衔接 Bravais 折叠/展开焦点。 */
export function dispatchTvEnterBubble(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;

    // 当在 Bravais 墙体上按 Enter 展开单曲聚焦卡后，自动将光标移入展开卡内的「立即播放」按钮
    if (active.classList.contains('bravais-field')) {
        const ownerStage = active.closest<HTMLElement>('[data-library-stage="bravais"]');
        if (ownerStage) {
            window.setTimeout(() => {
                if (document.activeElement !== active) return;
                const playBtn = ownerStage.querySelector<HTMLElement>(
                    '.bravais-tile.is-expanded [data-bravais-action="play"]:not([disabled])',
                );
                if (playBtn && isTvFocusableVisible(playBtn)) {
                    focusTvElement(playBtn);
                }
            }, 60);
        }
    }

    // 当点击「折叠信息条」（hide）按钮把 Bravais 菜单缩小时，自动将光标移到屏幕侧边的恢复手柄上
    const ownerBravais = active.closest<HTMLElement>('[data-library-stage="bravais"]');
    if (ownerBravais && (active.getAttribute('data-bravais-seam-action') === 'hide' || active.closest('[data-bravais-seam-menu]'))) {
        window.setTimeout(() => {
            if (useBravaisSeamStore.getState().level === 'hidden') {
                const nowActive = document.activeElement;
                if (!nowActive || nowActive === document.body || !isTvFocusableVisible(nowActive as HTMLElement)) {
                    focusBravaisSeamTabWhenReady(ownerBravais);
                }
            }
        }, 60);
    }

    if (event.defaultPrevented) return;
    if (activateTvElement(active)) {
        event.preventDefault();
    }
}

import { useEffect, useRef } from 'react';
import { isTextEntryTarget } from '../../../../utils/keyboardTargets';
import { findTvFocusTarget, focusTvElement, tvDirectionOf } from '../../../../utils/tvSpatialFocus';
import { handleSettingsTvNavigation, hasActiveTvOverlayOrHigherView } from '../../../../services/tvNavigationEngine';

export { handleSettingsTvNavigation };

// src/library/suites/grid/home/useTvHomeNavigation.ts
// 电视（遥控器）在首页（Grid3D）的方向键与返回键模型。
//
// 所有高层浮层（CustomSelect / Popover / Sheet / StudioWindow / SettingsModal / CommandPalette）、
// 全屏播放页、六边形集合层与全屏搜索层已统一由 tvNavigationEngine 在顶层按严格视觉层级分发；
// 本 Hook 在检测到任何上层活跃时立即让权，仅专注处理首页三明治结构：
//   - 顶部栏（设置、页签、搜索）：← → 切换控件，↓ 进入内容区，返回键回内容区。
//   - 内容区（3D 海报轨道 / 探索页空间网格）：↑ 回顶部栏，↓ 到底部浮窗栏。
//   - 底部栏（命令面板、正在播放浮窗、音源切换胶囊、返回播放页胶囊）：← → 切换，↑ 回内容区。

export type TvHomeNavItem = {
    /** 控件的稳定标识（页签 key 之类），只给上层区分用。 */
    id: string;
    /** 取控件的 DOM 元素；控件不在了就当它不存在。 */
    getElement: () => HTMLElement | null;
    /** 焦点移到这个控件上时要做的事（切页签等）。 */
    onFocus?: () => void;
};

type TvHomeNavigationOptions = {
    /** 只有电视、且首页可交互时才接管。 */
    isActive: boolean;
    /** 顶部那一行里可以聚焦的控件，按 ← → 移动的顺序。 */
    items: readonly TvHomeNavItem[];
    /**
     * 屏幕底部那一行里可以聚焦的控件（命令面板按钮、「正在播放」浮窗、音源切换胶囊等）。
     * 内容区按 ↓ 落到这一行，这一行按 ↑ 回到内容区。
     */
    bottomItems?: readonly TvHomeNavItem[];
    /** 从内容区按 ↑ 上来时，焦点落在哪个控件上（一般是当前页签）。 */
    resolveEnterItemId: () => string;
    /** 从顶部那一行按 ↓ 回到内容区。 */
    focusContent: () => void;
    /**
     * 内容区的方向键交给谁。
     * 返回 null：内容区自己处理方向键（首页 3D 海报轨道）。
     * 返回一个根节点：按几何位置挪焦点（探索页网格）。
     */
    resolveSpatialRoot?: () => HTMLElement | null;
};

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export const useTvHomeNavigation = ({
    isActive,
    items,
    bottomItems,
    resolveEnterItemId,
    focusContent,
    resolveSpatialRoot,
}: TvHomeNavigationOptions): void => {
    const latest = useRef({ items, bottomItems, resolveEnterItemId, focusContent, resolveSpatialRoot });
    latest.current = { items, bottomItems, resolveEnterItemId, focusContent, resolveSpatialRoot };

    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            const key = event.key;

            // 存在任何更高层级的弹窗、工作台、播放页、集合网格或全屏搜索时，无条件让权给 tvNavigationEngine
            if (hasActiveTvOverlayOrHigherView()) {
                return;
            }

            if (isTextEntryTarget(event.target)) {
                if (key === 'Escape' && event.target instanceof HTMLElement) {
                    event.target.blur();
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            if (document.querySelector('[data-folia-exit-modal="true"]')) return;
            if (!ARROW_KEYS.has(key) && key !== 'Escape') return;

            const itemsNow = latest.current.items;
            const bottomNow = latest.current.bottomItems ?? [];
            const active = document.activeElement;

            // Escape 键：若焦点在空间内容区，则按返回键回到顶部导航栏；若在顶部栏、底部栏或 body，放行给全局退出/返回逻辑
            if (key === 'Escape') {
                const activeIndex = itemsNow.findIndex(item => item.getElement() === active);
                const bottomIndex = bottomNow.findIndex(item => item.getElement() === active);
                const inHeader = activeIndex >= 0;
                const inBottom = bottomIndex >= 0;
                const spatialRoot = inHeader || inBottom ? null : latest.current.resolveSpatialRoot?.() ?? null;
                const inSpatial = Boolean(spatialRoot && active instanceof HTMLElement && spatialRoot.contains(active));
                if (inSpatial && spatialRoot) {
                    event.preventDefault();
                    event.stopPropagation();
                    const target = itemsNow.find(item => item.id === latest.current.resolveEnterItemId())
                        ?? itemsNow[0];
                    target?.getElement()?.focus({ preventScroll: true });
                    target?.onFocus?.();
                    return;
                }
                return;
            }

            // 方向键焦点拯救兜底（Focus Rescue Guard）：若由于 DOM 销毁或弹层关闭导致焦点掉到 body，按方向键立刻恢复至主导航
            if (!active || active === document.body) {
                event.preventDefault();
                event.stopPropagation();
                const rescueTarget = itemsNow.find(item => item.id === latest.current.resolveEnterItemId())
                    ?? itemsNow[0];
                const el = rescueTarget?.getElement();
                if (el) {
                    focusTvElement(el);
                    rescueTarget.onFocus?.();
                }
                return;
            }

            const activeIndex = itemsNow.findIndex(item => item.getElement() === active);
            const bottomIndex = bottomNow.findIndex(item => item.getElement() === active);
            const inHeader = activeIndex >= 0;
            const inBottom = bottomIndex >= 0;

            // 内容区里如果焦点已经落在「自己要走方向键」的那一块（海报轨道），方向键是它的。
            const spatialRoot = inHeader || inBottom ? null : latest.current.resolveSpatialRoot?.() ?? null;
            const inSpatial = Boolean(spatialRoot && active instanceof HTMLElement && spatialRoot.contains(active));

            // 方向键一律先按掉默认行为：WebView 的空间导航据此不再自己挪焦点。
            event.preventDefault();

            if (key === 'ArrowUp') {
                if (inHeader) return;
                if (inBottom) {
                    event.stopPropagation();
                    latest.current.focusContent();
                    return;
                }
                event.stopPropagation();
                if (spatialRoot && active instanceof HTMLElement) {
                    const target = findTvFocusTarget(spatialRoot, spatialRoot.contains(active) ? active : null, 'up');
                    if (target) {
                        focusTvElement(target);
                        return;
                    }
                }
                const target = itemsNow.find(item => item.id === latest.current.resolveEnterItemId())
                    ?? itemsNow[0];
                if (!target) return;
                target.getElement()?.focus({ preventScroll: true });
                target.onFocus?.();
                return;
            }

            if (key === 'ArrowDown') {
                if (inBottom) return;
                if (!inHeader) {
                    if (spatialRoot && active instanceof HTMLElement) {
                        const target = findTvFocusTarget(spatialRoot, spatialRoot.contains(active) ? active : null, 'down');
                        if (target) {
                            event.stopPropagation();
                            focusTvElement(target);
                            return;
                        }
                    }
                    // 下面没有别的内容了：落到屏幕底部那一行（命令面板、正在播放、音源切换胶囊）。
                    if (focusFirst(bottomNow)) {
                        event.stopPropagation();
                    }
                    return;
                }
                event.stopPropagation();
                latest.current.focusContent();
                return;
            }

            // ← →：顶部或底部那一行里换控件；内容区里交给海报轨道或探索网格处理。
            if (!inHeader) {
                if (inBottom) {
                    event.stopPropagation();
                    moveFocus(bottomNow, bottomIndex, key === 'ArrowRight' ? 1 : -1);
                    return;
                }
                const direction = tvDirectionOf(key);
                if (spatialRoot && direction && active instanceof HTMLElement) {
                    const target = findTvFocusTarget(
                        spatialRoot,
                        spatialRoot.contains(active) ? active : null,
                        direction,
                    );
                    if (target) {
                        event.stopPropagation();
                        focusTvElement(target);
                    }
                }
                return;
            }
            event.stopPropagation();
            moveFocus(itemsNow, activeIndex, key === 'ArrowRight' ? 1 : -1);
        };

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [isActive]);
};

/** 在一列控件里按方向挪焦点，跳过此刻不在场（或者已经隐藏）的那些。 */
function moveFocus(list: readonly TvHomeNavItem[], fromIndex: number, delta: number): boolean {
    if (!list.length) return false;
    for (let step = 1; step <= list.length; step += 1) {
        const index = (((fromIndex + delta * step) % list.length) + list.length) % list.length;
        const candidate = list[index];
        if (!candidate) continue;
        const element = candidate.getElement();
        if (!element) continue;
        element.focus({ preventScroll: true });
        candidate.onFocus?.();
        return true;
    }
    return false;
}

/** 落到一列控件里的第一个（此刻在场的那个）。 */
function focusFirst(list: readonly TvHomeNavItem[]): boolean {
    for (const candidate of list) {
        const element = candidate.getElement();
        if (!element) continue;
        element.focus({ preventScroll: true });
        candidate.onFocus?.();
        return true;
    }
    return false;
}

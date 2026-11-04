// src/utils/tvSpatialFocus.ts
//
// 电视上的「空间导航」：按方向把焦点挪到那个方向上最近、最符合直觉的一个可聚焦元素。

export type TvDirection = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE_SELECTOR = [
    'a[href]:not([tabindex="-1"])',
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="option"]:not([aria-disabled="true"])',
    '[role="menuitem"]:not([aria-disabled="true"])',
].join(',');

/** 元素在屏幕上是不是真的占着地方且可交互（未被隐藏、未处于 inert 层、也不是自管理焦点的 listbox 子项）。 */
export const isTvFocusableVisible = (element: HTMLElement): boolean => {
    if (element.closest('[aria-hidden="true"], [inert]')) return false;
    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;
    // 若 role="option" 位于自身接管方向键的 role="listbox"[tabindex="0"] 内（如登录平台列、CustomSelect），
    // 焦点应停在 listbox 本体，避免抢走上下方向键。
    if (element.getAttribute('role') === 'option') {
        const ownerListbox = element.closest<HTMLElement>('[role="listbox"][tabindex="0"]');
        if (ownerListbox && ownerListbox !== element) return false;
    }
    // 排除作为滚动承载区的大容器（如设置右侧面板本体）
    if (
        element.hasAttribute('data-tv-content')
        || element.hasAttribute('data-folia-settings-content')
        || element.hasAttribute('data-folia-settings-panel')
        || element.hasAttribute('data-folia-studio-window')
        || element.hasAttribute('data-folia-keyboard-window')
    ) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
    return true;
};

/** 根节点里所有看得见的可聚焦元素，按文档顺序。 */
export const collectTvFocusables = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isTvFocusableVisible);

const centreOf = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** 计算两个一维区间的重叠长度；若不重叠则返回负的间距（取绝对值即边到边距离）。 */
const axisGap = (aStart: number, aEnd: number, bStart: number, bEnd: number): number => {
    if (aEnd < bStart) return bStart - aEnd;
    if (bEnd < aStart) return aStart - bEnd;
    return 0;
};

/**
 * 从 `from` 出发，按方向找下一个该获得焦点的元素。找不到返回 null。
 *
 * 结合中心向量与矩形投影重叠度打分，使得宽窄不一的设置行、双栏布局与网格卡片切换更加准确。
 */
export const findTvFocusTarget = (
    root: HTMLElement,
    from: HTMLElement | null,
    direction: TvDirection,
): HTMLElement | null => {
    const candidates = collectTvFocusables(root);
    if (!candidates.length) return null;

    if (!from || !root.contains(from)) {
        return candidates[0] ?? null;
    }

    const originRect = from.getBoundingClientRect();
    if (originRect.width <= 0 || originRect.height <= 0) {
        return candidates[0] ?? null;
    }

    const origin = centreOf(originRect);
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const element of candidates) {
        if (element === from || element.contains(from) || from.contains(element)) continue;
        const rect = element.getBoundingClientRect();
        const centre = centreOf(rect);
        const dx = centre.x - origin.x;
        const dy = centre.y - origin.y;

        let along: number;
        let acrossEdgeGap: number;
        let acrossCentreGap: number;
        switch (direction) {
            case 'left':
                along = origin.x - centre.x;
                if (rect.left >= originRect.left - 2 && along <= 2) continue;
                acrossEdgeGap = axisGap(originRect.top, originRect.bottom, rect.top, rect.bottom);
                acrossCentreGap = Math.abs(dy);
                break;
            case 'right':
                along = centre.x - origin.x;
                if (rect.right <= originRect.right + 2 && along <= 2) continue;
                acrossEdgeGap = axisGap(originRect.top, originRect.bottom, rect.top, rect.bottom);
                acrossCentreGap = Math.abs(dy);
                break;
            case 'up':
                along = origin.y - centre.y;
                if (rect.top >= originRect.top - 2 && along <= 2) continue;
                acrossEdgeGap = axisGap(originRect.left, originRect.right, rect.left, rect.right);
                acrossCentreGap = Math.abs(dx);
                break;
            default:
                along = centre.y - origin.y;
                if (rect.bottom <= originRect.bottom + 2 && along <= 2) continue;
                acrossEdgeGap = axisGap(originRect.left, originRect.right, rect.left, rect.right);
                acrossCentreGap = Math.abs(dx);
                break;
        }

        if (along <= 2) continue;

        // 投影有重叠（如上下排列但左右位置略错开的设置行控件）显著降低跨轴惩罚，优先保持在同一视觉列/行内。
        const score = along + acrossEdgeGap * 2.6 + acrossCentreGap * 0.45;
        if (score < bestScore) {
            bestScore = score;
            best = element;
        }
    }

    return best;
};

/** 聚焦，并把它平滑滚进可视范围。 */
export const focusTvElement = (element: HTMLElement): void => {
    if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '-1');
    }
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

/**
 * 按下遥控器确认键（Enter）时，对非原生 button/a/input 的交互节点触发点击。
 */
export const activateTvElement = (element: HTMLElement): boolean => {
    if (
        element instanceof HTMLButtonElement
        || element instanceof HTMLAnchorElement
        || element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
    ) {
        return false;
    }
    if (
        element.matches(
            '[role="option"], [role="menuitem"], [role="tab"], [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [data-explore-card], [data-grid3d-index]',
        )
    ) {
        element.click();
        return true;
    }
    return false;
};

export const tvDirectionOf = (key: string): TvDirection | null => {
    switch (key) {
        case 'ArrowLeft':
            return 'left';
        case 'ArrowRight':
            return 'right';
        case 'ArrowUp':
            return 'up';
        case 'ArrowDown':
            return 'down';
        default:
            return null;
    }
};

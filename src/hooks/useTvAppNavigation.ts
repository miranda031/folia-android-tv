import { useEffect } from 'react';
import { isAndroidTv } from '../platform/runtime';
import { useBravaisSeamStore } from '../library/suites/bravais/bravaisSeamLevel';
import {
    dispatchTvEnterBubble,
    dispatchTvKeyCapture,
    focusBravaisSeamWhenReady,
} from '../services/tvNavigationEngine';
import { startTvPerformanceWatchdog } from '../services/tvPerformanceProfile';
import { setIsPanelOpen, useAppViewStore } from '../stores/useAppViewStore';
import { openSettings, useSettingsModalStore } from '../stores/useSettingsModalStore';
import { collectTvFocusables, focusTvElement, isTvFocusableVisible } from '../utils/tvSpatialFocus';

/**
 * 挂载在 App 根部的全局 Android TV 遥控器协调 Hook：
 * 1. 在 window 捕获阶段统一调度所有浮层、设置、主题工坊、搜索、六边形网格与播放页的 D-pad 导航；
 * 2. 在冒泡阶段为非 button 交互元素补齐遥控器 OK（Enter）点击；
 * 3. 在播放页打开右侧 UnifiedPanel 时自动将焦点移入面板首个控件；
 * 4. 响应电视遥控器实体菜单键（KEYCODE_MENU -> folia-tv-menu）：播放页开关右侧控制面板，主页开关设置面板。
 */
export function useTvAppNavigation(): void {
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const currentView = useAppViewStore(state => state.view);

    useEffect(() => {
        if (!isAndroidTv()) return undefined;

        const onKeyCapture = (event: KeyboardEvent) => {
            dispatchTvKeyCapture(event);
        };
        const onKeyBubble = (event: KeyboardEvent) => {
            dispatchTvEnterBubble(event);
        };
        const onTvMenu = () => {
            const view = useAppViewStore.getState().view;
            if (view === 'player') {
                setIsPanelOpen(!useAppViewStore.getState().isPanelOpen);
                return;
            }
            const settingsState = useSettingsModalStore.getState();
            if (settingsState.settingsModalState.isOpen) {
                settingsState.closeSettings();
                return;
            }
            if (view === 'home') {
                const bravaisStage = document.querySelector<HTMLElement>(
                    '[data-library-stage="bravais"][data-bravais-active]',
                );
                if (bravaisStage) {
                    const seamTab = bravaisStage.querySelector<HTMLButtonElement>('.bravais-seam-tab');
                    const seamStore = useBravaisSeamStore.getState();
                    if (seamTab && isTvFocusableVisible(seamTab)) {
                        seamTab.click();
                        focusBravaisSeamWhenReady(bravaisStage);
                        return;
                    }
                    if (seamStore.level !== 'full') {
                        if (seamStore.level === 'hidden') seamStore.restore();
                        else seamStore.setLevel('full');
                        focusBravaisSeamWhenReady(bravaisStage);
                        return;
                    }
                }
            }
            openSettings('options');
        };

        const stopWatchdog = startTvPerformanceWatchdog();

        window.addEventListener('keydown', onKeyCapture, { capture: true });
        window.addEventListener('keydown', onKeyBubble);
        window.addEventListener('folia-tv-menu', onTvMenu);

        return () => {
            stopWatchdog();
            window.removeEventListener('keydown', onKeyCapture, { capture: true });
            window.removeEventListener('keydown', onKeyBubble);
            window.removeEventListener('folia-tv-menu', onTvMenu);
        };
    }, []);

    // 播放页右侧控制面板展开时，自动把焦点移入面板内第一个可操作控件
    useEffect(() => {
        if (!isAndroidTv() || currentView !== 'player' || !isPanelOpen) return undefined;
        const timer = window.setTimeout(() => {
            const surface = document.querySelector<HTMLElement>('[data-testid="unified-panel-surface"]');
            if (!surface || surface.contains(document.activeElement)) return;
            const first = collectTvFocusables(surface)[0];
            if (first) focusTvElement(first);
        }, 60);
        return () => window.clearTimeout(timer);
    }, [currentView, isPanelOpen]);
}

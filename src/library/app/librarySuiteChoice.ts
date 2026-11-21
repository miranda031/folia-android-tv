import { collectionKey } from '../core/collection/collectionIdentity';
import { useLibrarySuiteStore } from '../core/suite/useLibrarySuiteStore';
import type { LibrarySuiteId } from '../core/suite/suite.contract';
import { getActiveGridViewCollection, useCollectionNavigationStore } from '../../stores/useCollectionNavigationStore';
import { listLibrarySuites, resolveActiveLibrarySuiteId } from '../registry';
import { switchLibrarySuite } from './switchLibrarySuite';
import { isAndroidTv } from '../../platform/runtime';

// src/library/app/librarySuiteChoice.ts
// 正式设置项（界面设置的「资料库界面」与命令面板的 picker）用的 suite 选择入口：从集合导航快照算出当前会话 key，
// 再走与 DEV 浮层同一条 switchLibrarySuite。展示「当前 suite」一律用实际生效的那套（store 的值可能不可用）。

/** 首页上切 suite 时交给 switchLibrarySuite 的会话 key（首页没有集合浏览会话，冲刷什么都不做）。 */
export const LIBRARY_HOME_SESSION_KEY = 'home';

/**
 * 当前的浏览会话 key：导航栈顶那一层的 collectionKey（集合页与歌手页都是），在首页时是 LIBRARY_HOME_SESSION_KEY。
 * 与集合宿主交给 DEV 浮层的 key 同一个算法（栈顶 → collectionKey）。
 */
export const resolveCurrentLibrarySessionKey = (): string => {
    const active = getActiveGridViewCollection(useCollectionNavigationStore.getState().snapshot);
    return active ? collectionKey(active) : LIBRARY_HOME_SESSION_KEY;
};

/** 用户在设置或命令面板里选了一套 suite。 */
export const chooseLibrarySuite = (suiteId: LibrarySuiteId): void => {
    switchLibrarySuite(resolveCurrentLibrarySessionKey(), suiteId);
};

export type LibrarySuiteOption = { id: LibrarySuiteId; labelKey: string };

// 可用的 suite 在构建时就定了，按需首次调用时缓存一次，避免循环引用在模块顶层求值阶段触发 TDZ。
let cachedSuiteOptions: readonly LibrarySuiteOption[] | null = null;

/** 设置项与命令面板列出的选项：registry 里可用的 suite（默认 suite 在最前）。 */
export const listLibrarySuiteOptions = (): readonly LibrarySuiteOption[] => {
    if (!cachedSuiteOptions) {
        cachedSuiteOptions = Object.freeze(
            listLibrarySuites().map(suite => ({ id: suite.id, labelKey: suite.labelKey })),
        );
    }
    return cachedSuiteOptions;
};

/**
 * 首启引导第一页只问这两套：网格（经典）与 bravais（无限），顺序固定。TUI 这类开发用 suite 即使在这个构建里
 * 可用也不出现——引导是给第一次打开的人看的，设置页与命令面板照旧列出全部可用的 suite。
 */
export const ONBOARDING_LIBRARY_SUITE_IDS: readonly LibrarySuiteId[] = Object.freeze(['grid', 'bravais']);

/** 从可用的 suite 里挑出引导要问的那几套（按 ONBOARDING_LIBRARY_SUITE_IDS 的顺序）。 */
export const pickOnboardingLibrarySuiteIds = (available: readonly LibrarySuiteId[]): readonly LibrarySuiteId[] => (
    ONBOARDING_LIBRARY_SUITE_IDS.filter(id => available.includes(id))
);

let cachedOnboardingSuiteIds: readonly LibrarySuiteId[] | null = null;

/** 首启引导第一页的选项。 */
export const listOnboardingLibrarySuiteIds = (): readonly LibrarySuiteId[] => {
    if (!cachedOnboardingSuiteIds) {
        cachedOnboardingSuiteIds = Object.freeze(
            pickOnboardingLibrarySuiteIds(listLibrarySuiteOptions().map(option => option.id)),
        );
    }
    return cachedOnboardingSuiteIds;
};

/** 两套都可用时首启引导才有「选资料库界面」那一页；否则只剩「播放后进入的视图」一页。 */
export const hasOnboardingLibrarySuiteChoice = (): boolean => listOnboardingLibrarySuiteIds().length > 1;

/**
 * 首启提问的「资料库界面」那一页关掉时调用：把此刻实际生效的 suite 记成用户的选择（写入存储）。没点卡片直接确认也算
 * 选了——之后改初始选择（LIBRARY_SUITE_INITIAL_CHOICE）不会再把这些人带走。生效的就是它，画面不变，不走切换。
 */
export const confirmOnboardingLibrarySuite = (): void => {
    const store = useLibrarySuiteStore.getState();
    store.setSuite(resolveActiveLibrarySuiteId(store.suite));
};

/**
 * 首页这套 suite 是不是一面墙（bravais）：墙与 Lattice 是同一类界面，左下角的正在播放卡片在墙上与在 Lattice 上一样常在，
 * 不看「在首页显示」开关（那个开关管网格 / TUI 的首页）。
 */
export const isWallLibrarySuite = (suiteId: LibrarySuiteId): boolean => suiteId === 'bravais';

/** 此刻实际生效的 suite（非响应式，命令面板用）。电视端固定使用轻量稳定的经典网格（grid），剔除高显存消耗的无限画布墙（bravais）。 */
export const getActiveLibrarySuiteId = (): LibrarySuiteId => (
    isAndroidTv() ? 'grid' : resolveActiveLibrarySuiteId(useLibrarySuiteStore.getState().suite)
);

/** 实际生效的 suite（响应式，设置项与 DEV 浮层用）。 */
export const useActiveLibrarySuiteId = (): LibrarySuiteId => (
    useLibrarySuiteStore(state => (isAndroidTv() ? 'grid' : resolveActiveLibrarySuiteId(state.suite)))
);

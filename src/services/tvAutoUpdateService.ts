// src/services/tvAutoUpdateService.ts
//
// Android 电视端/移动端版本检查与自动更新服务：
// 1. 支持「启动时自动检查更新」（enableUpdateCheck）、
//    「发现新版本自动下载更新包」（enableAutoUpdate）、
//    「国内镜像加速下载」（useMirrorAcceleration）。
// 2. 通过 GitHub Releases API 检查 whycfawa/folia-android 最新版本，智能比对语义化版本与 -tv.N 构建号。
// 3. 调用原生 FoliaNative.downloadUpdateApk 流式下载 APK 并实时同步进度百分比，
//    下载完成后支持自动或按遥控器确认键调用 FoliaNative.installUpdateApk 拉起系统安装器完成升级。

import { create } from 'zustand';
import { isAndroidTv } from '../platform/runtime';
import { IS_ANDROID_WEBVIEW } from '../utils/platform';
import { openOutsideLink } from '../utils/system/outsideLink';
import { setStatusMessage } from '../stores/useStatusMessageStore';

const STORAGE_KEY_ENABLE_CHECK = 'folia_tv_enable_update_check';
const STORAGE_KEY_ENABLE_AUTO = 'folia_tv_enable_auto_update';
const STORAGE_KEY_MIRROR_ACCEL = 'folia_tv_update_mirror_accel';
const STORAGE_KEY_IGNORED_VER = 'folia_tv_update_ignored_version';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/miranda031/folia-android-tv/releases?per_page=10';
const GITHUB_RELEASES_PAGE = 'https://github.com/miranda031/folia-android-tv/releases';
const GITHUB_MIRROR_PREFIX = 'https://ghfast.top/';

export type TvUpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'up-to-date'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';

export interface TvUpdateState {
    enableUpdateCheck: boolean;
    enableAutoUpdate: boolean;
    useMirrorAcceleration: boolean;
    ignoredVersion: string | null;
    status: TvUpdateStatus;
    currentVersion: string;
    latestVersion: string | null;
    releaseNotes: string | null;
    apkUrl: string | null;
    apkFileName: string | null;
    releasePageUrl: string;
    downloadProgress: number;
    downloadedFilePath: string | null;
    errorMessage: string | null;
    lastCheckedAt: number | null;
    isUpdateModalOpen: boolean;
    setEnableUpdateCheck: (enabled: boolean) => void;
    setEnableAutoUpdate: (enabled: boolean) => void;
    setUseMirrorAcceleration: (enabled: boolean) => void;
    setIgnoredVersion: (version: string | null) => void;
    setIsUpdateModalOpen: (open: boolean) => void;
    checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
    downloadUpdate: (options?: { autoInstall?: boolean }) => Promise<void>;
    installDownloadedUpdate: () => Promise<void>;
    openReleasePage: () => void;
}

type NativeUpdaterPlugin = {
    httpRequest?: (options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyText: string;
        bodyBase64: string;
        redirect: string;
    }) => Promise<{
        status: number;
        bodyText?: string;
        bodyBase64?: string;
    }>;
    downloadUpdateApk?: (options: {
        url: string;
        fileName: string;
    }) => Promise<{
        filePath: string;
        size: number;
    }>;
    installUpdateApk?: (options: {
        filePath: string;
    }) => Promise<{
        started: boolean;
    }>;
    addListener?: (
        eventName: string,
        listenerFunc: (data: { bytesRead?: number; totalBytes?: number; percent?: number }) => void,
    ) => Promise<{ remove: () => Promise<void> } | { remove: () => void }>;
};

const getFoliaNative = (): NativeUpdaterPlugin | null => {
    if (typeof window === 'undefined') return null;
    const cap = (window as unknown as {
        Capacitor?: {
            Plugins?: { FoliaNative?: NativeUpdaterPlugin };
        };
    }).Capacitor;
    return cap?.Plugins?.FoliaNative ?? null;
};

const readBool = (key: string, defaultVal: boolean): boolean => {
    if (typeof window === 'undefined') return defaultVal;
    try {
        const raw = localStorage.getItem(key);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
    } catch {
        // ignore
    }
    return defaultVal;
};

const writeBool = (key: string, val: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, val ? 'true' : 'false');
    } catch {
        // ignore
    }
};

const readStr = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStr = (key: string, val: string | null): void => {
    if (typeof window === 'undefined') return;
    try {
        if (val === null) localStorage.removeItem(key);
        else localStorage.setItem(key, val);
    } catch {
        // ignore
    }
};

export function normalizeVersionTag(raw: string | null | undefined): string {
    return String(raw || '')
        .trim()
        .replace(/^[vV]+/, '');
}

/**
 * 比较两个版本号（支持 `0.7.25-tv.16` vs `0.7.25-tv.15` vs `0.8.0`）。
 * 若 candidate > current 返回 > 0；相等返回 0；小于返回 < 0。
 */
export function compareFoliaVersions(candidateRaw: string, currentRaw: string): number {
    const candidate = normalizeVersionTag(candidateRaw);
    const current = normalizeVersionTag(currentRaw);
    if (candidate === current) return 0;

    const parseParts = (ver: string) => {
        const [corePart = '0.0.0', suffixPart = ''] = ver.split('-', 2);
        const coreNums = corePart.split('.').map(n => Number.parseInt(n, 10) || 0);
        const tvMatch = /(?:tv|build|rc|beta|alpha)[._-]?(\d+)/i.exec(suffixPart)
            ?? /(\d+)/.exec(suffixPart);
        const suffixNum = tvMatch ? Number.parseInt(tvMatch[1], 10) || 0 : 0;
        return {
            major: coreNums[0] ?? 0,
            minor: coreNums[1] ?? 0,
            patch: coreNums[2] ?? 0,
            suffixNum,
            hasSuffix: Boolean(suffixPart),
        };
    };

    const a = parseParts(candidate);
    const b = parseParts(current);
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.suffixNum !== b.suffixNum) return a.suffixNum - b.suffixNum;
    return candidate.localeCompare(current);
}

interface GithubReleaseAsset {
    name?: string;
    browser_download_url?: string;
    size?: number;
}

interface GithubReleaseItem {
    tag_name?: string;
    name?: string;
    body?: string;
    html_url?: string;
    draft?: boolean;
    assets?: GithubReleaseAsset[];
}

async function fetchJsonText(url: string): Promise<string> {
    const plugin = getFoliaNative();
    if (plugin?.httpRequest) {
        const res = await plugin.httpRequest({
            url,
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'Folia-Android-TV-Updater',
            },
            bodyText: '',
            bodyBase64: '',
            redirect: 'follow',
        });
        if (res.status >= 200 && res.status < 300) {
            if (res.bodyText) return res.bodyText;
            if (res.bodyBase64) {
                return new TextDecoder('utf-8').decode(
                    Uint8Array.from(atob(res.bodyBase64), c => c.charCodeAt(0)),
                );
            }
        }
        throw new Error(`HTTP ${res.status}`);
    }
    const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
}

const currentAppVersion = normalizeVersionTag(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.7.25-tv.16',
);

export const useTvUpdateStore = create<TvUpdateState>((set, get) => ({
    enableUpdateCheck: readBool(STORAGE_KEY_ENABLE_CHECK, true),
    enableAutoUpdate: readBool(STORAGE_KEY_ENABLE_AUTO, true),
    useMirrorAcceleration: readBool(STORAGE_KEY_MIRROR_ACCEL, true),
    ignoredVersion: readStr(STORAGE_KEY_IGNORED_VER),
    status: 'idle',
    currentVersion: currentAppVersion,
    latestVersion: null,
    releaseNotes: null,
    apkUrl: null,
    apkFileName: null,
    releasePageUrl: GITHUB_RELEASES_PAGE,
    downloadProgress: 0,
    downloadedFilePath: null,
    errorMessage: null,
    lastCheckedAt: null,
    isUpdateModalOpen: false,

    setEnableUpdateCheck: (enabled) => {
        writeBool(STORAGE_KEY_ENABLE_CHECK, enabled);
        set({ enableUpdateCheck: enabled });
    },

    setEnableAutoUpdate: (enabled) => {
        writeBool(STORAGE_KEY_ENABLE_AUTO, enabled);
        set({ enableAutoUpdate: enabled });
    },

    setUseMirrorAcceleration: (enabled) => {
        writeBool(STORAGE_KEY_MIRROR_ACCEL, enabled);
        set({ useMirrorAcceleration: enabled });
    },

    setIgnoredVersion: (version) => {
        writeStr(STORAGE_KEY_IGNORED_VER, version);
        set({ ignoredVersion: version });
    },

    setIsUpdateModalOpen: (open) => set({ isUpdateModalOpen: open }),

    checkForUpdates: async (options = {}) => {
        const { silent = false } = options;
        const state = get();
        if (state.status === 'checking' || state.status === 'downloading') return;

        set({
            status: 'checking',
            errorMessage: null,
        });

        try {
            const rawText = await fetchJsonText(GITHUB_RELEASES_API);
            const parsed = JSON.parse(rawText) as unknown;
            const releases: GithubReleaseItem[] = Array.isArray(parsed)
                ? (parsed as GithubReleaseItem[]).filter(r => r && !r.draft)
                : [];

            let bestRelease: GithubReleaseItem | null = null;
            let bestVersion = state.currentVersion;

            for (const rel of releases) {
                const candidateTag = normalizeVersionTag(rel.tag_name || rel.name || '');
                if (!candidateTag) continue;
                if (compareFoliaVersions(candidateTag, bestVersion) > 0) {
                    bestVersion = candidateTag;
                    bestRelease = rel;
                }
            }

            const now = Date.now();
            if (!bestRelease || compareFoliaVersions(bestVersion, state.currentVersion) <= 0) {
                set({
                    status: 'up-to-date',
                    latestVersion: state.currentVersion,
                    lastCheckedAt: now,
                });
                if (!silent) {
                    setStatusMessage({
                        type: 'info',
                        text: `当前已是最新版本 (v${state.currentVersion})`,
                    });
                }
                return;
            }

            const assets = Array.isArray(bestRelease.assets) ? bestRelease.assets : [];
            const tvApkAsset = assets.find(a => /tv.*\.apk$/i.test(String(a.name || '')))
                ?? assets.find(a => /\.apk$/i.test(String(a.name || '')));

            const apkUrl = tvApkAsset?.browser_download_url ?? null;
            const apkFileName = tvApkAsset?.name ?? `Folia-Android-TV-${bestVersion}.apk`;
            const releasePageUrl = bestRelease.html_url || GITHUB_RELEASES_PAGE;
            const releaseNotes = String(bestRelease.body || '').trim() || `发现新版本 v${bestVersion}`;

            set({
                status: 'available',
                latestVersion: bestVersion,
                releaseNotes,
                apkUrl,
                apkFileName,
                releasePageUrl,
                lastCheckedAt: now,
                downloadProgress: 0,
                downloadedFilePath: null,
            });

            const isIgnored = silent && get().ignoredVersion === bestVersion;
            if (!isIgnored) {
                if (get().enableAutoUpdate && apkUrl && IS_ANDROID_WEBVIEW) {
                    // 后台自动下载更新包，下载过程中或下载完毕后弹窗提示用户一键安装
                    set({ isUpdateModalOpen: true });
                    void get().downloadUpdate({ autoInstall: !silent });
                } else {
                    set({ isUpdateModalOpen: true });
                }
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            set({
                status: 'error',
                errorMessage: msg,
                lastCheckedAt: Date.now(),
            });
            if (!silent) {
                setStatusMessage({
                    type: 'error',
                    text: `检查更新失败：${msg}`,
                });
            }
        }
    },

    downloadUpdate: async (options = {}) => {
        const { autoInstall = true } = options;
        const state = get();
        if (!state.apkUrl) {
            state.openReleasePage();
            return;
        }
        const plugin = getFoliaNative();
        if (!plugin?.downloadUpdateApk) {
            state.openReleasePage();
            return;
        }

        set({
            status: 'downloading',
            downloadProgress: 0,
            errorMessage: null,
        });

        let listenerHandle: { remove: () => Promise<void> | void } | null = null;
        try {
            if (plugin.addListener) {
                listenerHandle = await plugin.addListener('updateDownloadProgress', (data) => {
                    const pct = typeof data?.percent === 'number' && data.percent >= 0
                        ? Math.min(100, Math.max(0, Math.round(data.percent)))
                        : 50;
                    set({ downloadProgress: pct });
                });
            }

            const rawUrl = state.apkUrl;
            const primaryUrl = state.useMirrorAcceleration && rawUrl.startsWith('https://github.com/')
                ? `${GITHUB_MIRROR_PREFIX}${rawUrl}`
                : rawUrl;
            const fileName = state.apkFileName || `Folia-Android-TV-${state.latestVersion || 'latest'}.apk`;

            let downloadRes: { filePath: string; size: number };
            try {
                downloadRes = await plugin.downloadUpdateApk({ url: primaryUrl, fileName });
            } catch (primaryErr) {
                if (primaryUrl !== rawUrl) {
                    // 镜像失败时自动回退到 GitHub 官方源重试
                    downloadRes = await plugin.downloadUpdateApk({ url: rawUrl, fileName });
                } else {
                    throw primaryErr;
                }
            }

            set({
                status: 'downloaded',
                downloadProgress: 100,
                downloadedFilePath: downloadRes.filePath,
                isUpdateModalOpen: true,
            });

            if (autoInstall) {
                await get().installDownloadedUpdate();
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            set({
                status: 'error',
                errorMessage: `下载更新包失败 (${msg})`,
            });
            setStatusMessage({
                type: 'error',
                text: `更新包下载失败：${msg}`,
            });
        } finally {
            try {
                await listenerHandle?.remove();
            } catch {
                // ignore
            }
        }
    },

    installDownloadedUpdate: async () => {
        const state = get();
        const plugin = getFoliaNative();
        if (!state.downloadedFilePath || !plugin?.installUpdateApk) {
            if (state.apkUrl) {
                await get().downloadUpdate({ autoInstall: true });
            } else {
                state.openReleasePage();
            }
            return;
        }
        try {
            set({ status: 'installing' });
            await plugin.installUpdateApk({ filePath: state.downloadedFilePath });
            set({ status: 'downloaded' });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            set({
                status: 'error',
                errorMessage: `启动安装器失败 (${msg})`,
            });
            setStatusMessage({
                type: 'error',
                text: `无法拉起系统安装器：${msg}`,
            });
        }
    },

    openReleasePage: () => {
        openOutsideLink(get().releasePageUrl || GITHUB_RELEASES_PAGE);
    },
}));

let bootCheckScheduled = false;

/**
 * 应用启动后延迟 4 秒在后台静默检查更新（不阻塞首屏渲染与遥控器操作）。
 */
export function scheduleTvAutoUpdateCheckOnBoot(): void {
    if (bootCheckScheduled || typeof window === 'undefined' || (!IS_ANDROID_WEBVIEW && !isAndroidTv())) return;
    bootCheckScheduled = true;
    window.setTimeout(() => {
        const state = useTvUpdateStore.getState();
        if (state.enableUpdateCheck) {
            void state.checkForUpdates({ silent: true });
        }
    }, 4000);
}

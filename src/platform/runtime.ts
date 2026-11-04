// src/platform/runtime.ts
// Lightweight runtime checks shared by platform-only features.

export const isCapacitorAndroid = (): boolean => {
    if (typeof window === 'undefined') return false;
    const capacitor = (window as unknown as {
        Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }).Capacitor;
    return capacitor?.getPlatform?.() === 'android' || capacitor?.isNativePlatform?.() === true;
};

/**
 * 这台设备是不是电视（AOSP TV / VIDAA / Google TV 这类电视固件）。
 *
 * 判定靠原生层打在 User-Agent 上的 "FoliaTV" 标记，而不是等页面起来再问原生插件：原生在
 * WebView 加载之前就改好了 UA，所以第一帧之前结论就已经成立——首启引导默认选哪套资料库界面、
 * 屏幕常亮默认开不开，都读这个结论。
 */
export const isAndroidTv = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /(^|\s)FoliaTV(\s|$)/.test(navigator.userAgent || '');
};

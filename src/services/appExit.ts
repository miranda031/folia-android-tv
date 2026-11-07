// src/services/appExit.ts
// 专门的退出应用与后台切换调度器（针对 Android TV / 电视盒子 / Android 手机与桌面环境）

/**
 * 彻底退出应用：
 * 1. 暂停所有前端音频与视频流
 * 2. 停止 Android 原生后台前台播放服务（清除常驻通知）
 * 3. 释放 WakeLock、WiFiLock 与音频焦点
 * 4. 结束 Activity 并彻底终止进程
 */
export async function exitApp(): Promise<void> {
    try {
        const audioElements = document.querySelectorAll('audio, video');
        audioElements.forEach((el) => {
            try {
                (el as HTMLMediaElement).pause();
            } catch {}
        });
    } catch {}

    // 优先调用专属硬件桥接接口（电视原生直连，零延迟）
    if (typeof window !== 'undefined') {
        const tvBridge = (window as unknown as { FoliaTvHardware?: { exitApp?: () => void } }).FoliaTvHardware;
        if (tvBridge && typeof tvBridge.exitApp === 'function') {
            try {
                tvBridge.exitApp();
                return;
            } catch (e) {
                console.error('[appExit] TvHardwareBridge exit failed:', e);
            }
        }

        // 调用 Capacitor 原生桥接接口
        const capacitor = (window as unknown as {
            Capacitor?: {
                Plugins?: {
                    FoliaNative?: {
                        exitApp?: () => Promise<unknown>;
                    };
                };
            };
        }).Capacitor;
        const foliaNative = capacitor?.Plugins?.FoliaNative;
        if (foliaNative && typeof foliaNative.exitApp === 'function') {
            try {
                await foliaNative.exitApp();
                return;
            } catch (e) {
                console.error('[appExit] FoliaNative exit failed:', e);
            }
        }

        // 桌面 Electron 环境备选
        const electron = (window as unknown as { electron?: { close?: () => void } }).electron;
        if (electron && typeof electron.close === 'function') {
            try {
                electron.close();
                return;
            } catch {}
        }

        // 普通浏览器窗口备选
        try {
            window.close();
        } catch {}
    }
}

/**
 * 最小化到后台（保留音乐后台播放）
 */
export async function minimizeToBackground(): Promise<void> {
    if (typeof window !== 'undefined') {
        const capacitor = (window as unknown as {
            Capacitor?: {
                Plugins?: {
                    FoliaNative?: {
                        moveTaskToBack?: () => Promise<unknown>;
                    };
                };
            };
        }).Capacitor;
        const foliaNative = capacitor?.Plugins?.FoliaNative;
        if (foliaNative && typeof foliaNative.moveTaskToBack === 'function') {
            try {
                await foliaNative.moveTaskToBack();
            } catch (e) {
                console.error('[appExit] moveTaskToBack failed:', e);
            }
        }
    }
}

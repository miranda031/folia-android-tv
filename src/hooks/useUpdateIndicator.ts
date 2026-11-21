import { useEffect, useState } from 'react';
import { isAndroidTv } from '../platform/runtime';
import { useTvUpdateStore } from '../services/tvAutoUpdateService';
import { IS_ANDROID_WEBVIEW } from '../utils/platform';

// src/hooks/useUpdateIndicator.ts

// 首页「发现新版本」提示：开着更新检查、检测到新版本、且用户还没在设置里看过它时为 true。
// Android / 电视端同步接入 useTvUpdateStore，发现新版本或更新包下载完成时在首页设置图标上亮起更新提示点。
export function useUpdateIndicator(): boolean {
    const [updateStatus, setUpdateStatus] = useState<ElectronUpdateStatus | null>(null);
    const tvUpdateAvailable = useTvUpdateStore(state => (
        state.enableUpdateCheck
        && (state.status === 'available' || state.status === 'downloaded' || state.status === 'downloading')
        && Boolean(state.latestVersion && state.latestVersion !== state.ignoredVersion)
    ));

    useEffect(() => {
        if (!window.electron?.getUpdateStatus) {
            return;
        }

        let disposed = false;

        window.electron.getUpdateStatus().then((status) => {
            if (!disposed) {
                setUpdateStatus(status);
            }
        }).catch(() => {
            if (!disposed) {
                setUpdateStatus(null);
            }
        });

        const unsubscribe = window.electron.onUpdateStatusChanged?.((status) => {
            setUpdateStatus(status);
        });

        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    if (IS_ANDROID_WEBVIEW || isAndroidTv()) {
        return tvUpdateAvailable;
    }

    return Boolean(
        updateStatus?.updateCheckEnabled &&
        updateStatus.availableVersion &&
        !updateStatus.updateSeen
    );
}

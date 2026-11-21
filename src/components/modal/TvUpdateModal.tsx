// src/components/modal/TvUpdateModal.tsx
//
// 电视端发现新版本 / 自动下载完成后的遥控器更新弹窗：
// - 打开时自动聚焦「立即安装 / 立即更新」主按钮，按遥控器 OK 键一键升级；
// - 支持实时显示 APK 下载进度条；
// - 支持「稍后提醒」与「忽略此版本」，按返回键（Escape）安全关闭弹窗。

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { useTvUpdateStore } from '../../services/tvAutoUpdateService';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { focusTvElement } from '../../utils/tvSpatialFocus';

export const TvUpdateModal: React.FC = () => {
    const isOpen = useTvUpdateStore(state => state.isUpdateModalOpen);
    const status = useTvUpdateStore(state => state.status);
    const currentVersion = useTvUpdateStore(state => state.currentVersion);
    const latestVersion = useTvUpdateStore(state => state.latestVersion);
    const releaseNotes = useTvUpdateStore(state => state.releaseNotes);
    const downloadProgress = useTvUpdateStore(state => state.downloadProgress);
    const errorMessage = useTvUpdateStore(state => state.errorMessage);
    const apkUrl = useTvUpdateStore(state => state.apkUrl);
    const close = useTvUpdateStore(state => state.setIsUpdateModalOpen);
    const setIgnoredVersion = useTvUpdateStore(state => state.setIgnoredVersion);
    const downloadUpdate = useTvUpdateStore(state => state.downloadUpdate);
    const installDownloadedUpdate = useTvUpdateStore(state => state.installDownloadedUpdate);
    const openReleasePage = useTvUpdateStore(state => state.openReleasePage);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);

    const primaryBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        const timer = window.setTimeout(() => {
            if (primaryBtnRef.current) {
                focusTvElement(primaryBtnRef.current);
            }
        }, 60);
        return () => window.clearTimeout(timer);
    }, [isOpen, status]);

    const isDownloading = status === 'downloading';
    const isDownloaded = status === 'downloaded' || status === 'installing';

    const handlePrimaryAction = () => {
        if (isDownloading) return;
        if (isDownloaded) {
            void installDownloadedUpdate();
        } else if (apkUrl) {
            void downloadUpdate({ autoInstall: true });
        } else {
            openReleasePage();
        }
    };

    const bgClass = isDaylight
        ? 'bg-white border-zinc-200 text-zinc-900'
        : 'bg-[#18181b] border-zinc-800 text-zinc-50';
    const subTextClass = isDaylight ? 'text-zinc-500' : 'text-zinc-400';

    return (
        <AnimatePresence>
            {isOpen && latestVersion && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 p-4"
                    onClick={() => close(false)}
                    data-folia-tv-update-modal="true"
                    data-testid="tv-update-modal"
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 8 }}
                        transition={{ duration: 0.2 }}
                        onClick={e => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="tv-update-modal-title"
                        className={`${bgClass} w-full max-w-lg rounded-3xl border p-6 shadow-2xl`}
                    >
                        <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-400">
                                <Sparkles size={22} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <h2 id="tv-update-modal-title" className="text-lg font-bold">
                                    发现新版本 v{latestVersion}
                                </h2>
                                <p className={`text-xs ${subTextClass}`}>
                                    当前版本 v{currentVersion} · 电视端在线升级
                                </p>
                            </div>
                        </div>

                        {releaseNotes && (
                            <div
                                className={`mt-4 max-h-40 overflow-y-auto rounded-2xl p-3.5 text-xs leading-relaxed whitespace-pre-wrap ${
                                    isDaylight ? 'bg-zinc-100 text-zinc-700' : 'bg-white/[0.05] text-zinc-300'
                                }`}
                            >
                                {releaseNotes}
                            </div>
                        )}

                        {isDownloading && (
                            <div className="mt-4">
                                <div className="mb-1.5 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5 font-medium text-blue-400">
                                        <RefreshCw size={13} className="animate-spin" />
                                        正在下载更新包...
                                    </span>
                                    <span className="font-mono">{downloadProgress}%</span>
                                </div>
                                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                                    <div
                                        className="h-full rounded-full bg-blue-500 transition-all duration-200"
                                        style={{ width: `${Math.max(4, downloadProgress)}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {isDownloaded && (
                            <div className="mt-4 rounded-xl bg-emerald-500/15 px-3.5 py-2.5 text-xs font-medium text-emerald-400">
                                更新包已下载就绪，按遥控器【确定/OK】键即可拉起系统安装器完成升级。
                            </div>
                        )}

                        {errorMessage && (
                            <div className="mt-4 rounded-xl bg-red-500/15 px-3.5 py-2.5 text-xs text-red-400">
                                {errorMessage}
                            </div>
                        )}

                        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setIgnoredVersion(latestVersion);
                                    close(false);
                                }}
                                className={`rounded-full px-4 py-2.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-white ${
                                    isDaylight
                                        ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                                        : 'bg-white/[0.06] text-zinc-300 hover:bg-white/10'
                                }`}
                            >
                                忽略此版本
                            </button>
                            <button
                                type="button"
                                onClick={() => close(false)}
                                className={`rounded-full px-4 py-2.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-white ${
                                    isDaylight
                                        ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                                        : 'bg-white/[0.08] text-zinc-200 hover:bg-white/15'
                                }`}
                            >
                                稍后提醒
                            </button>
                            <button
                                ref={primaryBtnRef}
                                type="button"
                                disabled={isDownloading}
                                onClick={handlePrimaryAction}
                                className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#18181b] disabled:opacity-50"
                            >
                                {isDownloading ? (
                                    <>
                                        <RefreshCw size={15} className="animate-spin" />
                                        下载中 ({downloadProgress}%)
                                    </>
                                ) : isDownloaded ? (
                                    <>
                                        <Download size={15} />
                                        立即安装更新
                                    </>
                                ) : apkUrl ? (
                                    <>
                                        <Download size={15} />
                                        立即下载并更新
                                    </>
                                ) : (
                                    <>
                                        <ExternalLink size={15} />
                                        前往下载页
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default TvUpdateModal;

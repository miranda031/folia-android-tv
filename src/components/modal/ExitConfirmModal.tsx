// src/components/modal/ExitConfirmModal.tsx
// 专门的电视/多端退出确认弹窗：支持遥控器四向导航、OK 键确认、返回键取消，提供「彻底退出」与「后台播放」

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, Headphones, X, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useExitModalStore } from '../../stores/useExitModalStore';
import { exitApp, minimizeToBackground } from '../../services/appExit';
import { isAndroidTv } from '../../platform/runtime';

interface ExitConfirmModalProps {
    isDaylight?: boolean;
}

export const ExitConfirmModal: React.FC<ExitConfirmModalProps> = ({ isDaylight = false }) => {
    const { t } = useTranslation();
    const isOpen = useExitModalStore(state => state.isOpen);
    const closeExitModal = useExitModalStore(state => state.closeExitModal);

    const exitBtnRef = useRef<HTMLButtonElement>(null);
    const backgroundBtnRef = useRef<HTMLButtonElement>(null);
    const cancelBtnRef = useRef<HTMLButtonElement>(null);

    // 打开时自动聚焦于默认操作按钮（遥控器可直接按 OK 退出或切换）
    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setTimeout(() => {
            exitBtnRef.current?.focus();
        }, 120);
        return () => window.clearTimeout(timer);
    }, [isOpen]);

    // 键盘 / 遥控器按键拦截（左右方向键切换焦点，Escape 取消）
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeExitModal();
            return;
        }

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            if (document.activeElement === exitBtnRef.current) {
                backgroundBtnRef.current?.focus();
            } else if (document.activeElement === backgroundBtnRef.current) {
                cancelBtnRef.current?.focus();
            } else {
                exitBtnRef.current?.focus();
            }
            return;
        }

        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (document.activeElement === cancelBtnRef.current) {
                backgroundBtnRef.current?.focus();
            } else if (document.activeElement === backgroundBtnRef.current) {
                exitBtnRef.current?.focus();
            } else {
                cancelBtnRef.current?.focus();
            }
            return;
        }
    };

    const handleConfirmExit = async () => {
        closeExitModal();
        await exitApp();
    };

    const handleMinimize = async () => {
        closeExitModal();
        await minimizeToBackground();
    };

    const bgClass = isDaylight
        ? 'bg-white/95 border-zinc-200 text-zinc-900 shadow-2xl'
        : 'bg-[#14151a]/95 border-white/10 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.85)]';
    const subTextClass = isDaylight ? 'text-zinc-600' : 'text-zinc-400';

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
                    onClick={closeExitModal}
                    onKeyDown={handleKeyDown}
                    data-folia-themed-dialog="true"
                    data-folia-exit-modal="true"
                >
                    <motion.div
                        initial={{ scale: 0.92, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.92, opacity: 0, y: 12 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                        onClick={(e) => e.stopPropagation()}
                        className={`relative w-full max-w-lg rounded-3xl border p-7 md:p-8 backdrop-blur-2xl flex flex-col items-center text-center ${bgClass}`}
                    >
                        {/* 右上角关闭按钮 */}
                        <button
                            type="button"
                            onClick={closeExitModal}
                            tabIndex={-1}
                            className="absolute top-5 right-5 p-2 rounded-full opacity-40 hover:opacity-100 hover:bg-white/10 transition-all"
                            title={t('ui.close')}
                            aria-label={t('ui.close')}
                        >
                            <X size={18} />
                        </button>

                        {/* 退出图标徽章 */}
                        <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center mb-5 shadow-lg shadow-red-500/10 text-red-400">
                            <Power size={32} className="stroke-[2.2]" />
                        </div>

                        {/* 标题与描述 */}
                        <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-2">
                            退出 Folia TV
                        </h2>
                        <p className={`text-sm md:text-base leading-relaxed max-w-sm mb-7 ${subTextClass}`}>
                            确定要退出播放器吗？你可以彻底关闭应用，或者将音乐保留在电视后台继续播放。
                        </p>

                        {/* 操作按钮组（遥控器可左右平移聚焦） */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full">
                            {/* 1. 彻底退出应用 */}
                            <button
                                ref={exitBtnRef}
                                type="button"
                                data-tv-nav="exit-modal-confirm"
                                onClick={handleConfirmExit}
                                className="flex-1 flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-medium text-sm md:text-base shadow-lg shadow-red-600/30 transition-all outline-none focus-visible:ring-4 focus-visible:ring-red-400/60 focus:ring-4 focus:ring-red-400/60"
                            >
                                <LogOut size={18} />
                                <span>彻底退出</span>
                            </button>

                            {/* 2. 最小化后台播放 */}
                            <button
                                ref={backgroundBtnRef}
                                type="button"
                                data-tv-nav="exit-modal-background"
                                onClick={handleMinimize}
                                className="flex-1 flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-zinc-100 font-medium text-sm md:text-base border border-white/10 transition-all outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 focus:ring-4 focus:ring-blue-400/60"
                            >
                                <Headphones size={18} />
                                <span>后台听歌</span>
                            </button>

                            {/* 3. 取消 */}
                            <button
                                ref={cancelBtnRef}
                                type="button"
                                data-tv-nav="exit-modal-cancel"
                                onClick={closeExitModal}
                                className="sm:flex-none flex items-center justify-center py-3.5 px-5 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-sm md:text-base transition-all outline-none focus-visible:ring-4 focus-visible:ring-white/40 focus:ring-4 focus:ring-white/40"
                            >
                                <span>取消</span>
                            </button>
                        </div>

                        {/* 遥控器提示 */}
                        {isAndroidTv() && (
                            <div className="mt-5 text-xs text-white/30 flex items-center gap-1.5">
                                <span>按遥控器【OK】确认，按【返回键】取消</span>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ExitConfirmModal;

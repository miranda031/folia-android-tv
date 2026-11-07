// src/stores/useExitModalStore.ts
// 全局退出确认弹窗状态管理

import { create } from 'zustand';

export interface ExitModalState {
    isOpen: boolean;
    openExitModal: () => void;
    closeExitModal: () => void;
}

export const useExitModalStore = create<ExitModalState>((set) => ({
    isOpen: false,
    openExitModal: () => set({ isOpen: true }),
    closeExitModal: () => set({ isOpen: false }),
}));

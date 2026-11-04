// src/services/tvPerformanceProfile.ts
//
// Android TV 硬件配置识别与自适应画质/动效调优服务：
// 1. 通过原生 TvHardwareBridge（CPU 核数/最高主频、总内存/可用内存、低内存标志、物理分辨率）与 WebGL 渲染器型号，
//    精准识别当前电视机硬件档位：省电流畅（lite）/ 均衡标准（balanced）/ 旗舰画质（high）。
// 2. 根据生效档位动态调节：
//    - 歌词与背景特效 DPR 上限（0.6x / 0.8x / 1.0x）；
//    - Paper WebGL 着色器最大像素预算与双层混合开关（中低端电视关闭第二层 soft-light Dithering 着色器与每帧 CSS filter）；
//    - Tempera / Nebbia / Fume / Lattice 离屏纹理分辨率上限；
//    - Bravais 书库墙遮挡策略（lite / balanced 默认实色不透光信息条，浏览书库墙时完全卸载/挂起底层播放页双 WebGL 着色器，消除久用卡顿）；
// 3. 运行时帧率与内存守护（Watchdog）：定期检测可用内存并在吃紧时通知原生清理 WebView 解码缓存，防止挤入慢速 eMMC Swap；
//    自动模式下若持续掉帧则平滑降档保流畅。

import { create } from 'zustand';
import { isAndroidTv } from '../platform/runtime';
import { PlayerState } from '../types';
import { useLatticeSettingsStore } from '../stores/useLatticeSettingsStore';
import { useLibraryWallLookStore } from '../stores/useLibraryWallLookStore';
import { useMotionSettingsStore } from '../stores/useMotionSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import {
    requestUncappedAnimationFrame,
    cancelUncappedAnimationFrame,
    setGlobalVisualizerFrameRate,
    VISUALIZER_FRAME_RATE_STORAGE_KEY,
} from '../utils/frameRateLimiter';

export type TvPerformanceTier = 'lite' | 'balanced' | 'high';
export type TvPerformanceMode = 'auto' | TvPerformanceTier;

export interface TvHardwareInfo {
    model: string;
    brand: string;
    device: string;
    hardware: string;
    board: string;
    sdkInt: number;
    cpuCores: number;
    cpuMaxFreqKhz: number;
    totalRamMb: number;
    availRamMb: number;
    lowRamThresholdMb: number;
    isLowRamDevice: boolean;
    lowMemory: boolean;
    physicalWidth: number;
    physicalHeight: number;
    density: number;
    gpuVendor: string;
    gpuRenderer: string;
}

export interface TvShaderBudget {
    tier: TvPerformanceTier;
    visualizerDpr: number;
    maxPixels: number;
    minPixelRatio: number;
    allowDualShaderBlend: boolean;
    allowPerFrameCssFilter: boolean;
    temperaMaxResolution: number;
    nebbiaScale: number;
    fumeSnapshotScale: number;
}

interface NativeTvHardwareBridge {
    getHardwareJson?: () => string;
    trimMemory?: () => void;
}

declare global {
    interface Window {
        FoliaTvHardware?: NativeTvHardwareBridge;
    }
}

const TV_PERF_MODE_KEY = 'folia_tv_perf_mode';
const TV_PERF_INIT_KEY = 'folia_tv_perf_init_v1';

const SHADER_BUDGETS: Record<TvPerformanceTier, TvShaderBudget> = {
    lite: {
        tier: 'lite',
        visualizerDpr: 0.6,
        maxPixels: 640 * 360,
        minPixelRatio: 0.45,
        allowDualShaderBlend: false,
        allowPerFrameCssFilter: false,
        temperaMaxResolution: 0.72,
        nebbiaScale: 0.38,
        fumeSnapshotScale: 1,
    },
    balanced: {
        tier: 'balanced',
        visualizerDpr: 0.8,
        maxPixels: 854 * 480,
        minPixelRatio: 0.5,
        allowDualShaderBlend: false,
        allowPerFrameCssFilter: false,
        temperaMaxResolution: 0.85,
        nebbiaScale: 0.45,
        fumeSnapshotScale: 1,
    },
    high: {
        tier: 'high',
        visualizerDpr: 1.0,
        maxPixels: 1280 * 720,
        minPixelRatio: 0.75,
        allowDualShaderBlend: true,
        allowPerFrameCssFilter: true,
        temperaMaxResolution: 1.0,
        nebbiaScale: 0.6,
        fumeSnapshotScale: 1.25,
    },
};

const DEFAULT_HARDWARE_INFO: TvHardwareInfo = {
    model: 'Android TV',
    brand: '',
    device: '',
    hardware: '',
    board: '',
    sdkInt: 0,
    cpuCores: 4,
    cpuMaxFreqKhz: 0,
    totalRamMb: 0,
    availRamMb: 0,
    lowRamThresholdMb: 0,
    isLowRamDevice: false,
    lowMemory: false,
    physicalWidth: 1920,
    physicalHeight: 1080,
    density: 2,
    gpuVendor: '',
    gpuRenderer: '',
};

let cachedGpuInfo: { vendor: string; renderer: string } | null = null;

function probeWebGlGpuOnce(): { vendor: string; renderer: string } {
    if (cachedGpuInfo) return cachedGpuInfo;
    if (typeof document === 'undefined') {
        cachedGpuInfo = { vendor: '', renderer: '' };
        return cachedGpuInfo;
    }
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const gl = (
            canvas.getContext('webgl', { powerPreference: 'low-power' })
            || canvas.getContext('experimental-webgl')
        ) as WebGLRenderingContext | null;
        if (!gl) {
            cachedGpuInfo = { vendor: '', renderer: '' };
            return cachedGpuInfo;
        }
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : String(gl.getParameter(gl.VENDOR) || '');
        const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        cachedGpuInfo = { vendor: vendor.trim(), renderer: renderer.trim() };
        return cachedGpuInfo;
    } catch {
        cachedGpuInfo = { vendor: '', renderer: '' };
        return cachedGpuInfo;
    }
}

export function cleanGpuRendererLabel(raw: string): string {
    if (!raw) return '嵌入式 GPU';
    // 例如 "ANGLE (ARM, Mali-G57, OpenGL ES 3.2)" -> "Mali-G57"
    const angleMatch = /^ANGLE\s*\([^,]+,\s*([^,)]+)/i.exec(raw);
    if (angleMatch?.[1]) return angleMatch[1].trim();
    return raw.replace(/\s*OpenGL ES.*$/i, '').trim() || raw;
}

export function readTvHardwareInfo(): TvHardwareInfo {
    if (typeof window === 'undefined') return DEFAULT_HARDWARE_INFO;
    const dpr = window.devicePixelRatio || 1;
    const fallbackCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const deviceMemGb = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
        ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0)
        : 0;
    const gpu = isAndroidTv() ? probeWebGlGpuOnce() : { vendor: '', renderer: '' };

    let parsed: Partial<TvHardwareInfo> = {};
    try {
        const raw = window.FoliaTvHardware?.getHardwareJson?.();
        if (raw) {
            parsed = JSON.parse(raw) as Partial<TvHardwareInfo>;
        }
    } catch {
        parsed = {};
    }

    return {
        model: String(parsed.model || 'Android TV'),
        brand: String(parsed.brand || ''),
        device: String(parsed.device || ''),
        hardware: String(parsed.hardware || ''),
        board: String(parsed.board || ''),
        sdkInt: Number(parsed.sdkInt || 0),
        cpuCores: Math.max(1, Number(parsed.cpuCores || fallbackCores || 4)),
        cpuMaxFreqKhz: Math.max(0, Number(parsed.cpuMaxFreqKhz || 0)),
        totalRamMb: Math.max(0, Number(parsed.totalRamMb || (deviceMemGb > 0 ? Math.round(deviceMemGb * 1024) : 0))),
        availRamMb: Math.max(0, Number(parsed.availRamMb || 0)),
        lowRamThresholdMb: Math.max(0, Number(parsed.lowRamThresholdMb || 0)),
        isLowRamDevice: Boolean(parsed.isLowRamDevice),
        lowMemory: Boolean(parsed.lowMemory),
        physicalWidth: Math.max(0, Number(parsed.physicalWidth || Math.round((window.screen?.width || 960) * dpr))),
        physicalHeight: Math.max(0, Number(parsed.physicalHeight || Math.round((window.screen?.height || 540) * dpr))),
        density: Number(parsed.density || dpr),
        gpuVendor: gpu.vendor,
        gpuRenderer: gpu.renderer,
    };
}

export function classifyTvHardwareTier(hw: TvHardwareInfo): TvPerformanceTier {
    const gpu = hw.gpuRenderer || '';

    // 低配入门电视芯片判定：<= 2.6GB RAM、双核、低主频 <= 1.45GHz、Android Go LowRam 或入门级 GPU
    if (
        hw.isLowRamDevice
        || (hw.totalRamMb > 0 && hw.totalRamMb <= 2650)
        || hw.cpuCores <= 2
        || (hw.cpuMaxFreqKhz > 0 && hw.cpuMaxFreqKhz <= 1_450_000)
        || /Mali-4\d\d|Mali-T[678]\d\d|Mali-G31\b|PowerVR|VideoCore|SwiftShader|llvmpipe/i.test(gpu)
    ) {
        return 'lite';
    }

    // 旗舰高配电视 / 电视盒子判定：8 核及以上、>= 5.5GB RAM 或高端 GPU（NVIDIA Tegra / Mali-G7x / Adreno 6xx+）
    if (
        hw.cpuCores >= 8
        || hw.totalRamMb >= 5500
        || /NVIDIA Tegra|Adreno \(TM\) [678]\d\d|Mali-G7\d\b|Mali-G[67]\d\d|Immortalis/i.test(gpu)
    ) {
        return 'high';
    }

    // 主流 4 核 3~4GB 电视芯片（如 MT5877 / MT9952 + Mali-G52 / Mali-G57）：均衡标准档
    return 'balanced';
}

function readStoredPerfMode(): TvPerformanceMode {
    if (typeof window === 'undefined') return 'auto';
    try {
        const raw = window.localStorage.getItem(TV_PERF_MODE_KEY);
        if (raw === 'lite' || raw === 'balanced' || raw === 'high' || raw === 'auto') {
            return raw;
        }
    } catch {
        // ignore storage errors
    }
    return 'auto';
}

function writeStoredPerfMode(mode: TvPerformanceMode): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(TV_PERF_MODE_KEY, mode);
    } catch {
        // ignore storage errors
    }
}

function stepDownTier(tier: TvPerformanceTier): TvPerformanceTier {
    if (tier === 'high') return 'balanced';
    return 'lite';
}

export interface TvPerformanceState {
    mode: TvPerformanceMode;
    detectedTier: TvPerformanceTier;
    effectiveTier: TvPerformanceTier;
    autoSteppedDown: boolean;
    liveFps: number;
    hardware: TvHardwareInfo;
    setMode: (mode: TvPerformanceMode) => void;
    refreshTelemetry: () => void;
    trimTvMemoryNow: (showToast?: boolean) => void;
}

function syncTierDomAttribute(tier: TvPerformanceTier): void {
    if (typeof document === 'undefined' || !isAndroidTv()) return;
    document.documentElement.setAttribute('data-tv-perf-tier', tier);
}

let postBootstrapReady = false;

function applyVisualizerFrameCapForTier(tier: TvPerformanceTier): void {
    if (!postBootstrapReady || typeof window === 'undefined' || !isAndroidTv()) return;
    try {
        // 若用户在实验室里手动指定了帧率上限，则尊重用户设置
        const userSetRate = window.localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY);
        if (userSetRate !== null && userSetRate !== 'off' && userSetRate !== 'auto') return;
    } catch {
        // ignore
    }
    if (tier === 'lite') {
        setGlobalVisualizerFrameRate(30);
    } else {
        setGlobalVisualizerFrameRate('off');
    }
}

function applyTvTierStorePreferences(tier: TvPerformanceTier, forceWallAndMotion: boolean): void {
    if (typeof window === 'undefined' || !isAndroidTv()) return;
    syncTierDomAttribute(tier);
    applyVisualizerFrameCapForTier(tier);

    if (!forceWallAndMotion) return;

    const wallStore = useLibraryWallLookStore.getState();
    const latticeStore = useLatticeSettingsStore.getState();
    const motionStore = useMotionSettingsStore.getState();

    // 所有电视档位默认开启拼贴墙「性能优先」（关闭全屏 SVG 噪点混合与高开销卡片阴影滤镜）
    if (!latticeStore.latticePerformanceMode) {
        latticeStore.handleToggleLatticePerformanceMode(true);
    }

    if (tier === 'lite') {
        wallStore.setLook('solid');
        wallStore.setSeamClear(false);
        wallStore.setBackdropBlur(false);
        latticeStore.handleToggleLatticeVignette(false);
        motionStore.handleToggleReducedMotionSurface('lattice', true);
        motionStore.handleToggleReducedMotionSurface('collectionMorph', true);
        motionStore.handleToggleReducedMotionSurface('monetBackground', true);
    } else if (tier === 'balanced') {
        // 均衡标准档：浏览 Bravais 书库墙时默认使用实色信息条（seamClear = false），
        // 让底层播放页的双 WebGL 着色器在书库界面完全挂起/卸载，彻底解决久用发热掉帧与 eMMC Swap 堆积。
        wallStore.setLook('solid');
        wallStore.setSeamClear(false);
        wallStore.setBackdropBlur(false);
        motionStore.handleToggleReducedMotionSurface('lattice', false);
        motionStore.handleToggleReducedMotionSurface('collectionMorph', false);
        motionStore.handleToggleReducedMotionSurface('monetBackground', false);
    } else {
        // 旗舰画质档：开放完整动效与透明信息条
        wallStore.setSeamClear(true);
        motionStore.handleToggleReducedMotionSurface('lattice', false);
        motionStore.handleToggleReducedMotionSurface('collectionMorph', false);
        motionStore.handleToggleReducedMotionSurface('monetBackground', false);
    }
}

const initialHardware = isAndroidTv() ? readTvHardwareInfo() : DEFAULT_HARDWARE_INFO;
const initialDetectedTier = isAndroidTv() ? classifyTvHardwareTier(initialHardware) : 'high';
const initialMode = isAndroidTv() ? readStoredPerfMode() : 'auto';
const initialEffectiveTier: TvPerformanceTier = initialMode === 'auto' ? initialDetectedTier : initialMode;

export const useTvPerformanceStore = create<TvPerformanceState>((set, get) => ({
    mode: initialMode,
    detectedTier: initialDetectedTier,
    effectiveTier: initialEffectiveTier,
    autoSteppedDown: false,
    liveFps: 60,
    hardware: initialHardware,
    setMode: (mode) => {
        writeStoredPerfMode(mode);
        const freshHw = isAndroidTv() ? readTvHardwareInfo() : get().hardware;
        const detected = isAndroidTv() ? classifyTvHardwareTier(freshHw) : 'high';
        const effective = mode === 'auto' ? detected : mode;
        set({
            mode,
            detectedTier: detected,
            effectiveTier: effective,
            autoSteppedDown: false,
            hardware: freshHw,
        });
        applyTvTierStorePreferences(effective, true);
    },
    refreshTelemetry: () => {
        if (!isAndroidTv()) return;
        const freshHw = readTvHardwareInfo();
        const detected = classifyTvHardwareTier(freshHw);
        const { mode, autoSteppedDown, effectiveTier } = get();
        const nextEffective = mode === 'auto'
            ? (autoSteppedDown ? effectiveTier : detected)
            : mode;
        set({
            hardware: freshHw,
            detectedTier: detected,
            effectiveTier: nextEffective,
        });
    },
    trimTvMemoryNow: (showToast = false) => {
        if (typeof window === 'undefined') return;
        try {
            window.FoliaTvHardware?.trimMemory?.();
        } catch {
            // ignore
        }
        if (isAndroidTv()) {
            window.setTimeout(() => {
                get().refreshTelemetry();
            }, 250);
        }
        if (showToast) {
            setStatusMessage({
                type: 'info',
                text: '已清理电视端图片与渲染缓存',
            });
        }
    },
}));

/** 启动早期（index.tsx）安装电视硬件档位，确保首屏加载前完成遮挡与 DPR 预算初始化。 */
export function installTvPerformanceProfile(): void {
    if (typeof window === 'undefined' || !isAndroidTv()) return;
    const state = useTvPerformanceStore.getState();
    syncTierDomAttribute(state.effectiveTier);

    let firstInit = false;
    try {
        firstInit = window.localStorage.getItem(TV_PERF_INIT_KEY) !== '1';
        if (firstInit) {
            window.localStorage.setItem(TV_PERF_INIT_KEY, '1');
        }
    } catch {
        firstInit = true;
    }

    if (firstInit) {
        applyTvTierStorePreferences(state.effectiveTier, true);
    } else if (state.effectiveTier !== 'high' && state.mode === 'auto') {
        // 自动模式下确保拼贴性能模式开启
        if (!useLatticeSettingsStore.getState().latticePerformanceMode) {
            useLatticeSettingsStore.getState().handleToggleLatticePerformanceMode(true);
        }
    }
}

/**
 * 在 React 与 framer-motion 模块加载完成后启动后台性能守护：
 * 1. 对省电流畅档启用 30fps 着色器节流（不影响已捕获原生 RAF 的 framer-motion 60fps UI 焦点动画）；
 * 2. 每 10 秒低开销抽样一次真实帧率与可用内存；
 * 3. 可用内存低于阈值时自动通知原生释放 WebView 解码缓存，防止长期运行落入慢速闪存 Swap；
 * 4. 自动模式下若播放期间持续严重掉帧（连续 3 次 < 34fps），自动降一档画质保障遥控器丝滑。
 */
export function startTvPerformanceWatchdog(): () => void {
    if (typeof window === 'undefined' || !isAndroidTv()) return () => undefined;

    postBootstrapReady = true;
    applyVisualizerFrameCapForTier(useTvPerformanceStore.getState().effectiveTier);

    let lowFpsStreak = 0;
    let lastTrimAt = 0;
    let sampleRaf = 0;

    const sampleFpsBurst = (durationMs: number): Promise<number> => new Promise((resolve) => {
        let frames = 0;
        let startAt = 0;
        const tick = (now: number) => {
            if (startAt === 0) {
                startAt = now;
            } else {
                frames += 1;
            }
            if (now - startAt >= durationMs) {
                const elapsedSec = Math.max(0.1, (now - startAt) / 1000);
                resolve(Math.min(60, Math.round(frames / elapsedSec)));
                return;
            }
            sampleRaf = requestUncappedAnimationFrame(tick);
        };
        sampleRaf = requestUncappedAnimationFrame(tick);
    });

    const intervalId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void sampleFpsBurst(1200).then((fps) => {
            const store = useTvPerformanceStore.getState();
            const hw = readTvHardwareInfo();
            useTvPerformanceStore.setState({ liveFps: fps, hardware: hw });

            const now = Date.now();
            // 内存吃紧时主动回收解码图片与离屏瓦片缓存（至少间隔 90 秒，不打断播放）
            const memoryTight = hw.lowMemory || (hw.availRamMb > 0 && hw.availRamMb < 620);
            if (memoryTight && now - lastTrimAt > 90_000) {
                lastTrimAt = now;
                try {
                    window.FoliaTvHardware?.trimMemory?.();
                } catch {
                    // ignore
                }
            }

            // 自动模式下检测持续掉帧自动降档
            const isPlaying = usePlaybackStore.getState().playerState === PlayerState.PLAYING;
            if (store.mode === 'auto' && isPlaying && store.effectiveTier !== 'lite') {
                if (fps > 0 && fps < 34) {
                    lowFpsStreak += 1;
                } else {
                    lowFpsStreak = 0;
                }
                if (lowFpsStreak >= 3) {
                    lowFpsStreak = 0;
                    const nextTier = stepDownTier(store.effectiveTier);
                    useTvPerformanceStore.setState({
                        effectiveTier: nextTier,
                        autoSteppedDown: true,
                    });
                    applyTvTierStorePreferences(nextTier, true);
                    try {
                        window.FoliaTvHardware?.trimMemory?.();
                    } catch {
                        // ignore
                    }
                    const tierName = nextTier === 'lite' ? '省电流畅' : '均衡标准';
                    setStatusMessage({
                        type: 'info',
                        text: `检测到电视负载较高，已自动优化至「${tierName}」模式`,
                    });
                }
            } else {
                lowFpsStreak = 0;
            }
        });
    }, 10_000);

    return () => {
        window.clearInterval(intervalId);
        if (sampleRaf) cancelUncappedAnimationFrame(sampleRaf);
    };
}

export function getTvShaderBudget(): TvShaderBudget {
    const tier = isAndroidTv() ? useTvPerformanceStore.getState().effectiveTier : 'high';
    return SHADER_BUDGETS[tier];
}

export function useTvShaderBudget(): TvShaderBudget {
    const tier = useTvPerformanceStore(state => state.effectiveTier);
    return SHADER_BUDGETS[isAndroidTv() ? tier : 'high'];
}

export function resolveTvVisualizerDpr(rawDpr?: number): number {
    const fallback = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const value = typeof rawDpr === 'number' && Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : (fallback || 1);
    if (!isAndroidTv()) return value;
    const cap = SHADER_BUDGETS[useTvPerformanceStore.getState().effectiveTier].visualizerDpr;
    return Math.min(cap, value);
}

export function getTvTemperaMaxResolution(): number {
    return SHADER_BUDGETS[useTvPerformanceStore.getState().effectiveTier].temperaMaxResolution;
}

export function getTvNebbiaScale(): number {
    return SHADER_BUDGETS[useTvPerformanceStore.getState().effectiveTier].nebbiaScale;
}

export function getTvFumeSnapshotScale(): number {
    return SHADER_BUDGETS[useTvPerformanceStore.getState().effectiveTier].fumeSnapshotScale;
}

export function formatTvHardwareSummary(hw: TvHardwareInfo): string {
    const parts: string[] = [];
    const modelPart = [hw.brand, hw.model].filter(Boolean).join(' ').trim() || 'Android TV';
    parts.push(modelPart);
    if (hw.hardware && hw.hardware.toLowerCase() !== hw.model.toLowerCase()) {
        parts.push(hw.hardware.toUpperCase());
    }
    const freqGhz = hw.cpuMaxFreqKhz > 0 ? ` ${(hw.cpuMaxFreqKhz / 1_000_000).toFixed(2)}GHz` : '';
    parts.push(`${hw.cpuCores}核${freqGhz}`);
    if (hw.gpuRenderer) {
        parts.push(cleanGpuRendererLabel(hw.gpuRenderer));
    }
    if (hw.totalRamMb > 0) {
        parts.push(`${(hw.totalRamMb / 1024).toFixed(1)}GB 内存`);
    }
    if (hw.physicalWidth > 0 && hw.physicalHeight > 0) {
        parts.push(`${hw.physicalWidth}×${hw.physicalHeight}`);
    }
    return parts.join(' · ');
}

import { resolveTvVisualizerDpr } from '../services/tvPerformanceProfile';

/**
 * 电视端 WebView 的物理分辨率常为 1920x1080 / density 320（devicePixelRatio = 2.0，CSS 视口 960x540）。
 * 动态特效画布的 DPR 上限由 tvPerformanceProfile 按检测到的电视硬件档位（0.6x / 0.8x / 1.0x）自适应分配，
 * 节省 75%~90% 像素填充与显存，保证 60fps 丝滑运行且长时间播放不发热掉帧。
 */
export const resolveVisualizerDpr = (rawDpr?: number): number => resolveTvVisualizerDpr(rawDpr);

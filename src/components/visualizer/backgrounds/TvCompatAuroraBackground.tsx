import React, { useEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, Theme } from '../../../types';
import { useFirstFrameDrawn } from '../styleTransition/firstFrame';

// src/components/visualizer/backgrounds/TvCompatAuroraBackground.tsx
// 针对老旧电视芯片（Mali-400/450/T-系列、低端晶晨/全志/瑞芯微、无 WebGL 2 支持）的轻量级硬件加速炫彩背景：
// 1. 完全不创建 WebGL / WebGL2 上下文，彻底杜绝 #version 300 es 编译失败、黑屏闪退或 GPU 耗尽。
// 2. 利用纯 CSS GPU 合成层（transform: translate3d + scale3d + opacity）绘制流动极光光斑。
// 3. 严格同步音乐节奏（Bass 与低中频能量脉冲），保留炫酷灵动的呼吸与色彩过渡。
// 4. 第一帧立即通知 useFirstFrameDrawn()，确保首帧零延迟渲染。

interface TvCompatAuroraBackgroundProps {
    theme: Theme;
    colors: string[];
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
    paused: boolean;
}

export const TvCompatAuroraBackground: React.FC<TvCompatAuroraBackgroundProps> = ({
    theme,
    colors,
    audioBands,
    paused,
}) => {
    const firstFrame = useFirstFrameDrawn();
    const orb1Ref = useRef<HTMLDivElement | null>(null);
    const orb2Ref = useRef<HTMLDivElement | null>(null);
    const orb3Ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        firstFrame();
    }, [firstFrame]);

    // 监听音乐能量，在 GPU 硬件加速层上驱动平滑形变
    useEffect(() => {
        if (paused || !audioBands) return;
        let rafId = 0;
        let smoothedBass = 0;

        const update = () => {
            const rawBass = (audioBands.bass.get() || 0) / 255;
            smoothedBass += (rawBass - smoothedBass) * 0.15;
            const scale1 = 1 + smoothedBass * 0.22;
            const scale2 = 1 + smoothedBass * 0.16;

            if (orb1Ref.current) {
                orb1Ref.current.style.transform = `scale3d(${scale1}, ${scale1}, 1)`;
            }
            if (orb2Ref.current) {
                orb2Ref.current.style.transform = `scale3d(${scale2}, ${scale2}, 1)`;
            }

            rafId = requestAnimationFrame(update);
        };

        rafId = requestAnimationFrame(update);
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [audioBands, paused]);

    const c1 = colors[0] || theme.primaryColor || '#38bdf8';
    const c2 = colors[1] || theme.secondaryColor || '#818cf8';
    const c3 = colors[2] || theme.accentColor || '#c084fc';
    const bg = theme.backgroundColor || '#09090b';

    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
            style={{
                backgroundColor: bg,
                contain: 'strict',
            }}
        >
            {/* 顶层柔和渐变底板 */}
            <div
                className="absolute inset-0 opacity-80"
                style={{
                    background: `radial-gradient(circle at 50% 40%, ${c1}33 0%, ${bg} 75%)`,
                }}
            />

            {/* 光斑 1：主色呼吸光斑 */}
            <div
                ref={orb1Ref}
                className="absolute rounded-full opacity-60"
                style={{
                    top: '-15%',
                    left: '-10%',
                    width: '75vw',
                    height: '75vw',
                    maxWidth: '850px',
                    maxHeight: '850px',
                    background: `radial-gradient(circle, ${c1} 0%, transparent 68%)`,
                    transform: 'translate3d(0, 0, 0)',
                    willChange: 'transform',
                }}
            />

            {/* 光斑 2：次色光斑 */}
            <div
                ref={orb2Ref}
                className="absolute rounded-full opacity-55"
                style={{
                    bottom: '-20%',
                    right: '-10%',
                    width: '80vw',
                    height: '80vw',
                    maxWidth: '900px',
                    maxHeight: '900px',
                    background: `radial-gradient(circle, ${c2} 0%, transparent 70%)`,
                    transform: 'translate3d(0, 0, 0)',
                    willChange: 'transform',
                }}
            />

            {/* 光斑 3：强调色侧峰 */}
            <div
                ref={orb3Ref}
                className="absolute rounded-full opacity-45"
                style={{
                    top: '25%',
                    right: '15%',
                    width: '50vw',
                    height: '50vw',
                    maxWidth: '600px',
                    maxHeight: '600px',
                    background: `radial-gradient(circle, ${c3} 0%, transparent 65%)`,
                    transform: 'translate3d(0, 0, 0)',
                }}
            />

            {/* 暗角收敛层：保持四周纯净，确保歌词清晰易读 */}
            <div
                className="absolute inset-0"
                style={{
                    background: `radial-gradient(ellipse at center, transparent 35%, ${bg}cc 85%, ${bg} 100%)`,
                }}
            />
        </div>
    );
};

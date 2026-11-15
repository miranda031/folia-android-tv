import type { Variants } from 'framer-motion';
import type { Theme } from '../../types';
import { shouldAllowTvCssFilters } from '../../services/tvPerformanceProfile';

// src/components/visualizer/glowWordVariants.ts
// classic / partita 的 GlowWord 用的 framer-motion variants：外层容器（位置 / 缩放 / 旋转）与正文层（颜色 / 模糊）。

// Container motion is the "body" of each word.
// waiting/active/passed all reuse the same layout config but interpret it differently.
export const buildGlowWordLayoutVariants = (
    animationIntensity: Theme['animationIntensity'],
    enableWordRotation = true,
): Variants => {
    const allowFilters = shouldAllowTvCssFilters();
    return {
        waiting: ({ config }: any) => (!allowFilters ? {
            opacity: 0.35,
            scale: 0.95,
            x: config.x,
            y: config.y,
            rotate: 0,
            transition: { duration: 0.25 },
        } : {
            opacity: 0,
            scale: 0.5,
            x: config.x + (Math.sin(config.y) * 100),
            y: config.y + (Math.cos(config.x) * 50),
            rotate: enableWordRotation ? config.rotate + 20 : 0,
            transition: { duration: 0.4 },
        }),
        active: ({ config }: any) => ({
            opacity: 1,
            scale: isNaN(config.scale) ? 1.4 : config.scale * 1.35,
            x: config.x,
            y: config.y,
            rotate: !allowFilters ? 0 : config.rotate,
            transition: !allowFilters ? {
                duration: 0.18,
                ease: "easeOut" as const,
            } : {
                type: "spring" as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 },
            },
        }),
        passed: ({ config, baseColor }: any) => ({
            opacity: animationIntensity === 'chaotic' ? 0.9 : 0.82,
            scale: config.scale || 1,
            x: config.x,
            y: config.y,
            rotate: !allowFilters ? 0 : config.rotate + config.passedRotate,
            transition: !allowFilters ? {
                duration: 0.25,
                ease: "linear" as const,
            } : {
                duration: 0.5,
                rotate: {
                    duration: 5,
                    ease: "linear",
                },
            },
        }),
    };
};

// Body layer is where color transition and blur cleanup happen.
// Glow is separated so we can overdrive highlight without making the actual glyph unreadable.
export const glowWordBodyVariants: Variants = {
    waiting: ({ baseColor }: any) => ({
        color: baseColor,
        filter: shouldAllowTvCssFilters() ? "blur(10px)" : "none",
        transition: { duration: 0.4 }
    }),
    active: ({ activeColor, duration, wordRevealMode }: any) => ({
        color: activeColor,
        filter: "none",
        transition: {
            color: { duration: duration || 0.2, ease: "linear" },
            filter: { type: "tween", duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2 }
        },
        transitionEnd: {
            filter: "none"
        }
    }),
    passed: ({ baseColor, wordRevealMode }: any) => ({
        color: baseColor,
        filter: "none",
        transition: {
            color: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8, ease: "easeInOut" },
            filter: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5 }
        },
        transitionEnd: {
            filter: "none"
        }
    })
};

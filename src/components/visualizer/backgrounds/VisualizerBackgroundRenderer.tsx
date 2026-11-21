import React from 'react';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE, getVisualizerBackgroundRegistryEntry } from './registry';
import type { VisualizerBackgroundRenderProps } from './definition';
import { isAndroidTv } from '../../../platform/runtime';

// src/components/visualizer/backgrounds/VisualizerBackgroundRenderer.tsx
// Selects the active shell background through the discoverable background registry.

const VisualizerBackgroundRenderer: React.FC<VisualizerBackgroundRenderProps> = (props) => {
    if (props.config?.transparent) {
        return null;
    }

    const rawMode = props.config?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
    // 电视端统一采用零 WebGL 上下文的硬件加速流光极光背景（LatentBackground -> TvCompatAuroraBackground），彻底根治 WebGL 显存耗尽引发的闪退
    const mode = isAndroidTv() && rawMode !== 'url' ? 'latent' : rawMode;
    return getVisualizerBackgroundRegistryEntry(mode).render(props);
};

export default VisualizerBackgroundRenderer;

import React, { useEffect } from 'react';
import { Check, Cpu, Gauge, Sparkles, Zap, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { getVisualizerModeLabel } from '../../../visualizer/registry';
import { isAndroidTv } from '../../../../platform/runtime';
import { useExitModalStore } from '../../../../stores/useExitModalStore';
import { BUILTIN_THEME_PRESETS, resolveActiveThemePresetId } from '../../../../services/themePresets';
import {
    formatTvHardwareSummary,
    useTvPerformanceStore,
    type TvPerformanceMode,
    type TvPerformanceTier,
} from '../../../../services/tvPerformanceProfile';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { openSettings } from '../../../../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';
import { Button, Group, Reveal, Row, Segmented, Toggle, Value, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { settingsAnchorSubview } from '../navigation/settingsAnchorModel';
import AiProviderSettings, { AI_SETTINGS_OPTIONS } from './ai/AiProviderSettings';
import { canUseDirectAiText } from '../../../../utils/platform';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/AppearancePage.tsx
// The 外观 page: which lyric animation the player uses, light or dark, the colour theme, how a
// song's own theme is made and applied, and (desktop app) the AI provider that makes those themes.
// The lyric animation workbench and the theme colour editor are the existing overlays; their rows
// here only open them.

const LYRICS: SettingsGroupDef = { id: 'lyricsRenderer', titleKey: 'options.lyricsRenderer' };
const THEME: SettingsGroupDef = { id: 'themePresets', titleKey: 'options.settingsHeadingTheme' };
const SONG_THEME: SettingsGroupDef = { id: 'songTheme', titleKey: 'options.settingsHeadingSongTheme' };
const TV_PERF_ZH: SettingsGroupDef = { id: 'tvPerformance', titleKey: '电视配置与动态效果优化' };
const TV_PERF_EN: SettingsGroupDef = { id: 'tvPerformance', titleKey: 'TV Hardware & Adaptive Graphics' };

const TV_TIER_LABELS_ZH: Record<TvPerformanceTier, string> = {
    compat: '老电视兼容',
    lite: '省电流畅',
    balanced: '均衡标准',
    high: '旗舰画质',
};

const TV_TIER_LABELS_EN: Record<TvPerformanceTier, string> = {
    compat: 'Legacy TV Compat',
    lite: 'Lite Smooth',
    balanced: 'Balanced',
    high: 'Flagship HQ',
};

const O = {
    lyricsAnimation: option(LYRICS, 'lyricsAnimationAdjust', 'options.lyricsAnimationAdjust'),
    daylight: option(THEME, 'daylightMode', 'options.daylightMode'),
    preset: option(THEME, 'themePreset', 'options.themePresets'),
    themePark: option(THEME, 'openThemePark', 'options.openThemePark'),
    autoSwitch: option(SONG_THEME, 'autoSwitchSongTheme', 'options.autoSwitchSongTheme'),
    autoGenerate: option(SONG_THEME, 'autoGenerateSongTheme', 'options.autoGenerateSongTheme'),
    source: option(SONG_THEME, 'themeGenerationSource', 'options.themeGenerationSource'),
    preferCustom: option(SONG_THEME, 'preferCustomTheme', 'options.preferCustomTheme'),

};

export const OPTIONS: SettingsOptionDef[] = [...Object.values(O), ...AI_SETTINGS_OPTIONS];

type DaylightChoice = 'light' | 'dark' | 'system';

const AppearancePage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { isElectron, themeControls, viewProps, onOpenVisPlayground, onOpenThemePark } = useSettingsPage();
    const { isDaylight, followSystemTheme, setDaylightPreference, setFollowSystemTheme } = useThemeSettingsStore(useShallow(state => ({
        isDaylight: state.isDaylight,
        followSystemTheme: state.followSystemTheme,
        setDaylightPreference: state.setDaylightPreference,
        setFollowSystemTheme: state.setFollowSystemTheme,
    })));
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const randomEnabled = useVisualizerSettingsStore(state => state.randomVisualizerModePerSong);
    const nativeBlurEnabled = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const activePresetId = resolveActiveThemePresetId(themeControls.bgMode, viewProps.appearance.customTheme);
    const isZh = i18n.language?.toLowerCase().startsWith('zh');
    const isTv = isAndroidTv();
    const tvPerf = useTvPerformanceStore(useShallow(state => ({
        mode: state.mode,
        detectedTier: state.detectedTier,
        effectiveTier: state.effectiveTier,
        autoSteppedDown: state.autoSteppedDown,
        liveFps: state.liveFps,
        hardware: state.hardware,
        setMode: state.setMode,
        refreshTelemetry: state.refreshTelemetry,
        trimTvMemoryNow: state.trimTvMemoryNow,
    })));

    useEffect(() => {
        if (isTv) {
            tvPerf.refreshTelemetry();
        }
    }, [isTv, tvPerf.refreshTelemetry]);

    const tierLabelOf = (tier: TvPerformanceTier) => (isZh ? TV_TIER_LABELS_ZH[tier] : TV_TIER_LABELS_EN[tier]);
    const tvModeChoices: Array<{
        value: TvPerformanceMode;
        title: string;
        desc: string;
        Icon: React.ComponentType<{ size?: number; className?: string }>;
    }> = [
        {
            value: 'auto',
            title: isZh ? '自动识别' : 'Auto Detect',
            desc: isZh
                ? `当前生效：${tierLabelOf(tvPerf.effectiveTier)}${tvPerf.autoSteppedDown ? '（已智能降载）' : ''}`
                : `Active: ${tierLabelOf(tvPerf.effectiveTier)}`,
            Icon: Cpu,
        },
        {
            value: 'compat',
            title: tierLabelOf('compat'),
            desc: isZh ? 'GPU零崩溃 · 极光流动 · 老电视/盒子首选' : 'Zero WebGL · Aurora glow · Old TV/Box',
            Icon: Sparkles,
        },
        {
            value: 'lite',
            title: tierLabelOf('lite'),
            desc: isZh ? '0.6x 渲染 · 30fps 背景 · 久用不卡' : '0.6x DPR · 30fps shader',
            Icon: Zap,
        },
        {
            value: 'balanced',
            title: tierLabelOf('balanced'),
            desc: isZh ? '0.8x 渲染 · 书库自动挂起背景特效' : '0.8x DPR · Occlude behind wall',
            Icon: Gauge,
        },
        {
            value: 'high',
            title: tierLabelOf('high'),
            desc: isZh ? '1.0x 原生分辨率 · 完整双层混色' : '1.0x DPR · Full dual shaders',
            Icon: Sparkles,
        },
    ];

    return (
        <>
            {isTv && (
                <Group def={isZh ? TV_PERF_ZH : TV_PERF_EN}>
                    <Row
                        label={isZh ? '当前电视硬件配置' : 'Detected TV Configuration'}
                        hint={`${formatTvHardwareSummary(tvPerf.hardware)}${
                            tvPerf.hardware.availRamMb > 0
                                ? (isZh ? ` · 可用内存 ${tvPerf.hardware.availRamMb} MB` : ` · Free RAM ${tvPerf.hardware.availRamMb} MB`)
                                : ''
                        } · ${isZh ? `推荐「${tierLabelOf(tvPerf.detectedTier)}」` : `Recommended: ${tierLabelOf(tvPerf.detectedTier)}`}`}
                    >
                        <Value>{`${tvPerf.liveFps} FPS`}</Value>
                        <Button onClick={() => tvPerf.trimTvMemoryNow(true)}>
                            {isZh ? '清理缓存' : 'Free Cache'}
                        </Button>
                    </Row>
                    <Row
                        label={isZh ? '分辨率与动态效果档位' : 'Resolution & Dynamic Effects'}
                        hint={isZh
                            ? '根据电视芯片与内存动态分配着色器分辨率，并在书库墙模式下挂起后台渲染防止久用发热掉帧'
                            : 'Adapts WebGL shader resolution and background occlusion to prevent thermal throttling'}
                        below={(
                            <div className="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                                {tvModeChoices.map(({ value, title, desc, Icon }) => {
                                    const isSelected = tvPerf.mode === value;
                                    return (
                                        <button
                                            key={value}
                                            type="button"
                                            data-tv-nav="tv-perf-card"
                                            data-tv-perf-mode={value}
                                            aria-pressed={isSelected}
                                            onClick={() => tvPerf.setMode(value)}
                                            className={`st-focus-inside st-t-fast flex flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors ${
                                                isSelected
                                                    ? 'bg-[var(--st-raise)] shadow-[inset_0_0_0_1.5px_var(--st-accent)]'
                                                    : 'bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]'
                                            }`}
                                        >
                                            <div className="flex w-full items-center justify-between gap-1.5">
                                                <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-[color:var(--st-t1)]">
                                                    <Icon size={14} className="shrink-0 text-[color:var(--st-accent)]" />
                                                    <span className="truncate">{title}</span>
                                                </span>
                                                {isSelected && (
                                                    <Check size={14} className="shrink-0 text-[color:var(--st-accent)]" strokeWidth={2.6} />
                                                )}
                                            </div>
                                            <span className="line-clamp-2 text-[11px] leading-4 text-[color:var(--st-t2)]">
                                                {desc}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    />
                    <Row
                        title="退出应用"
                        desc="停止后台播放服务并安全关闭退出 Folia TV（亦可在主界面按遥控器返回键呼出）"
                        onClick={() => useExitModalStore.getState().openExitModal()}
                    >
                        <button
                            type="button"
                            data-tv-nav="tv-exit-button"
                            onClick={() => useExitModalStore.getState().openExitModal()}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium text-xs border border-red-500/30 transition-all"
                        >
                            <Power size={13} />
                            <span>退出应用</span>
                        </button>
                    </Row>
                </Group>
            )}

            <Group def={LYRICS} bare>
                {nativeBlurEnabled && <Row notice={t('options.nativeBlurBackgroundNotice')} />}
                <Row option={O.lyricsAnimation} hint={t('options.lyricsRendererDesc')} onClick={onOpenVisPlayground}>
                    <Value>{randomEnabled ? t('ui.visualizerRandom') : getVisualizerModeLabel(visualizerMode, t)}</Value>
                </Row>
            </Group>

            <Group def={THEME}>
                <Row option={O.daylight} note={t('options.followSystemThemeDesc')}>
                    <Segmented<DaylightChoice>
                        value={followSystemTheme ? 'system' : isDaylight ? 'light' : 'dark'}
                        options={[
                            { value: 'light', label: t('options.daylightModeLight') },
                            { value: 'dark', label: t('options.daylightModeDark') },
                            { value: 'system', label: t('options.daylightModeSystem') },
                        ]}
                        onChange={(choice) => {
                            if (choice === 'system') {
                                setFollowSystemTheme(true);
                            } else {
                                // A light or dark picked by hand also stops following the system.
                                setDaylightPreference(choice === 'light');
                            }
                        }}
                    />
                </Row>
                <Row
                    option={O.preset}
                    below={(
                        <div className="mt-2.5 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
                            {BUILTIN_THEME_PRESETS.map((preset) => {
                                const isActive = activePresetId === preset.id;
                                const bgPreview = isDaylight ? preset.previewLightBg : preset.previewDarkBg;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        data-tv-nav="theme-preset-card"
                                        data-theme-preset={preset.id}
                                        aria-pressed={isActive}
                                        onClick={() => {
                                            if (preset.id === 'default' || !preset.dualTheme) {
                                                themeControls.onApplyDefaultTheme();
                                            } else {
                                                viewProps.appearance.onSaveCustomTheme(preset.dualTheme);
                                            }
                                        }}
                                        className={`st-t-fast flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                                            isActive
                                                ? 'bg-[var(--st-raise)] shadow-[inset_0_0_0_1.5px_var(--st-accent)]'
                                                : 'bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]'
                                        }`}
                                    >
                                        <span
                                            aria-hidden
                                            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
                                            style={{ backgroundColor: bgPreview }}
                                        >
                                            <span
                                                className="h-3.5 w-3.5 rounded-full"
                                                style={{ backgroundColor: preset.previewAccent }}
                                            />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--st-t1)]">
                                            {isZh ? preset.labelZh : preset.labelEn}
                                        </span>
                                        {isActive && (
                                            <Check size={14} className="shrink-0 text-[color:var(--st-accent)]" strokeWidth={2.6} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                >
                    <Segmented
                        value={themeControls.bgMode}
                        options={[
                            { value: 'default', label: t('options.themePresetsDefault') },
                            { value: 'custom', label: t('options.customTheme'), disabled: !themeControls.hasCustomTheme },
                        ]}
                        onChange={mode => (mode === 'custom' ? themeControls.onApplyCustomTheme() : themeControls.onApplyDefaultTheme())}
                    />
                </Row>
                <Row option={O.themePark} onClick={onOpenThemePark} />
            </Group>

            <Group def={SONG_THEME}>
                <Row option={O.autoSwitch} note={t('options.autoSwitchSongThemeDesc')}>
                    <Toggle checked={themeControls.songThemeAutoSwitchEnabled} onChange={themeControls.onToggleSongThemeAutoSwitch} />
                </Row>
                <Reveal when={themeControls.songThemeAutoSwitchEnabled}>
                    <Row
                        sub
                        option={O.autoGenerate}
                        note={t(themeControls.themeGenerationSource === 'cover' ? 'options.autoGenerateSongThemeCoverDesc' : 'options.autoGenerateSongThemeDesc')}
                    >
                        <Toggle checked={themeControls.songThemeAutoGenerateEnabled} onChange={themeControls.onToggleSongThemeAutoGenerate} />
                    </Row>
                </Reveal>
                <Row
                    option={O.source}
                    note={t(themeControls.themeGenerationSource === 'cover' ? 'options.themeGenerationSourceCoverDesc' : 'options.themeGenerationSourceAiDesc')}
                >
                    <Segmented
                        value={themeControls.themeGenerationSource}
                        options={[
                            { value: 'ai', label: t('options.themeGenerationSourceAi'), disabled: themeControls.aiApiKeyStatus !== 'configured' },
                            { value: 'cover', label: t('options.themeGenerationSourceCover') },
                        ]}
                        onChange={themeControls.onChangeThemeGenerationSource}
                    />
                </Row>
                <Reveal when={themeControls.aiApiKeyStatus === 'missing'}>
                    <Row sub notice={t('options.themeGenerationSourceAiUnavailable')}>
                        <Button onClick={() => openSettings('options', settingsAnchorSubview('electronSettings'), null, 'electronSettings')}>
                            {t('options.configureAiApiKey')}
                        </Button>
                    </Row>
                </Reveal>
                <Row option={O.preferCustom} hint={t('options.preferCustomThemeDesc')}>
                    <Toggle
                        checked={themeControls.isCustomThemePreferred}
                        onChange={themeControls.onToggleCustomThemePreferred}
                        disabled={!themeControls.hasCustomTheme}
                    />
                </Row>
            </Group>

            {(isElectron || canUseDirectAiText()) && <AiProviderSettings />}
        </>
    );
};

export default AppearancePage;

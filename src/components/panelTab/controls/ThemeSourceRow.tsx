import React from 'react';
import { Check, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, ThemeMode } from '../../../types';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';
import { isAndroidTv } from '../../../platform/runtime';
import { BUILTIN_THEME_PRESETS, resolveActiveThemePresetId } from '../../../services/themePresets';
import { useThemeQuickEditorStore } from '../../../stores/useThemeQuickEditorStore';
import { PanelIconButton } from '../shell/PanelIconButton';
import { Segments } from '../shell/Segments';

// src/components/panelTab/controls/ThemeSourceRow.tsx
// 主题来源选择（默认 / AI / 自定义），旁边是快速编辑当前主题的按钮，下方提供一键精选主题色板。

interface ThemeSourceRowProps {
    themeSourceModel: ThemeSourceModel;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}

const SourceDot: React.FC<{ color?: string }> = ({ color }) => (
    <span
        className={`h-2 w-2 shrink-0 rounded-full ${color ? 'shadow-[inset_0_0_0_1px_var(--st-line2)]' : 'border border-dashed border-[var(--st-t3)]'}`}
        style={{ backgroundColor: color }}
    />
);

const ThemeSourceRow: React.FC<ThemeSourceRowProps> = ({
    themeSourceModel,
    onBgModeChange,
    hasCustomTheme,
    defaultTheme,
    daylightTheme,
    isDaylight,
}) => {
    const { t, i18n } = useTranslation();
    const { openThemeQuickEditor, customTheme, saveCustomThemeHandler, canOpenEditor } = useThemeQuickEditorStore(
        useShallow(state => ({
            openThemeQuickEditor: state.openEditor,
            customTheme: state.customTheme,
            saveCustomThemeHandler: state.saveCustomThemeHandler,
            canOpenEditor: state.canOpenEditor,
        })),
    );
    const aiThemeSource = themeSourceModel.options.ai;
    const customThemeSource = themeSourceModel.options.custom;
    const editableSource = themeSourceModel.editableSource;
    const tvMode = isAndroidTv();
    const canQuickEdit = Boolean(editableSource) || (tvMode && canOpenEditor);
    const activePresetId = resolveActiveThemePresetId(themeSourceModel.activeSource, customTheme);
    const isZh = i18n.language?.toLowerCase().startsWith('zh');

    return (
        <div className="flex flex-col gap-2">
            <div className="flex min-h-12 items-center gap-2">
                <Segments<ThemeMode>
                    fill
                    value={themeSourceModel.activeSource}
                    onChange={onBgModeChange}
                    options={[
                        {
                            value: 'default',
                            label: t('ui.default'),
                            icon: <SourceDot color={isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor} />,
                        },
                        {
                            value: 'ai',
                            label: t('ui.aiTheme'),
                            icon: <SourceDot color={aiThemeSource.available ? aiThemeSource.theme?.backgroundColor ?? 'rgba(114,119,134,0.4)' : undefined} />,
                            disabled: !aiThemeSource.available,
                        },
                        {
                            value: 'custom',
                            label: t('options.customTheme'),
                            icon: <SourceDot color={hasCustomTheme ? customThemeSource.theme?.accentColor ?? 'rgba(114,119,134,0.4)' : undefined} />,
                            disabled: !hasCustomTheme,
                            tip: hasCustomTheme ? undefined : t('options.customThemeUnavailable'),
                        },
                    ]}
                />
                <PanelIconButton
                    size="s"
                    filled
                    label={editableSource === 'custom'
                        ? t('options.customThemeQuickEditTitle')
                        : editableSource === 'ai' || tvMode
                            ? t('options.aiThemeQuickEditTitle')
                            : t('options.themeQuickEditUnavailable')}
                    disabled={!canQuickEdit}
                    onClick={() => {
                        if (editableSource) {
                            openThemeQuickEditor(editableSource);
                        } else if (tvMode) {
                            openThemeQuickEditor();
                        }
                    }}
                >
                    <Palette size={15} />
                </PanelIconButton>
            </div>

            {saveCustomThemeHandler && (
                <div className="grid grid-cols-4 gap-1.5 py-0.5">
                    {BUILTIN_THEME_PRESETS.map((preset) => {
                        const isActive = activePresetId === preset.id;
                        const bgColor = isDaylight ? preset.previewLightBg : preset.previewDarkBg;
                        return (
                            <button
                                key={preset.id}
                                type="button"
                                data-tv-nav="panel-theme-preset"
                                data-panel-theme-preset={preset.id}
                                aria-pressed={isActive}
                                title={isZh ? preset.labelZh : preset.labelEn}
                                onClick={() => {
                                    if (preset.id === 'default' || !preset.dualTheme) {
                                        onBgModeChange('default');
                                    } else {
                                        saveCustomThemeHandler(preset.dualTheme);
                                    }
                                }}
                                className={`st-t-fast flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                                    isActive
                                        ? 'bg-[var(--st-raise)] shadow-[inset_0_0_0_1.5px_var(--st-accent)]'
                                        : 'bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]'
                                }`}
                            >
                                <span
                                    aria-hidden
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
                                    style={{ backgroundColor: bgColor }}
                                >
                                    {isActive ? (
                                        <Check size={10} style={{ color: preset.previewAccent }} strokeWidth={3} />
                                    ) : (
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: preset.previewAccent }} />
                                    )}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[color:var(--st-t1)]">
                                    {isZh ? preset.labelZh.slice(0, 4) : preset.labelEn.split(' ')[0]}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ThemeSourceRow;

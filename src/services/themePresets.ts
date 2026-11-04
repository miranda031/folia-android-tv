import type { DualTheme, ThemeMode } from '../types';

export type BuiltinThemePresetId =
    | 'default'
    | 'amber'
    | 'emerald'
    | 'ocean'
    | 'crimson'
    | 'violet'
    | 'sakura'
    | 'cyber';

export interface BuiltinThemePreset {
    id: BuiltinThemePresetId;
    labelZh: string;
    labelEn: string;
    previewDarkBg: string;
    previewLightBg: string;
    previewAccent: string;
    previewPrimaryDark: string;
    dualTheme?: DualTheme;
}

const makeDualPreset = (
    nameZh: string,
    nameEn: string,
    dark: { bg: string; primary: string; accent: string; secondary: string },
    light: { bg: string; primary: string; accent: string; secondary: string },
): DualTheme => ({
    dark: {
        name: `${nameZh} · 夜`,
        backgroundColor: dark.bg,
        primaryColor: dark.primary,
        accentColor: dark.accent,
        secondaryColor: dark.secondary,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Preset',
        description: nameEn,
    },
    light: {
        name: `${nameZh} · 昼`,
        backgroundColor: light.bg,
        primaryColor: light.primary,
        accentColor: light.accent,
        secondaryColor: light.secondary,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Preset',
        description: nameEn,
    },
});

export const BUILTIN_THEME_PRESETS: readonly BuiltinThemePreset[] = [
    {
        id: 'default',
        labelZh: '墨夜经典',
        labelEn: 'Classic Ink',
        previewDarkBg: '#0c0d12',
        previewLightBg: '#f6f5f2',
        previewAccent: '#e2e8f0',
        previewPrimaryDark: '#ffffff',
    },
    {
        id: 'amber',
        labelZh: '琥珀流金',
        labelEn: 'Amber Gold',
        previewDarkBg: '#161008',
        previewLightBg: '#fdf8ef',
        previewAccent: '#f59e0b',
        previewPrimaryDark: '#fff7e6',
        dualTheme: makeDualPreset(
            '琥珀流金',
            'Amber Gold',
            { bg: '#161008', primary: '#fff7e6', accent: '#f59e0b', secondary: '#b89b72' },
            { bg: '#fdf8ef', primary: '#2c1e0f', accent: '#d97706', secondary: '#7c5e3c' },
        ),
    },
    {
        id: 'emerald',
        labelZh: '极光翡翠',
        labelEn: 'Aurora Emerald',
        previewDarkBg: '#081712',
        previewLightBg: '#f0fbf6',
        previewAccent: '#10b981',
        previewPrimaryDark: '#e8fff5',
        dualTheme: makeDualPreset(
            '极光翡翠',
            'Aurora Emerald',
            { bg: '#081712', primary: '#e8fff5', accent: '#10b981', secondary: '#6fa892' },
            { bg: '#f0fbf6', primary: '#0f2920', accent: '#059669', secondary: '#4b7a68' },
        ),
    },
    {
        id: 'ocean',
        labelZh: '深海星云',
        labelEn: 'Deep Ocean',
        previewDarkBg: '#081222',
        previewLightBg: '#f0f7ff',
        previewAccent: '#38bdf8',
        previewPrimaryDark: '#eaf4ff',
        dualTheme: makeDualPreset(
            '深海星云',
            'Deep Ocean',
            { bg: '#081222', primary: '#eaf4ff', accent: '#38bdf8', secondary: '#749bc2' },
            { bg: '#f0f7ff', primary: '#0f233d', accent: '#0284c7', secondary: '#4a6b8c' },
        ),
    },
    {
        id: 'crimson',
        labelZh: '绯红丝绒',
        labelEn: 'Crimson Velvet',
        previewDarkBg: '#1a090e',
        previewLightBg: '#fff1f3',
        previewAccent: '#f43f5e',
        previewPrimaryDark: '#ffebef',
        dualTheme: makeDualPreset(
            '绯红丝绒',
            'Crimson Velvet',
            { bg: '#1a090e', primary: '#ffebef', accent: '#f43f5e', secondary: '#b87a87' },
            { bg: '#fff1f3', primary: '#361018', accent: '#e11d48', secondary: '#874856' },
        ),
    },
    {
        id: 'violet',
        labelZh: '紫罗兰夜曲',
        labelEn: 'Violet Nocturne',
        previewDarkBg: '#130c22',
        previewLightBg: '#f7f2ff',
        previewAccent: '#a855f7',
        previewPrimaryDark: '#f3ecff',
        dualTheme: makeDualPreset(
            '紫罗兰夜曲',
            'Violet Nocturne',
            { bg: '#130c22', primary: '#f3ecff', accent: '#a855f7', secondary: '#937bb8' },
            { bg: '#f7f2ff', primary: '#24143d', accent: '#9333ea', secondary: '#68508a' },
        ),
    },
    {
        id: 'sakura',
        labelZh: '樱花微醺',
        labelEn: 'Sakura Mist',
        previewDarkBg: '#1c0f18',
        previewLightBg: '#fff5fa',
        previewAccent: '#ec4899',
        previewPrimaryDark: '#fff0f7',
        dualTheme: makeDualPreset(
            '樱花微醺',
            'Sakura Mist',
            { bg: '#1c0f18', primary: '#fff0f7', accent: '#ec4899', secondary: '#b5829b' },
            { bg: '#fff5fa', primary: '#381628', accent: '#db2777', secondary: '#87526d' },
        ),
    },
    {
        id: 'cyber',
        labelZh: '赛博霓虹',
        labelEn: 'Cyber Neon',
        previewDarkBg: '#090e1c',
        previewLightBg: '#effbff',
        previewAccent: '#06b6d4',
        previewPrimaryDark: '#e6ffff',
        dualTheme: makeDualPreset(
            '赛博霓虹',
            'Cyber Neon',
            { bg: '#090e1c', primary: '#e6ffff', accent: '#06b6d4', secondary: '#f43f5e' },
            { bg: '#effbff', primary: '#0e1a2b', accent: '#0891b2', secondary: '#e11d48' },
        ),
    },
];

const norm = (hex?: string | null) => (hex ?? '').trim().toLowerCase();

export const resolveActiveThemePresetId = (
    bgMode: ThemeMode,
    customTheme?: DualTheme | null,
): BuiltinThemePresetId | null => {
    if (bgMode === 'default') return 'default';
    if (bgMode !== 'custom' || !customTheme) return null;
    const darkAccent = norm(customTheme.dark.accentColor);
    const darkBg = norm(customTheme.dark.backgroundColor);
    for (const preset of BUILTIN_THEME_PRESETS) {
        if (!preset.dualTheme) continue;
        if (
            norm(preset.dualTheme.dark.accentColor) === darkAccent
            && norm(preset.dualTheme.dark.backgroundColor) === darkBg
        ) {
            return preset.id;
        }
    }
    return null;
};

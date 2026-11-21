import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAndroidLayoutSettingsStore } from '../../../../stores/useAndroidLayoutSettingsStore';
import { IS_ANDROID_WEBVIEW } from '../../../../utils/platform';
import { isAndroidTv } from '../../../../platform/runtime';
import { useTvUpdateStore } from '../../../../services/tvAutoUpdateService';
import type { AppLanguagePreference } from '../../../../i18n/config';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { selectPonderSettingsSnapshot, usePonderStore } from '../../../../stores/usePonderStore';
import { useSettingsModalStore } from '../../../../stores/useSettingsModalStore';
import { Button, Group, Reveal, Row, Segmented, Select, Toggle, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { FoundUpdateRow } from './FoundUpdateRow';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/GeneralPage.tsx
// The 通用 page: the interface language, what the app does when it starts and how its window
// buttons show, the desktop app's update check (with the new version, once one is found), and the
// hints of the Ponder tutorials.

const LANGUAGE: SettingsGroupDef = { id: 'languageSettings', titleKey: 'options.languageSettings' };
const LAUNCH: SettingsGroupDef = { id: 'labWindowAndTools', titleKey: 'options.settingsHeadingLaunch' };
const UPDATE: SettingsGroupDef = { id: 'updateCheck', titleKey: 'options.updateCheck', electronOnly: true };
const PONDER: SettingsGroupDef = { id: 'ponderHints', titleKey: 'options.ponderHints' };
// Android 外壳：只有 Capacitor WebView 里这些开关才有意义（桌面上整组不渲染）。
const ANDROID_SHELL: SettingsGroupDef = { id: 'androidShell', titleKey: 'options.settingsHeadingAndroid' };

const O = {
    language: option(LANGUAGE, 'appLanguage', 'options.appLanguage'),
    autoPlay: option(LAUNCH, 'autoPlayOnLaunch', 'options.autoPlayOnLaunch'),
    openPlayer: option(LAUNCH, 'openPlayerOnLaunch', 'options.openPlayerOnLaunch', { electronOnly: true }),
    titlebarButtons: option(LAUNCH, 'alwaysShowMainWindowTitlebar', 'options.alwaysShowMainWindowTitlebar'),
    updateCheck: option(UPDATE, 'enableUpdateCheck', 'options.enableUpdateCheck'),
    autoUpdate: option(UPDATE, 'enableAutoUpdate', 'options.enableAutoUpdate'),
    updateChannel: option(UPDATE, 'updateChannel', 'options.updateChannel'),
    ponderHints: option(PONDER, 'ponderHintVisibility', 'options.ponderHints'),
    ponderTouchButton: option(PONDER, 'ponderTouchButton', 'options.ponderTouchButton'),
    androidAdaptiveDisplay: option(ANDROID_SHELL, 'adaptiveDisplay', 'options.adaptiveDisplay'),
    androidKeepScreenOn: option(ANDROID_SHELL, 'keepScreenOn', 'options.keepScreenOn'),
    androidPhoneFit: option(ANDROID_SHELL, 'phoneFit', 'options.phoneFit'),
    androidOrientation: option(ANDROID_SHELL, 'orientationFit', 'options.orientationFit'),
    androidCommandPaletteAutoHide: option(ANDROID_SHELL, 'autoHideCommandPaletteButton', 'options.autoHideCommandPaletteButton'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const GeneralPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const { openPlayerOnLaunch, onToggleOpenPlayerOnLaunch } = viewProps.desktop.preferences;
    const update = viewProps.desktop.model;
    const { electronSettings, updateStatus } = update;
    // Android 移植：这几个设置只有原生壳里有效，桌面上组件自己返回 null。
    // Android 外壳的设置：store 里的三个开关 + 原生「自适应分辨率」（插件状态）。

    const keepScreenOnEnabled = useAndroidLayoutSettingsStore(state => state.keepScreenOnEnabled);
    const setKeepScreenOnEnabled = useAndroidLayoutSettingsStore(state => state.setKeepScreenOnEnabled);
    const phoneFitEnabled = useAndroidLayoutSettingsStore(state => state.phoneFitEnabled);
    const setPhoneFitEnabled = useAndroidLayoutSettingsStore(state => state.setPhoneFitEnabled);
    const phoneFitOrientation = useAndroidLayoutSettingsStore(state => state.phoneFitOrientation);
    const setPhoneFitOrientation = useAndroidLayoutSettingsStore(state => state.setPhoneFitOrientation);
    const autoHideCommandPaletteButton = usePlayerChromeSettingsStore(state => state.autoHideCommandPaletteButton);
    const handleToggleAutoHideCommandPaletteButton = usePlayerChromeSettingsStore(state => state.handleToggleAutoHideCommandPaletteButton);
    const [adaptiveDisplayEnabled, setAdaptiveDisplayEnabled] = React.useState(false);
    React.useEffect(() => {
        if (!IS_ANDROID_WEBVIEW) return;
        const plugin = (window as unknown as { Capacitor?: { Plugins?: { FoliaNative?: {
            getAdaptiveLayout?: () => Promise<{ enabled?: boolean }>;
        } } } }).Capacitor?.Plugins?.FoliaNative;
        void plugin?.getAdaptiveLayout?.().then(result => setAdaptiveDisplayEnabled(Boolean(result?.enabled))).catch(() => undefined);
    }, []);
    const toggleAdaptiveDisplay = async (next: boolean) => {
        setAdaptiveDisplayEnabled(next);
        const plugin = (window as unknown as { Capacitor?: { Plugins?: { FoliaNative?: {
            setAdaptiveLayout?: (options: { enabled: boolean }) => Promise<unknown>;
        } } } }).Capacitor?.Plugins?.FoliaNative;
        try { await plugin?.setAdaptiveLayout?.({ enabled: next }); } catch (error) {
            console.warn('[Settings] adaptive-display:set-failed', error);
            setAdaptiveDisplayEnabled(!next);
        }
    };
    const languagePreference = useSettingsModalStore(state => state.appLanguagePreference);
    const setLanguagePreference = useSettingsModalStore(state => state.handleSetAppLanguagePreference);
    const autoPlay = useAudioSettingsStore(state => state.autoPlayOnLaunch);
    const setAutoPlay = useAudioSettingsStore(state => state.handleToggleAutoPlayOnLaunch);
    const titlebarButtons = usePlayerChromeSettingsStore(state => state.alwaysShowMainWindowTitlebar);
    const setTitlebarButtons = usePlayerChromeSettingsStore(state => state.handleToggleAlwaysShowMainWindowTitlebar);
    const ponder = usePonderStore(useShallow(selectPonderSettingsSnapshot));

    const resolvedLanguage = i18n.resolvedLanguage;
    const resolvedLanguageLabel = resolvedLanguage === 'zh-TW'
        ? t('options.appLanguageZhTW')
        : resolvedLanguage?.startsWith('zh')
            ? t('options.appLanguageZhCN')
            : resolvedLanguage === 'in' || resolvedLanguage?.startsWith('id')
                ? t('options.appLanguageInID')
                : resolvedLanguage === 'vi'
                    ? t('options.appLanguageViVN')
                    : t('options.appLanguageEnUS');

    const isInternalBuild = electronSettings.UPDATE_CHANNEL === 'internal';
    const autoUpdateSupported = Boolean(updateStatus?.autoUpdateSupported);
    const isTv = isAndroidTv();
    const tvUpdate = useTvUpdateStore(useShallow(state => ({
        enableUpdateCheck: state.enableUpdateCheck,
        enableAutoUpdate: state.enableAutoUpdate,
        useMirrorAcceleration: state.useMirrorAcceleration,
        status: state.status,
        currentVersion: state.currentVersion,
        latestVersion: state.latestVersion,
        downloadProgress: state.downloadProgress,
        errorMessage: state.errorMessage,
        setEnableUpdateCheck: state.setEnableUpdateCheck,
        setEnableAutoUpdate: state.setEnableAutoUpdate,
        setUseMirrorAcceleration: state.setUseMirrorAcceleration,
        setIsUpdateModalOpen: state.setIsUpdateModalOpen,
        checkForUpdates: state.checkForUpdates,
        downloadUpdate: state.downloadUpdate,
        installDownloadedUpdate: state.installDownloadedUpdate,
    })));

    return (
        <>
            <Group def={LANGUAGE} bare>
                <Row
                    option={O.language}
                    hint={languagePreference === 'system' ? t('options.appLanguageSystemHint', { language: resolvedLanguageLabel }) : undefined}
                >
                    <Select<AppLanguagePreference>
                        value={languagePreference}
                        options={[
                            { value: 'system', label: t('options.appLanguageSystem') },
                            { value: 'zh-CN', label: t('options.appLanguageZhCN') },
                            { value: 'zh-TW', label: t('options.appLanguageZhTW') },
                            { value: 'en', label: t('options.appLanguageEnUS') },
                            { value: 'in', label: t('options.appLanguageInID') },
                            { value: 'vi', label: t('options.appLanguageViVN') },
                        ]}
                        onChange={preference => void setLanguagePreference(preference)}
                    />
                </Row>
            </Group>

            <Group def={LAUNCH}>
                <Row option={O.autoPlay} hint={t('options.autoPlayOnLaunchDesc')} note={t('options.autoPlayOnLaunchDescSub')}>
                    <Toggle checked={autoPlay} onChange={setAutoPlay} />
                </Row>
                {isElectron && (
                    <Row option={O.openPlayer} note={t('options.openPlayerOnLaunchDesc')}>
                        <Toggle checked={openPlayerOnLaunch} onChange={onToggleOpenPlayerOnLaunch} />
                    </Row>
                )}
                {!isTv && (
                    <Row option={O.titlebarButtons} hint={t('options.alwaysShowMainWindowTitlebarDesc')}>
                        <Toggle checked={titlebarButtons} onChange={setTitlebarButtons} />
                    </Row>
                )}
            </Group>

            {/* Android 外壳：与上游设置页同一套 Group/Row 控件，桌面上整组不渲染；电视端精简掉手机刘海与命令面板开关。 */}
            {IS_ANDROID_WEBVIEW && (
                <Group def={ANDROID_SHELL}>
                    <Row option={O.androidAdaptiveDisplay} hint={t('options.adaptiveDisplayDesc')}>
                        <Toggle checked={adaptiveDisplayEnabled} onChange={next => void toggleAdaptiveDisplay(next)} />
                    </Row>

                    <Row option={O.androidKeepScreenOn} hint={t('options.keepScreenOnDesc')}>
                        <Toggle checked={keepScreenOnEnabled} onChange={setKeepScreenOnEnabled} />
                    </Row>
                    {!isTv && (
                        <>
                            <Row option={O.androidPhoneFit} hint={t('options.phoneFitDesc')}>
                                <Toggle checked={phoneFitEnabled} onChange={setPhoneFitEnabled} />
                            </Row>
                            <Row option={O.androidCommandPaletteAutoHide} hint={t('options.autoHideCommandPaletteButtonDesc')}>
                                <Toggle
                                    checked={autoHideCommandPaletteButton}
                                    onChange={handleToggleAutoHideCommandPaletteButton}
                                />
                            </Row>
                            {phoneFitEnabled && (
                                <Row option={O.androidOrientation} hint={t('options.orientationFitDesc')}>
                                    <Segmented
                                        value={phoneFitOrientation}
                                        options={[
                                            { value: 'portrait', label: t('options.orientationPortrait') },
                                            { value: 'landscape', label: t('options.orientationLandscape') },
                                        ]}
                                        onChange={setPhoneFitOrientation}
                                    />
                                </Row>
                            )}
                        </>
                    )}
                </Group>
            )}

            {/* Android / 电视端原生在线更新与自动更新设定 */}
            {(IS_ANDROID_WEBVIEW || isTv) && (
                <Group
                    def={{ id: 'tvAutoUpdate', titleKey: 'options.updateCheck' }}
                    action={(
                        <Button
                            variant="quiet"
                            icon={RefreshCw}
                            onClick={() => void tvUpdate.checkForUpdates({ silent: false })}
                            disabled={tvUpdate.status === 'checking' || tvUpdate.status === 'downloading'}
                        >
                            {tvUpdate.status === 'checking'
                                ? '正在检查...'
                                : tvUpdate.status === 'downloading'
                                    ? `下载中 ${tvUpdate.downloadProgress}%`
                                    : tvUpdate.status === 'available' || tvUpdate.status === 'downloaded'
                                        ? `新版本 v${tvUpdate.latestVersion}`
                                        : '立即检查更新'}
                        </Button>
                    )}
                >
                    <Row
                        label="当前版本与在线升级"
                        hint={
                            tvUpdate.status === 'available'
                                ? `发现新版本 v${tvUpdate.latestVersion}（当前 v${tvUpdate.currentVersion}）`
                                : tvUpdate.status === 'downloaded'
                                    ? `新版本 v${tvUpdate.latestVersion} 更新包已下载就绪`
                                    : tvUpdate.status === 'downloading'
                                        ? `正在后台下载更新包 (${tvUpdate.downloadProgress}%)`
                                        : tvUpdate.status === 'up-to-date'
                                            ? `当前已是最新版本 (v${tvUpdate.currentVersion})`
                                            : tvUpdate.status === 'error'
                                                ? (tvUpdate.errorMessage || '检查更新遇到网络问题，可开启镜像加速后重试')
                                                : `当前版本 v${tvUpdate.currentVersion}`
                        }
                    >
                        {tvUpdate.status === 'downloaded' ? (
                            <Button
                                variant="primary"
                                icon={Download}
                                onClick={() => void tvUpdate.installDownloadedUpdate()}
                            >
                                立即安装更新
                            </Button>
                        ) : tvUpdate.status === 'available' ? (
                            <Button
                                variant="primary"
                                icon={Download}
                                onClick={() => {
                                    tvUpdate.setIsUpdateModalOpen(true);
                                    void tvUpdate.downloadUpdate({ autoInstall: true });
                                }}
                            >
                                下载并更新
                            </Button>
                        ) : (
                            <Button
                                icon={RefreshCw}
                                onClick={() => void tvUpdate.checkForUpdates({ silent: false })}
                                disabled={tvUpdate.status === 'checking' || tvUpdate.status === 'downloading'}
                            >
                                {tvUpdate.status === 'checking' ? '正在检查...' : '检查更新'}
                            </Button>
                        )}
                    </Row>

                    <Row
                        option={O.updateCheck}
                        hint="每次启动电视应用时自动在后台检查是否有新版本发布"
                    >
                        <Toggle
                            checked={tvUpdate.enableUpdateCheck}
                            onChange={tvUpdate.setEnableUpdateCheck}
                        />
                    </Row>

                    <Reveal when={tvUpdate.enableUpdateCheck}>
                        <Row
                            sub
                            option={O.autoUpdate}
                            hint="发现新版本时自动在后台下载 APK 更新包并弹出遥控器一键安装提示"
                        >
                            <Toggle
                                checked={tvUpdate.enableAutoUpdate}
                                onChange={tvUpdate.setEnableAutoUpdate}
                            />
                        </Row>
                    </Reveal>

                    <Row
                        label="国内镜像加速下载"
                        hint="下载更新包时自动优选高速镜像源，连接失败时自动回退官方源"
                    >
                        <Toggle
                            checked={tvUpdate.useMirrorAcceleration}
                            onChange={tvUpdate.setUseMirrorAcceleration}
                        />
                    </Row>
                </Group>
            )}
            {isElectron && (
                <Group
                    def={UPDATE}
                    // The state of the check; pressing it checks again.
                    action={(
                        <Button
                            variant="quiet"
                            icon={RefreshCw}
                            onClick={() => void update.onCheckForUpdates()}
                            disabled={!electronSettings.ENABLE_UPDATE_CHECK || !updateStatus?.updateCheckSupported || updateStatus?.status === 'checking'}
                        >
                            {update.updateBadgeLabel}
                        </Button>
                    )}
                    foot={t(autoUpdateSupported ? 'options.autoUpdateGithubNotice' : 'options.updateCheckGithubNotice')}
                >
                    <FoundUpdateRow />
                    <Row
                        option={O.updateCheck}
                        hint={t(updateStatus?.updateCheckSupportReason === 'channel' ? 'options.updateUnsupportedChannel' : 'options.enableUpdateCheckDesc')}
                        disabled={!updateStatus?.updateCheckSupported}
                    >
                        <Toggle checked={electronSettings.ENABLE_UPDATE_CHECK} onChange={() => void update.onToggleUpdateCheck()} />
                    </Row>
                    <Reveal when={electronSettings.ENABLE_UPDATE_CHECK}>
                        {/* Kept in view where the app cannot update itself: the reason is under the label. */}
                        <Row
                            sub
                            option={O.autoUpdate}
                            hint={t(autoUpdateSupported
                                ? 'options.enableAutoUpdateDesc'
                                : updateStatus?.autoUpdateSupportReason === 'system' ? 'options.updateUnsupportedSystem' : 'options.manualUpdateOnlyDesc')}
                            disabled={!update.canEnableAutoUpdate}
                        >
                            <Toggle checked={electronSettings.ENABLE_AUTO_UPDATE && autoUpdateSupported} onChange={() => void update.onToggleAutoUpdate()} />
                        </Row>
                    </Reveal>
                    <Row option={O.updateChannel} disabled={isInternalBuild}>
                        <Select
                            value={electronSettings.UPDATE_CHANNEL}
                            options={isInternalBuild
                                ? [{ value: 'internal', label: t('options.updateChannelInternal') }]
                                : [
                                    { value: 'realeco', label: t('options.updateChannelRealeco') },
                                    { value: 'limo', label: t('options.updateChannelLimo') },
                                    { value: 'cielo', label: t('options.updateChannelCielo') },
                                ]}
                            onChange={channel => void update.onUpdateChannelChange(channel as 'realeco' | 'limo' | 'cielo')}
                        />
                    </Row>
                </Group>
            )}

            {!isTv && (
                <Group def={PONDER}>
                    <Row option={O.ponderHints} hint={t('options.ponderHintsDesc')}>
                        <Segmented
                            value={ponder.ponderHintVisibility}
                            options={[
                                { value: 'always', label: t('options.ponderHintsAlways') },
                                { value: 'unseen', label: t('options.ponderHintsUnseen') },
                                { value: 'off', label: t('options.ponderHintsOff') },
                            ]}
                            onChange={ponder.setPonderHintVisibility}
                        />
                    </Row>
                    <Row option={O.ponderTouchButton} hint={t('options.ponderTouchButtonDesc')}>
                        <Toggle checked={ponder.showPonderTouchButton} onChange={ponder.setShowPonderTouchButton} />
                    </Row>
                </Group>
            )}
        </>
    );
};

export default GeneralPage;

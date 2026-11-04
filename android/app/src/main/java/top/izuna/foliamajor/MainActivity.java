package top.izuna.foliamajor;

import android.app.UiModeManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.File;
import java.lang.reflect.Method;

public class MainActivity extends BridgeActivity {
    private long lastWebViewRecoveryAt = 0L;
    /**
     * How many renderer rebuilds we run back to back before giving up.
     *
     * The old policy was "recreate once, then finish()": a second renderer death inside 15 seconds
     * closed the activity, and that is exactly what a user reports as 闪退 (the app vanishes).
     * A renderer death is the system reclaiming a sandboxed process — surfacing it in the same
     * activity is the normal, recoverable path for Chromium on Android, so rebuild a few times
     * before treating the page as unloadable. The crash trail records every death either way.
     */
    private static final int MAX_BACK_TO_BACK_RENDERER_RECOVERIES = 3;
    private static final long RENDERER_RECOVERY_WINDOW_MS = 60_000L;
    private static final String WEBVIEW_UPDATE_PREFS = "folia_webview_update";
    private static final String WEBVIEW_UPDATE_KEY = "last_cleared_update_time";
    private int rendererRecoveries = 0;
    private long lastUserLeaveRecordAt = 0L;
    private long lastTrimMemoryRecordAt = 0L;
    private int lastTrimMemoryLevel = Integer.MIN_VALUE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashDiagnostics.install(getApplicationContext());
        clearWebViewCachesAfterAppUpdate();
        registerPlugin(FoliaNativePlugin.class);
        registerPlugin(top.izuna.foliamajor.coloros.FoliaColorOsLyricsPlugin.class);
        super.onCreate(savedInstanceState);
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "create",
            "restoredState=" + (savedInstanceState != null),
            "onCreate"
        );
        installWebViewRendererGuard();
        WebView webView = getBridge().getWebView();
        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (isTvDevice()) {
            // 电视上用 UA 打标：原生在页面第一帧之前就定好了「这是电视」，首启引导默认选哪套
            // 资料库界面、屏幕常亮默认开不开，都读这个结论，不用等页面起来再问原生。
            settings.setUserAgentString(settings.getUserAgentString() + " FoliaTV");
            webView.addJavascriptInterface(new TvHardwareBridge(this, webView), "FoliaTvHardware");
            // 关掉 WebView 的空间导航：它按方向键自己挪 DOM 焦点，遥控器上表现为「按一下方向键，
            // 焦点跑到搜索框、系统输入法弹出来盖住半个屏幕」。API 33 起这个开关默认是开的，
            // 方向键改由页面自己接管（src/library/suites/grid/home/useTvHomeNavigation.ts）。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                disableSpatialNavigation(settings);
            }
            // 电视端默认开启沉浸式全屏，消除系统状态栏/导航栏黑边并铺满 1080p/4K 视口。
            if (!AdaptiveLayout.hasExplicitPreference(this)) {
                AdaptiveLayout.setEnabled(this, true);
            }
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Let the WebView close its own settings/effects layer first. When nothing is open the
                // JS handler now moves the task to the background so playback keeps running; this
                // finish() only remains as the fallback for a WebView with no backButton listener.
                if (FoliaNativePlugin.emitBackPressed()) return;
                CrashDiagnostics.recordText(
                    getApplicationContext(),
                    "activity-lifecycle",
                    "main",
                    "back-finish",
                    "Back had no open layer; finishing activity",
                    "OnBackPressedCallback"
                );
                finish();
            }
        });
        PhoneLayoutOrientation.apply(this);
        PhoneFitCutout.apply(this);
        restoreAdaptiveLayout(webView);
        // 启动时窗口焦点和系统栏状态还会变一次，只应用一遍会被后面的 inset 恢复覆盖。
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 500);
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 1500);
        webView.postDelayed(() -> PhoneFitCutout.apply(this), 500);
        webView.postDelayed(() -> PhoneFitCutout.apply(this), 1500);
    }

    /**
     * 这台设备是不是电视（AOSP TV / VIDAA / Google TV）。
     *
     * 走 UiModeManager 而不是看产品名或型号：电视固件五花八门，但 UI mode 这一个属性是统一的，
     * 手机/平板投屏与车机不会误判成电视。
     */
    private boolean isTvDevice() {
        UiModeManager uiModeManager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        return uiModeManager != null
            && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    /**
     * 关掉 WebView 的空间导航（spatial navigation）。
     *
     * 这个开关在 AOSP 里是 @hide API，公开 SDK 里没有，只能反射调用；找不到就当这个 WebView
     * 没有这个能力（页面那边还有一层捕获阶段的兜底，见 useTvHomeNavigation.ts）。
     */
    private static void disableSpatialNavigation(WebSettings settings) {
        try {
            Method method = WebSettings.class.getMethod("setSpatialNavigationEnabled", boolean.class);
            method.invoke(settings, false);
        } catch (Throwable error) {
            // 这个 WebView 版本没有这个方法：方向键仍旧由页面自己接管。
        }
    }

    /**
     * The PWA service worker caches index.html and every hashed asset. After an APK update the
     * cached index.html can reference chunks that no longer exist in the new package, and that
     * first launch has to run the old JS before the new bundle can repair anything. Clear only
     * WebView's HTTP / service-worker / code caches once per install so the first launch reads the
     * fresh index.html from the APK. Cookies, localStorage and IndexedDB are deliberately kept.
     */
    private void clearWebViewCachesAfterAppUpdate() {
        long updateTime;
        try {
            updateTime = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
        } catch (Exception error) {
            CrashDiagnostics.recordText(
                getApplicationContext(),
                "webview-cache-cleanup",
                "main",
                "package-info-error",
                error.getClass().getSimpleName() + ": " + error.getMessage(),
                "Could not read lastUpdateTime"
            );
            return;
        }

        SharedPreferences preferences = getSharedPreferences(WEBVIEW_UPDATE_PREFS, MODE_PRIVATE);
        if (preferences.getLong(WEBVIEW_UPDATE_KEY, -1L) == updateTime) return;
        preferences.edit().putLong(WEBVIEW_UPDATE_KEY, updateTime).apply();

        File webViewRoot = new File(getDataDir(), "app_webview/Default");
        String[] cachePaths = {
            "HTTP Cache",
            "Code Cache",
            "GPUCache",
            "DawnGraphiteCache",
            "DawnWebGPUCache",
            "Service Worker",
            "Cache",
        };
        for (String path : cachePaths) deleteQuietly(new File(webViewRoot, path));
    }

    private static void deleteQuietly(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteQuietly(child);
        }
        // Failure is non-fatal: the JS-side recovery still handles a stale chunk reference.
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /**
     * A dead WebView renderer kills the Android process when the client returns false, so we take
     * the callback, record why it ended, and rebuild the activity. Repeated deaths still end the
     * app, but only after several rebuilds inside a minute: closing on the second one turned a
     * recoverable renderer kill into the app disappearing mid-use.
     */
    private void installWebViewRendererGuard() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean didCrash = detail != null && detail.didCrash();
                int priority = detail == null ? -1 : detail.rendererPriorityAtExit();
                CrashDiagnostics.recordText(
                    getApplicationContext(),
                    "webview-renderer-gone",
                    "renderer",
                    didCrash ? "renderer-crash" : "renderer-killed",
                    "didCrash=" + didCrash + " priorityAtExit=" + priority,
                    "Capacitor WebView renderer process ended"
                );

                long now = SystemClock.elapsedRealtime();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    // A quiet minute means the previous rebuild held: start counting again.
                    if (now - lastWebViewRecoveryAt > RENDERER_RECOVERY_WINDOW_MS) rendererRecoveries = 0;
                    lastWebViewRecoveryAt = now;
                    rendererRecoveries += 1;
                    if (rendererRecoveries > MAX_BACK_TO_BACK_RENDERER_RECOVERIES) {
                        // Still dying after several rebuilds: better to stop than to loop forever.
                        // The crash trail above already says what the renderer reported.
                        CrashDiagnostics.recordText(
                            getApplicationContext(),
                            "webview-renderer-gone",
                            "renderer",
                            "renderer-give-up",
                            "rendererRecoveries=" + rendererRecoveries
                                + " windowMs=" + RENDERER_RECOVERY_WINDOW_MS,
                            "finish after repeated renderer deaths"
                        );
                        finish();
                        return;
                    }
                    if (view != null) view.destroy();
                    CrashDiagnostics.recordText(
                        getApplicationContext(),
                        "webview-renderer-guard",
                        "main",
                        "recreate",
                        "attempt=" + rendererRecoveries + " didCrash=" + didCrash,
                        "rebuilding activity after renderer death"
                    );
                    recreate();
                });
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.postDelayed(() -> restoreAdaptiveLayout(webView), 100);
            }
        }
        PhoneFitCutout.apply(this);
    }

    @Override
    protected void onUserLeaveHint() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastUserLeaveRecordAt < 3000L) {
            super.onUserLeaveHint();
            return;
        }
        lastUserLeaveRecordAt = now;
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "user-leave",
            "User left the app (Home, Recents, or app switch)",
            "onUserLeaveHint"
        );
        super.onUserLeaveHint();
    }

    @Override
    public void onStop() {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "stop",
            "isFinishing=" + isFinishing() + " changingConfigurations=" + isChangingConfigurations(),
            "onStop"
        );
        super.onStop();
    }

    @Override
    public void onDestroy() {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "destroy",
            "isFinishing=" + isFinishing() + " changingConfigurations=" + isChangingConfigurations(),
            "onDestroy"
        );
        super.onDestroy();
    }

    @Override
    public void onTrimMemory(int level) {
        long now = SystemClock.elapsedRealtime();
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
            && (level != lastTrimMemoryLevel || now - lastTrimMemoryRecordAt >= 10000L)) {
            lastTrimMemoryLevel = level;
            lastTrimMemoryRecordAt = now;
            CrashDiagnostics.recordText(
                getApplicationContext(),
                "memory-pressure",
                "main",
                "trim-memory",
                "level=" + level,
                "onTrimMemory"
            );
            int trimThreshold = isTvDevice()
                ? ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
                : ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL;
            if ((level >= trimThreshold || level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) && getBridge() != null) {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.post(() -> webView.clearCache(false));
                }
            }
        }
        super.onTrimMemory(level);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event != null && isTvDevice() && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null && !webView.hasFocus()) {
                webView.requestFocus();
            }
            int keyCode = event.getKeyCode();
            String mediaAction = null;
            boolean allowRepeat = false;
            switch (keyCode) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    mediaAction = "toggle";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    mediaAction = "play";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                    mediaAction = "pause";
                    break;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    mediaAction = "next";
                    break;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    mediaAction = "previous";
                    break;
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                    mediaAction = "seekForward";
                    allowRepeat = true;
                    break;
                case KeyEvent.KEYCODE_MEDIA_REWIND:
                    mediaAction = "seekBackward";
                    allowRepeat = true;
                    break;
                default:
                    break;
            }
            if (mediaAction != null) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && (allowRepeat || event.getRepeatCount() == 0)) {
                    dispatchWebCustomEvent(
                        "folia-native-media-action",
                        "{\"action\":\"" + mediaAction + "\"}"
                    );
                }
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MENU) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    dispatchWebCustomEvent("folia-tv-menu", "{}");
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void dispatchWebCustomEvent(String eventName, String detailJson) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        String script = "window.dispatchEvent(new CustomEvent('" + eventName + "', { detail: " + detailJson + " }));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                if (isTvDevice() && !webView.hasFocus()) {
                    webView.requestFocus();
                }
                webView.post(() -> restoreAdaptiveLayout(webView));
                webView.post(() -> PhoneFitCutout.apply(this));
            }
        }
    }

    // 用户在设置里开过「自适应屏幕分辨率」的话，恢复沉浸式全屏。失败时回滚，避免反复启动就崩。
    private void restoreAdaptiveLayout(WebView webView) {
        // 自适应布局的 inset 操作可能重置 cutout 模式，这里统一补一次挖孔适配。
        PhoneFitCutout.apply(this);
        if (!AdaptiveLayout.isEnabled(this)) return;
        if (!AdaptiveLayout.apply(this, webView, true)) {
            AdaptiveLayout.setEnabled(this, false);
        }
    }
}

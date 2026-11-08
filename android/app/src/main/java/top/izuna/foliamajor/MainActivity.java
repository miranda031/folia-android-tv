package top.izuna.foliamajor;

import android.app.UiModeManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

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

    private boolean hardwareBridgeRegistered = false;

    private void configureWebViewPreLoad(WebView webView) {
        if (webView == null) return;
        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings settings = webView.getSettings();
        try {
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
        } catch (Throwable ignored) {
        }
        try {
            settings.setMediaPlaybackRequiresUserGesture(false);
        } catch (Throwable ignored) {
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
        } catch (Throwable ignored) {
        }
        if (isTvDevice()) {
            // 必须在 loadUrl 之前设置 UA 和 JavascriptInterface，确保首帧脚本同步读取到 FoliaTV 与 FoliaTvHardware！
            try {
                String ua = settings.getUserAgentString();
                if (ua == null) ua = "";
                if (!ua.contains("FoliaTV")) {
                    settings.setUserAgentString(ua + " FoliaTV");
                }
            } catch (Throwable ignored) {
            }
            if (!hardwareBridgeRegistered) {
                try {
                    webView.addJavascriptInterface(new TvHardwareBridge(this, webView), "FoliaTvHardware");
                    hardwareBridgeRegistered = true;
                } catch (Throwable ignored) {
                }
            }
            disableSpatialNavigation(settings);
            if (!AdaptiveLayout.hasExplicitPreference(this)) {
                AdaptiveLayout.setEnabled(this, true);
            }
        }
    }

    @Override
    protected void load() {
        try {
            WebView preWebView = findViewById(com.getcapacitor.android.R.id.webview);
            configureWebViewPreLoad(preWebView);
        } catch (Throwable ignored) {
        }
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        try {
            setTheme(R.style.AppTheme_NoActionBar);
        } catch (Throwable ignored) {
        }
        try {
            CrashDiagnostics.install(getApplicationContext());
        } catch (Throwable ignored) {
        }
        try {
            clearWebViewCachesAfterAppUpdate();
        } catch (Throwable ignored) {
        }
        try {
            registerPlugin(FoliaNativePlugin.class);
            registerPlugin(top.izuna.foliamajor.coloros.FoliaColorOsLyricsPlugin.class);
        } catch (Throwable ignored) {
        }
        Throwable superCreateError = null;
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable error) {
            superCreateError = error;
            try {
                CrashDiagnostics.record(getApplicationContext(), "activity-oncreate", "main", error);
            } catch (Throwable ignored) {
            }
        }
        try {
            CrashDiagnostics.recordText(
                getApplicationContext(),
                "activity-lifecycle",
                "main",
                "create",
                "restoredState=" + (savedInstanceState != null),
                "onCreate"
            );
        } catch (Throwable ignored) {
        }
        try {
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
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
        } catch (Throwable ignored) {
        }

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            showWebViewFallbackView(superCreateError);
            return;
        }

        installWebViewRendererGuard();
        configureWebViewPreLoad(webView);

        try {
            PhoneLayoutOrientation.apply(this);
        } catch (Throwable ignored) {
        }
        if (isTvDevice()) {
            applyTvFullscreen();
            webView.postDelayed(this::applyTvFullscreen, 500);
            webView.postDelayed(this::applyTvFullscreen, 1500);
        } else {
            PhoneFitCutout.apply(this);
            restoreAdaptiveLayout(webView);
            // 启动时窗口焦点和系统栏状态还会变一次，只应用一遍会被后面的 inset 恢复覆盖。
            webView.postDelayed(() -> restoreAdaptiveLayout(webView), 500);
            webView.postDelayed(() -> restoreAdaptiveLayout(webView), 1500);
            webView.postDelayed(() -> PhoneFitCutout.apply(this), 500);
            webView.postDelayed(() -> PhoneFitCutout.apply(this), 1500);
        }
    }

    /**
     * 电视端安全全屏设置：不触碰手机端刘海屏（DisplayCutout）或 WindowInsetsCompat.Builder 反射，
     * 避免海信 VIDAA / TCL / 创维等定制电视 WindowManager 在分配窗口表面时异常退出。
     */
    private void applyTvFullscreen() {
        try {
            Window window = getWindow();
            if (window == null) return;
            window.setBackgroundDrawableResource(R.color.foliaWindowBackground);
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
            View decorView = window.getDecorView();
            if (decorView != null) {
                int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_FULLSCREEN;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                }
                decorView.setSystemUiVisibility(flags);
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * 当极少数精简版电视 ROM 缺失或损坏系统 WebView 组件时，展示原生遥控器可操控的提示界面，
     * 杜绝因 getBridge() 为 null 抛出 NullPointerException 导致电视系统弹出「启动失败」。
     */
    private void showWebViewFallbackView(Throwable cause) {
        try {
            applyTvFullscreen();
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setGravity(Gravity.CENTER);
            root.setBackgroundColor(Color.parseColor("#09090b"));
            int pad = (int) (32 * getResources().getDisplayMetrics().density);
            root.setPadding(pad, pad, pad, pad);

            TextView title = new TextView(this);
            title.setText("Folia Music · 电视端启动诊断");
            title.setTextColor(Color.WHITE);
            title.setTextSize(22f);
            title.setGravity(Gravity.CENTER);
            root.addView(title);

            TextView msg = new TextView(this);
            String detail = cause != null ? (cause.getClass().getSimpleName() + ": " + cause.getMessage()) : "System WebView unavailable";
            msg.setText("\n当前电视系统的 Android System WebView 组件未能正常初始化。\n设备："
                + Build.MANUFACTURER + " " + Build.MODEL + " (Android " + Build.VERSION.RELEASE + ", API " + Build.VERSION.SDK_INT + ")\n详情："
                + detail + "\n\n可按遥控器「确认键」重试启动，或按「返回键」退出。");
            msg.setTextColor(Color.parseColor("#a1a1aa"));
            msg.setTextSize(15f);
            msg.setGravity(Gravity.CENTER);
            root.addView(msg);

            LinearLayout btnRow = new LinearLayout(this);
            btnRow.setOrientation(LinearLayout.HORIZONTAL);
            btnRow.setGravity(Gravity.CENTER);
            btnRow.setPadding(0, pad / 2, 0, 0);

            Button retryBtn = new Button(this);
            retryBtn.setText("重试启动");
            retryBtn.setFocusable(true);
            retryBtn.setFocusableInTouchMode(true);
            retryBtn.setOnClickListener(v -> recreate());
            btnRow.addView(retryBtn);

            Button exitBtn = new Button(this);
            exitBtn.setText("退出应用");
            exitBtn.setFocusable(true);
            exitBtn.setFocusableInTouchMode(true);
            exitBtn.setOnClickListener(v -> finish());
            btnRow.addView(exitBtn);

            root.addView(btnRow);
            setContentView(root);
            retryBtn.requestFocus();
        } catch (Throwable ignored) {
        }
    }

    /**
     * 这台设备是不是电视/电视盒子/投影仪（AOSP TV / VIDAA / Google TV / 当贝 / 小米盒子 / 华为悦盒 / 极米 / 坚果等）。
     *
     * 重要兼容改进：大量国产电视盒子（小米盒子、当贝盒子、移动魔百盒、电信机顶盒）、投影仪及部分老电视固件的
     * UiModeManager 返回的是 UI_MODE_TYPE_NORMAL 而非 UI_MODE_TYPE_TELEVISION。若仅靠 UI_MODE_TYPE_TELEVISION
     * 判断，这些设备将丢失 FoliaTV 标识与遥控器空间导航，导致遥控器无法操控。
     * 本构建专为电视/盒子/投影仪大屏打造：只要用户未显式开启「手机模式」，一律启用完整电视模式与遥控器导航。
     */
    private boolean isTvDevice() {
        try {
            if (PhoneLayoutOrientation.isEnabled(this)) {
                return false;
            }
        } catch (Throwable ignored) {
        }
        return true;
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

        File dataDir = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            ? getDataDir()
            : new File(getApplicationInfo().dataDir);
        File webViewRoot = new File(dataDir, "app_webview/Default");
        String[] cachePaths = {
            "HTTP Cache",
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
        if (getBridge() == null) return;
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean didCrash = false;
                int priority = -1;
                if (detail != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        didCrash = detail.didCrash();
                        priority = detail.rendererPriorityAtExit();
                    } catch (Throwable ignored) {
                    }
                }
                final boolean crashedFinal = didCrash;
                CrashDiagnostics.recordText(
                    getApplicationContext(),
                    "webview-renderer-gone",
                    "renderer",
                    crashedFinal ? "renderer-crash" : "renderer-killed",
                    "didCrash=" + crashedFinal + " priorityAtExit=" + priority,
                    "Capacitor WebView renderer process ended"
                );

                long now = SystemClock.elapsedRealtime();
                runOnUiThread(() -> {
                    if (isFinishing() || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed())) return;
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
                        "attempt=" + rendererRecoveries + " didCrash=" + crashedFinal,
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
        if (isTvDevice()) {
            applyTvFullscreen();
            if (getBridge() != null && getBridge().getWebView() != null && !getBridge().getWebView().hasFocus()) {
                getBridge().getWebView().requestFocus();
            }
            return;
        }
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
            // 老电视/盒子 WebView（Chrome < 80）对遥控器确认键 KEYCODE_DPAD_CENTER (23) 或小键盘回车 (160)
            // 有时不生成标准 DOM Enter 事件，统一映射为 KEYCODE_ENTER (66) 以确保所有版本 WebView 均能激活按钮。
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
                KeyEvent enterEvent = new KeyEvent(
                    event.getDownTime(),
                    event.getEventTime(),
                    event.getAction(),
                    KeyEvent.KEYCODE_ENTER,
                    event.getRepeatCount(),
                    event.getMetaState(),
                    event.getDeviceId(),
                    event.getScanCode(),
                    event.getFlags(),
                    event.getSource()
                );
                return super.dispatchKeyEvent(enterEvent);
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
                if (isTvDevice()) {
                    applyTvFullscreen();
                    if (!webView.hasFocus()) {
                        webView.requestFocus();
                    }
                } else {
                    webView.post(() -> restoreAdaptiveLayout(webView));
                    webView.post(() -> PhoneFitCutout.apply(this));
                }
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

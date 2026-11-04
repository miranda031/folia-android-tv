package top.izuna.foliamajor;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;

/**
 * 电视硬件能力探测与内存整理桥接（供前端同步读取芯片/CPU/内存/物理分辨率并动态匹配画质与帧率档位）。
 */
public final class TvHardwareBridge {
    private final Activity activity;
    private final WebView webView;
    private final int cachedMaxFreqKhz;

    public TvHardwareBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.cachedMaxFreqKhz = readCpuMaxFreqKhz();
    }

    @JavascriptInterface
    public String getHardwareJson() {
        try {
            Context ctx = activity.getApplicationContext();
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
            long totalRamMb = 0L;
            long availRamMb = 0L;
            boolean isLowRamDevice = false;
            boolean lowMemory = false;
            if (am != null) {
                am.getMemoryInfo(memInfo);
                totalRamMb = memInfo.totalMem / (1024L * 1024L);
                availRamMb = memInfo.availMem / (1024L * 1024L);
                lowMemory = memInfo.lowMemory;
                isLowRamDevice = am.isLowRamDevice();
            }

            int physicalWidth = 1920;
            int physicalHeight = 1080;
            float density = 1.0f;
            try {
                WindowManager wm = (WindowManager) activity.getSystemService(Context.WINDOW_SERVICE);
                if (wm != null) {
                    Display display = wm.getDefaultDisplay();
                    if (display != null) {
                        Display.Mode mode = display.getMode();
                        if (mode != null) {
                            physicalWidth = mode.getPhysicalWidth();
                            physicalHeight = mode.getPhysicalHeight();
                        }
                        DisplayMetrics dm = new DisplayMetrics();
                        display.getRealMetrics(dm);
                        density = dm.density;
                        if (physicalWidth <= 0) physicalWidth = dm.widthPixels;
                        if (physicalHeight <= 0) physicalHeight = dm.heightPixels;
                    }
                }
            } catch (Throwable ignored) {
            }

            JSONObject json = new JSONObject();
            json.put("model", Build.MODEL != null ? Build.MODEL : "Android TV");
            json.put("brand", Build.BRAND != null ? Build.BRAND : "");
            json.put("hardware", Build.HARDWARE != null ? Build.HARDWARE : "");
            json.put("board", Build.BOARD != null ? Build.BOARD : "");
            json.put("sdkInt", Build.VERSION.SDK_INT);
            json.put("cpuCores", Runtime.getRuntime().availableProcessors());
            json.put("cpuMaxFreqKhz", cachedMaxFreqKhz);
            json.put("totalRamMb", totalRamMb);
            json.put("availRamMb", availRamMb);
            json.put("isLowRamDevice", isLowRamDevice);
            json.put("lowMemory", lowMemory);
            json.put("physicalWidth", physicalWidth);
            json.put("physicalHeight", physicalHeight);
            json.put("density", density);
            return json.toString();
        } catch (Throwable error) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void trimMemory() {
        if (webView == null) return;
        webView.post(() -> {
            try {
                webView.clearCache(false);
            } catch (Throwable ignored) {
            }
        });
    }

    private static int readCpuMaxFreqKhz() {
        int maxKhz = 0;
        int cores = Math.min(16, Math.max(1, Runtime.getRuntime().availableProcessors()));
        for (int i = 0; i < cores; i++) {
            File file = new File("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq");
            if (!file.exists()) continue;
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line = reader.readLine();
                if (line != null) {
                    int val = Integer.parseInt(line.trim());
                    if (val > maxKhz) maxKhz = val;
                }
            } catch (Throwable ignored) {
            }
        }
        return maxKhz;
    }
}

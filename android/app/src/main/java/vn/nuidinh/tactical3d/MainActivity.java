package vn.nuidinh.tactical3d;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableHighRefreshRate120Hz();
        applyImmersiveTacticalFullscreen();
        View decorView = getWindow().getDecorView();
        decorView.post(this::applyImmersiveTacticalFullscreen);
        decorView.postDelayed(this::applyImmersiveTacticalFullscreen, 300);
        decorView.setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                decorView.postDelayed(this::applyImmersiveTacticalFullscreen, 1000);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        enableHighRefreshRate120Hz();
        applyImmersiveTacticalFullscreen();
        View decorView = getWindow().getDecorView();
        decorView.post(this::applyImmersiveTacticalFullscreen);
        decorView.postDelayed(this::applyImmersiveTacticalFullscreen, 300);
    }

    @SuppressWarnings("deprecation")
    private void enableHighRefreshRate120Hz() {
        Window window = getWindow();
        if (window == null) {
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? getDisplay()
                    : window.getWindowManager().getDefaultDisplay();
                if (display != null) {
                    Display.Mode current = display.getMode();
                    Display.Mode bestMode = current;
                    for (Display.Mode m : display.getSupportedModes()) {
                        if (
                            m.getPhysicalWidth() == current.getPhysicalWidth() &&
                            m.getPhysicalHeight() == current.getPhysicalHeight() &&
                            m.getRefreshRate() > bestMode.getRefreshRate()
                        ) {
                            bestMode = m;
                        }
                    }
                    WindowManager.LayoutParams lp = window.getAttributes();
                    lp.preferredDisplayModeId = bestMode.getModeId();
                    lp.preferredRefreshRate = bestMode.getRefreshRate();
                    window.setAttributes(lp);
                }
            }
            if (getBridge() != null) {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                }
            }
        } catch (Throwable ignored) {
            // Safely ignore on OEMs restricting display mode selection
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveTacticalFullscreen();
        }
    }

    @SuppressWarnings("deprecation")
    private void applyImmersiveTacticalFullscreen() {
        Window window = getWindow();
        if (window == null) {
            return;
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.BLACK);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        View decorView = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }

        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}

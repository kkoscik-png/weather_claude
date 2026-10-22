package co.seasync.baltic;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String HOST = "weather.seasync.co";
    private static final String START = "https://" + HOST + "/";
    private WebView web;
    private TextView offline;
    private ConnectivityManager connectivity;
    private boolean listening;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { updateConnection(); }
        @Override public void onLost(Network network) { updateConnection(); }
        @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { updateConnection(); }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(16,46,59));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        offline = new TextView(this);
        offline.setText("Offline · saved forecasts may be out of date. Tap to retry.");
        offline.setTextColor(Color.WHITE);
        offline.setBackgroundColor(Color.rgb(133,58,28));
        int padding = (int)(12 * getResources().getDisplayMetrics().density);
        offline.setPadding(padding,padding,padding,padding);
        offline.setVisibility(View.GONE);
        root.addView(offline);
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        root.requestApplyInsets();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " BalticAndroid/1.0.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) &&
                    (uri.getPort() == -1 || uri.getPort() == 443)) return false;
                openExternal(uri);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost()) || !"GET".equals(request.getMethod())) return null;
                String path = uri.getPath();
                if (path == null || path.startsWith("/api/")) return null;
                if (path.equals("/") || path.equals("/index.html")) path = "/index.html";
                if (path.contains("..") || path.contains("\\")) return missing();
                try {
                    return new WebResourceResponse(mime(path), "UTF-8", 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"), getAssets().open("www" + path));
                } catch (IOException e) {
                    // Never silently mix a newer website UI into the installed snapshot.
                    return missing();
                }
            }
        });
        offline.setOnClickListener(v -> web.evaluateJavascript("if(typeof refreshWeather==='function')refreshWeather();", null));
        connectivity = (ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        connectivity.registerDefaultNetworkCallback(networkCallback);
        listening = true;
        updateConnection();
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(START);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"mailto".equals(scheme) && !"geo".equals(scheme)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "No app available to open this link", Toast.LENGTH_SHORT).show(); }
    }

    private void updateConnection() {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed() || connectivity == null) return;
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
            boolean online = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            boolean wasOffline = offline.getVisibility() == View.VISIBLE;
            offline.setVisibility(online ? View.GONE : View.VISIBLE);
            if (online && wasOffline) web.evaluateJavascript("if(typeof refreshWeather==='function')refreshWeather();", null);
        });
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
            new ByteArrayInputStream("Not included in this app version".getBytes(StandardCharsets.UTF_8)));
    }

    private void handleBack() {
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}const m=document.querySelector('.map-section.map-full');if(m){document.getElementById('mapFull').click();return true;}return false;})()", result -> {
            if (!"true".equals(result)) { if (web.canGoBack()) web.goBack(); else finish(); }
        });
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onSaveInstanceState(Bundle state) { web.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) { web.onResume(); updateConnection(); } }
    @Override protected void onDestroy() {
        if (listening) connectivity.unregisterNetworkCallback(networkCallback);
        web.destroy();
        super.onDestroy();
    }
}

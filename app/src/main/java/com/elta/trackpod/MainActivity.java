package com.elta.trackpod;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 23) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, 100);
            }
        }

        WebView webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        webView.addJavascriptInterface(new AndroidShareBridge(), "AndroidShare");
settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    return handleExternalUrl(request.getUrl().toString());
                }
                return false;
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternalUrl(url);
            }
            private boolean handleExternalUrl(String url) {
                if (url != null && (url.startsWith("https://wa.me/") || url.startsWith("https://api.whatsapp.com/") || url.startsWith("whatsapp://"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }



    public class AndroidShareBridge {
        @JavascriptInterface
        public void shareText(final String text) {
            shareWhatsApp(text);
        }

        @JavascriptInterface
        public void shareWhatsApp(final String text) {
            MainActivity.this.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent sendIntent = new Intent(Intent.ACTION_SEND);
                        sendIntent.setType("text/plain");
                        sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                        sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        Intent chooser = Intent.createChooser(sendIntent, "Enviar actualización");
                        MainActivity.this.startActivity(chooser);
                    } catch (Exception e) {
                        try {
                            Intent sendIntent = new Intent(Intent.ACTION_SEND);
                            sendIntent.setType("text/plain");
                            sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                            sendIntent.setPackage("com.whatsapp");
                            sendIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            MainActivity.this.startActivity(sendIntent);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            MainActivity.this.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        MainActivity.this.startActivity(intent);
                    } catch (Exception ignored) {}
                }
            });
        }
    }


    private void openExternalUrlFromWebView(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception e) {
            try {
                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType("text/plain");
                String text = "";
                Uri uri = Uri.parse(url);
                String queryText = uri.getQueryParameter("text");
                if (queryText != null) text = queryText;
                sendIntent.putExtra(Intent.EXTRA_TEXT, text);
                sendIntent.setPackage("com.whatsapp");
                startActivity(Intent.createChooser(sendIntent, "Enviar por WhatsApp"));
            } catch (Exception ignored) {}
        }
    }

    private class TrackPodWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url == null) return false;
            if (url.startsWith("whatsapp://") || url.startsWith("https://wa.me/") || url.startsWith("https://api.whatsapp.com/") || url.startsWith("intent://")) {
                openExternalUrlFromWebView(url);
                return true;
            }
            return false;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && request != null && request.getUrl() != null) {
                String url = request.getUrl().toString();
                if (url.startsWith("whatsapp://") || url.startsWith("https://wa.me/") || url.startsWith("https://api.whatsapp.com/") || url.startsWith("intent://")) {
                    openExternalUrlFromWebView(url);
                    return true;
                }
            }
            return false;
        }
    }

}

package com.matcheslive.sports;

import android.app.Activity;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.unity3d.ads.IUnityAdsInitializationListener;
import com.unity3d.ads.IUnityAdsLoadListener;
import com.unity3d.ads.IUnityAdsShowListener;
import com.unity3d.ads.UnityAds;
import com.unity3d.ads.UnityAdsShowOptions;
import com.unity3d.services.banners.BannerErrorInfo;
import com.unity3d.services.banners.BannerView;
import com.unity3d.services.banners.UnityBannerSize;

@CapacitorPlugin(name = "UnityAds")
public class UnityAdsPlugin extends Plugin {
    private BannerView bannerView;

    @PluginMethod
    public void initialize(PluginCall call) {
        String gameId = call.getString("gameId", "");
        boolean testMode = call.getBoolean("testMode", true);

        if (gameId == null || gameId.trim().isEmpty()) {
            call.reject("Unity Ads gameId is required");
            return;
        }

        if (UnityAds.isInitialized()) {
            JSObject result = new JSObject();
            result.put("initialized", true);
            result.put("testMode", testMode);
            result.put("sdkVersion", UnityAds.getVersion());
            call.resolve(result);
            return;
        }

        UnityAds.initialize(getContext(), gameId.trim(), testMode, new IUnityAdsInitializationListener() {
            @Override
            public void onInitializationComplete() {
                JSObject result = new JSObject();
                result.put("initialized", true);
                result.put("testMode", testMode);
                result.put("sdkVersion", UnityAds.getVersion());
                notifyListeners("sdkInitialized", result);
                call.resolve(result);
            }

            @Override
            public void onInitializationFailed(UnityAds.UnityAdsInitializationError error, String message) {
                JSObject err = new JSObject();
                err.put("code", error != null ? error.name() : "UNKNOWN");
                err.put("message", message != null ? message : "Initialization failed");
                notifyListeners("sdkInitFailed", err);
                call.reject(err.getString("message"), err.getString("code"));
            }
        });
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        String placementId = call.getString("placementId", "Banner_Android");
        int bottomMarginDp = call.getInt("bottomMarginDp", 56);

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }

        activity.runOnUiThread(() -> {
            destroyBannerInternal();

            bannerView = new BannerView(activity, placementId, new UnityBannerSize(320, 50));
            bannerView.setListener(new BannerView.Listener() {
                @Override
                public void onBannerLoaded(BannerView bannerAdView) {
                    JSObject payload = new JSObject();
                    payload.put("placementId", placementId);
                    payload.put("loaded", true);
                    notifyListeners("bannerLoaded", payload);
                }

                @Override
                public void onBannerFailedToLoad(BannerView bannerAdView, BannerErrorInfo errorInfo) {
                    JSObject payload = new JSObject();
                    payload.put("placementId", placementId);
                    payload.put("error", errorInfo != null ? errorInfo.errorMessage : "Failed to load banner");
                    notifyListeners("bannerFailedToLoad", payload);
                }

                @Override
                public void onBannerClick(BannerView bannerAdView) {
                    JSObject payload = new JSObject();
                    payload.put("placementId", placementId);
                    notifyListeners("bannerClicked", payload);
                }
            });

            DisplayMetrics metrics = activity.getResources().getDisplayMetrics();
            int bottomMarginPx = Math.round(bottomMarginDp * metrics.density);

            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
            );
            params.bottomMargin = bottomMarginPx;

            ViewGroup rootView = activity.findViewById(android.R.id.content);
            rootView.addView(bannerView, params);
            bannerView.load();

            JSObject result = new JSObject();
            result.put("requested", true);
            result.put("placementId", placementId);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            destroyBannerInternal();
            call.resolve();
        });
    }

    @PluginMethod
    public void loadInterstitial(PluginCall call) {
        String placementId = call.getString("placementId", "Interstitial_Android");
        UnityAds.load(placementId, new IUnityAdsLoadListener() {
            @Override
            public void onUnityAdsAdLoaded(String id) {
                JSObject res = new JSObject();
                res.put("placementId", id);
                res.put("loaded", true);
                notifyListeners("interstitialLoaded", res);
                call.resolve(res);
            }

            @Override
            public void onUnityAdsFailedToLoad(String id, UnityAds.UnityAdsLoadError error, String message) {
                call.reject(message != null ? message : "Interstitial load failed", error != null ? error.name() : "LOAD_ERROR");
            }
        });
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        String placementId = call.getString("placementId", "Interstitial_Android");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }

        activity.runOnUiThread(() -> UnityAds.show(activity, placementId, new UnityAdsShowOptions(), new IUnityAdsShowListener() {
            @Override
            public void onUnityAdsShowFailure(String id, UnityAds.UnityAdsShowError error, String message) {
                call.reject(message != null ? message : "Show failed", error != null ? error.name() : "SHOW_ERROR");
            }

            @Override
            public void onUnityAdsShowStart(String id) {
                JSObject res = new JSObject();
                res.put("placementId", id);
                notifyListeners("interstitialStarted", res);
            }

            @Override
            public void onUnityAdsShowClick(String id) {
                JSObject res = new JSObject();
                res.put("placementId", id);
                notifyListeners("interstitialClicked", res);
            }

            @Override
            public void onUnityAdsShowComplete(String id, UnityAds.UnityAdsShowCompletionState state) {
                JSObject res = new JSObject();
                res.put("placementId", id);
                res.put("state", state != null ? state.name() : "COMPLETED");
                notifyListeners("interstitialCompleted", res);
                call.resolve(res);
            }
        }));
    }

    private void destroyBannerInternal() {
        if (bannerView != null) {
            ViewGroup parent = (ViewGroup) bannerView.getParent();
            if (parent != null) {
                parent.removeView(bannerView);
            }
            bannerView.destroy();
            bannerView = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(this::destroyBannerInternal);
        }
        super.handleOnDestroy();
    }
}

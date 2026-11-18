/**
 * Matches Live Runtime Configuration
 *
 * Before building a release APK:
 *   1. Set `apiBaseUrl` to your deployed HTTPS backend URL (e.g. "https://api.matcheslive.yourdomain.com")
 *   2. Optionally set `ads.gameId` (or supply it dynamically from GET /api/config on your backend)
 *   3. Set `ads.testMode = false` only after verifying test ads and receiving ad network approval
 *
 * NOTE: Never store admin tokens or private credentials in this file.
 */
window.MATCHES_LIVE_CONFIG = {
  apiBaseUrl: "",
  appVersion: "2.2.0",
  pollIntervalMs: 30000,
  ads: {
    network: "Unity Ads",
    gameId: "",
    bannerPlacementId: "Banner_Android",
    interstitialPlacementId: "Interstitial_Android",
    testMode: true
  }
};

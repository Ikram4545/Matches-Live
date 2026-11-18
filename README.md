# Matches Live — Complete App & Backend Suite (v2.2.0)

A multi-screen Android sports streaming & live events application with a hardened Node.js backend, HLS multi-server playback with same-match automatic failover, Picture-in-Picture (PiP), native Unity Ads SDK integration (for direct-download Android APKs), and automated backend tests.

---

## 📁 Repository Structure

```text
Matches-Live/
├── android-app/                     # Capacitor 8 + Native Android Gradle project
│   ├── www/
│   │   ├── config.js                # Runtime API Base URL & Unity Ads config (no secrets)
│   │   └── index.html               # Backend-driven UI, HLS player & same-item failover engine
│   ├── android/
│   │   └── app/src/main/java/com/matcheslive/sports/
│   │       ├── MainActivity.java    # Registers UnityAdsPlugin
│   │       └── UnityAdsPlugin.java  # Native Unity Ads Banner & Interstitial Capacitor bridge
│   ├── capacitor.config.json
│   └── package.json
├── backend/                         # Zero-dependency Node.js API & HLS Health Validator
│   ├── server.js                    # Authenticated Admin API, SSRF-safe URL validator & async HLS probe
│   ├── database.json                # Matches, categories & channels data store
│   ├── test.js                      # Automated security, URL validation & concurrency tests
│   └── .env.example                 # Required production environment variables
├── preview/                         # Browser preview, UI mockup, screenshots & walkthrough video
└── releases/
    └── Matches_Live_v2.2.0.apk      # Rebuilt debug APK with Unity Ads SDK & backend sync
```

---

## 🔧 Key Fixes Implemented (v2.2.0)

### 1. Backend-Driven Android App (`android-app/www/`)
- Removed hardcoded `localhost:5000`, hardcoded demo match arrays, hardcoded scores, and `defaultStream`.
- Added configurable API base URL (`config.js`, `?api=...`, and in-app **Backend Server Settings** modal).
- Renders matches, scores, overs, server lists, and announcements from `GET /api/matches`, and the full channel & category directory from `GET /api/channels`.
- Handles loading, empty states, and API outages cleanly with Retry & Configure Server actions.
- Background polling syncs updated server lists dynamically without reinstalling the APK.

### 2. Fixed Playback, Server Switching & Same-Match Failover
- Eliminated `defaultStream` reference errors; `switchServer()` and channel/category clicks load the selected item's actual stream URLs.
- Dynamically builds server selector pills from the selected match or channel's primary and backup streams (with backend online/offline status dots).
- Automatic failover stays strictly on the currently selected match or channel, tracks failed backups, stops once all backups are exhausted, and displays a clear **Retry Stream** overlay.

### 3. Hardened Backend & Async HLS Health Checks (`backend/server.js`)
- Protected `POST /api/admin/update-match`, `POST /api/admin/update-channel`, and `POST /api/admin/run-health-check` with `Authorization: Bearer <ADMIN_API_TOKEN>` verified via `crypto.timingSafeEqual` (fails closed with `503` when unset).
- Strict payload validation and approved HTTPS-only stream URL validation (blocks `http:`, embedded credentials, private/loopback/link-local IPs, and hosts outside `ALLOWED_STREAM_HOSTS`).
- Fixed async health checks to await all probes via `Promise.allSettled`, verify actual HLS playlist content (`#EXTM3U` + HLS tags/segments, rejecting 200 HTML error pages), and re-read the latest DB before atomic write so concurrent admin edits are never overwritten.
- Added optional live scores provider integration (`CRICKET_API_URL` + `CRICKET_API_KEY`) with server-side caching mapped via `externalScoreId`.

### 4. Direct-Download APK Ad Integration (`UnityAdsPlugin.java`)
- Integrated official **Unity Ads Android SDK (`com.unity3d.ads:unity-ads:4.12.5`)** via native Capacitor plugin `UnityAdsPlugin` (suitable for direct-download APKs).
- Supports Banner (`320x50`) and Interstitial ads with `testMode: true` for test-ad verification before switching to live ads via `/api/config` (`UNITY_GAME_ID`, `UNITY_TEST_MODE=false`).

---

## 🚀 Quick Start for Developers

### 1. Run Backend Automated Tests
```bash
cd backend
node test.js
```

### 2. Run Backend Server
```bash
cd backend
# Copy .env.example and export environment variables:
# ADMIN_API_TOKEN, ALLOWED_STREAM_HOSTS, NODE_ENV, ALLOW_DEMO_FEEDS, UNITY_GAME_ID
node server.js
```

### 3. Build Android APK
Requires **Node.js 18+**, **Java JDK 17**, and **Android SDK**:
```bash
cd android-app
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```
Output APK: `android-app/android/app/build/outputs/apk/debug/app-debug.apk`

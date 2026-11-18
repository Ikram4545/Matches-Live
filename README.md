# Matches Live — Complete App & Backend Suite

A complete multi-screen Android sports streaming & live events application with a lightweight Node.js auto-failover backend API, HLS multi-server video player, Picture-in-Picture (PiP) support, categorized channel directories, and ready-to-install APK build.

---

## 📁 Repository Structure

```text
Matches-Live/
├── android-app/          # Capacitor + Native Android Gradle project
│   ├── www/index.html    # Full multi-screen app UI, HLS player & Auto-Failover engine
│   ├── android/          # Android native project (Manifest, Gradle, PiP & Cleartext config)
│   ├── capacitor.config.json
│   └── package.json
├── backend/              # Zero-dependency Node.js API & Stream Health Monitor
│   ├── server.js         # REST API + 60s background stream validator daemon
│   └── database.json     # Dynamic matches, servers, channels & announcement store
├── preview/              # Interactive browser preview, UI mockup, screenshots & walkthrough video
│   ├── matches_live_preview.html
│   ├── matches_live_mockup.jpg
│   ├── matches_live_walkthrough.mp4
│   └── screens/
└── releases/
    └── Matches_Live_v2.1_AutoFailover.apk   # Pre-built installable Android APK (3.94 MB)
```

---

## ✨ Implemented Features

1. **Multi-Screen Navigation Shell:**
   - **Tab 1 — Live Events:** Scrolling announcement marquee, sports category filters (`All`, `Cricket`, `Football`, `Boxing`, `Racing`, `Tennis`), and dynamic match cards with flags, live scores/overs, and countdowns.
   - **Tab 2 — Sports Channels:** 4-column circular 24/7 sports channel grid with real-time search.
   - **Tab 3 — Categories & OTT Hub:** 12 regional & OTT category cards (`Tata Play`, `Hotstar`, `SonyLIV`, `Jio IND`, `Pakistan`, `India`, `Kids`, `News`, `Discovery`, `Music`, `Sun Direct`, `Distro TV`), each opening a dedicated sub-category channel page with its own search bar.
   - **Navigation Drawer & Modals:** Telegram backup link, Check for Updates modal (`v2.0`), Starred Channels, Notifications, Share App.
2. **HLS Video Player with Auto-Failover:**
   - Powered by `hls.js` with multi-server pills (`HD 1`, `HD 2`, `PTV Sports`, `Ten Sports`, `Willow HD`, `Low 480p`).
   - Automatic failover on fatal `NETWORK_ERROR` / stream drop to backup mirrors.
   - Picture-in-Picture (`supportsPictureInPicture="true"`) & Cleartext HTTP support (`usesCleartextTraffic="true"`) configured in `AndroidManifest.xml`.
3. **Monetization Ready:**
   - Sticky bottom banner ad slot and pre-roll/interstitial trigger hooks.
4. **Backend API & Dynamic Content (`backend/server.js`):**
   - `GET /api/matches` — Serves live matches, multi-server URLs, scores, and marquee announcements.
   - `GET /api/channels` — Serves categorized channels and backup mirrors.
   - `POST /api/admin/update-match` — Update match scores, overs, or stream URLs in real time without recompiling the APK.
   - Background health-check daemon validates configured stream URLs every 60 seconds.

---

## 🚀 Quick Start for Developers

### 1. Run the Backend Server
Requires Node.js 18+ (no `npm install` needed — uses native Node modules):

```bash
cd backend
node server.js
```
Server starts on **`http://localhost:5000`**.

> **Production Note:** Deploy `backend/` to a cloud VPS/host (e.g., Railway, Render, DigitalOcean) and update the API URL (`http://localhost:5000/api/matches`) inside `android-app/www/index.html` to your production HTTPS domain before building the release APK.

### 2. Replace Placeholder Streams & Connect Live Score API
- Currently, `backend/database.json` and `android-app/www/index.html` use public HLS test streams (`test-streams.mux.dev`, `rbmn-live.akamaized.net`) for player verification.
- Replace the `url` entries in `backend/database.json` with your licensed/authorized `.m3u8` (HLS) or `.mpd` (DASH) streaming feeds.
- To integrate real-time live cricket/football scores, add a polling worker in `backend/server.js` (e.g., every 15 seconds) calling **CricketData.org (CricAPI)**, **RapidAPI**, or **Sportmonks**, caching the result in memory/JSON so all app users read from your backend without exhausting API quotas.

### 3. Build the Android APK Locally
Requires **Node.js 18+**, **Java JDK 17**, and **Android SDK**:

```bash
cd android-app
npm install
npx cap sync android
cd android
# Set Android SDK path in local.properties if not set via ANDROID_HOME
./gradlew assembleDebug
```

Compiled APK output path:
```text
android-app/android/app/build/outputs/apk/debug/app-debug.apk
```

*(Note: `android/app/build.gradle` is configured with `JavaVersion.VERSION_17` compatibility via an `afterEvaluate` block so it compiles cleanly on JDK 17).*

---

## 📸 App Previews

See the `preview/screens/` folder for rendered screenshots of every screen and `preview/matches_live_walkthrough.mp4` for the app flow video.

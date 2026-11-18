const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const DB_FILE = path.join(__dirname, 'database.json');

// Initial Permanent Database with Multi-Server Mirror Redundancy
const initialData = {
  version: "2.1",
  announcement: "📢 Matches Live Auto-Failover Active! Multi-server redundancy ensures uninterrupted HD streaming.",
  matches: [
    {
      id: "m_wc_01",
      tournament: "ICC ODI WORLD CUP - LIVE NOW",
      category: "cricket",
      team1: { name: "Pakistan", flag: "🇵🇰" },
      team2: { name: "India", flag: "🇮🇳" },
      status: "LIVE",
      score: "264 / 4",
      overs: "● LIVE 42.4 ov",
      servers: [
        { name: "HD 1 (Primary Mux)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "ONLINE" },
        { name: "HD 2 (Akamai Live)", url: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8", status: "ONLINE" },
        { name: "HD 3 (PiShow Relay)", url: "https://cdn.pishow.tv/ott/live/1161/master.m3u8", status: "ONLINE" },
        { name: "HD 4 (Backup 720p)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "ONLINE" }
      ]
    },
    {
      id: "m_test_02",
      tournament: "TEST INTERNATIONAL",
      category: "cricket",
      team1: { name: "South Africa", flag: "🇿🇦" },
      team2: { name: "Australia", flag: "🇦🇺" },
      status: "UPCOMING",
      score: "01:30 PM",
      overs: "Starts in 3 Hours",
      servers: [
        { name: "HD 1", url: "https://cdn.pishow.tv/ott/live/1161/master.m3u8", status: "ONLINE" },
        { name: "HD 2", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "ONLINE" }
      ]
    },
    {
      id: "m_wtc_03",
      tournament: "ICC WORLD TEST CHAMPIONSHIP",
      category: "cricket",
      team1: { name: "Bangladesh", flag: "🇧🇩" },
      team2: { name: "West Indies", flag: "🏝️" },
      status: "UPCOMING",
      score: "08:30 AM",
      overs: "Starts Tomorrow",
      servers: [
        { name: "HD 1", url: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8", status: "ONLINE" },
        { name: "HD 2", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "ONLINE" }
      ]
    },
    {
      id: "m_ucl_04",
      tournament: "UEFA CHAMPIONS LEAGUE",
      category: "football",
      team1: { name: "Real Madrid", flag: "🇪🇸" },
      team2: { name: "Man City", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
      status: "LIVE",
      score: "2 - 1",
      overs: "● LIVE 78'",
      servers: [
        { name: "HD 1 (Global Live)", url: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8", status: "ONLINE" },
        { name: "HD 2 (Backup)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", status: "ONLINE" }
      ]
    }
  ],
  channels: [
    {
      id: "c_ptv",
      name: "PTV Sports HD",
      category: "pakistan",
      code: "PTV",
      color: "#047857",
      servers: [
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8",
        "http://103.250.28.74:8000/play/a019/index.m3u8"
      ]
    },
    {
      id: "c_ten",
      name: "Ten Sports Pakistan",
      category: "pakistan",
      code: "TEN",
      color: "#b91c1c",
      servers: [
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8",
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "http://121.91.61.106:8000/play/a04h/index.m3u8"
      ]
    },
    {
      id: "c_willow",
      name: "Willow Cricket HD",
      category: "sports",
      code: "WILLOW",
      color: "#d97706",
      servers: [
        "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      ]
    },
    {
      id: "c_star",
      name: "Star Sports 1 HD",
      category: "india",
      code: "STAR 1",
      color: "#1d4ed8",
      servers: [
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8"
      ]
    },
    {
      id: "c_asports",
      name: "A Sports HD",
      category: "pakistan",
      code: "A SP",
      color: "#dc2626",
      servers: [
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8",
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      ]
    },
    {
      id: "c_sky",
      name: "Sky Sports Cricket",
      category: "sports",
      code: "SKY",
      color: "#0284c7",
      servers: [
        "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      ]
    },
    {
      id: "c_fox",
      name: "Fox Cricket",
      category: "sports",
      code: "FOX",
      color: "#334155",
      servers: [
        "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8"
      ]
    },
    {
      id: "c_bein",
      name: "beIN Sports HD",
      category: "sports",
      code: "beIN",
      color: "#7c3aed",
      servers: [
        "https://cdn.pishow.tv/ott/live/1161/master.m3u8",
        "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8"
      ]
    }
  ]
};

// Load or initialize DB
function getDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return initialData;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Background Stream Validator / Auto-Failover Daemon
function validateStream(streamUrl, callback) {
  const isHttps = streamUrl.startsWith('https');
  const client = isHttps ? https : http;
  
  try {
    const req = client.get(streamUrl, { timeout: 3000, headers: { 'User-Agent': 'MatchesLive/2.1' } }, (res) => {
      const isOk = res.statusCode >= 200 && res.statusCode < 400;
      callback(isOk);
    });
    req.on('error', () => callback(false));
    req.on('timeout', () => { req.destroy(); callback(false); });
  } catch (e) {
    callback(false);
  }
}

// Run health checks every 60 seconds
setInterval(() => {
  const db = getDB();
  let updated = false;
  
  db.matches.forEach(m => {
    m.servers.forEach(s => {
      validateStream(s.url, (isAlive) => {
        const newStatus = isAlive ? 'ONLINE' : 'DEGRADED';
        if (s.status !== newStatus) {
          s.status = newStatus;
          updated = true;
        }
      });
    });
  });
  
  if (updated) {
    saveDB(db);
  }
}, 60000);

// HTTP API Server
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. API: Get Live Config & Matches
  if (pathname === '/api/matches') {
    const db = getDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: db.matches.length, matches: db.matches, announcement: db.announcement }));
    return;
  }

  // 2. API: Get All Channels
  if (pathname === '/api/channels') {
    const db = getDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: db.channels.length, channels: db.channels }));
    return;
  }

  // 3. API: Admin Update Link Dynamically
  if (pathname === '/api/admin/update-match' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const db = getDB();
        const match = db.matches.find(m => m.id === payload.matchId);
        if (match) {
          if (payload.score) match.score = payload.score;
          if (payload.overs) match.overs = payload.overs;
          if (payload.servers) match.servers = payload.servers;
          saveDB(db);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: "Match updated in real-time" }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: "Match not found" }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Default Health Status
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: "RUNNING", service: "Matches Live Failover Engine v2.1", port: PORT }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Matches Live Backend] Auto-Failover Server running on http://0.0.0.0:${PORT}`);
});

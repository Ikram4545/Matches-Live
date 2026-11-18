const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');

const DEFAULT_DEV_ALLOWED_HOSTS = [
  'test-streams.mux.dev',
  'rbmn-live.akamaized.net',
  'cdn.pishow.tv'
];

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const MAX_PLAYLIST_BYTES = 16 * 1024; // 16 KB
const MAX_REDIRECTS = 3;
const ALLOWED_MATCH_STATUSES = new Set(['LIVE', 'UPCOMING', 'RECENT']);

function parseAllowedHosts(envValue, nodeEnv) {
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return envValue
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  // In production, require explicit ALLOWED_STREAM_HOSTS allowlist
  if (nodeEnv === 'production') {
    return [];
  }
  return [...DEFAULT_DEV_ALLOWED_HOSTS];
}

function isPrivateOrDisallowedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return true; // Disallow raw IPv4 literals for approved HTTPS stream URLs
  }

  if (ipVersion === 6) {
    return true; // Disallow raw IPv6 literals for approved HTTPS stream URLs
  }

  return false;
}

function hostMatchesAllowlist(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".example.com"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === entry || host.endsWith('.' + entry);
  });
}

function validateApprovedStreamUrl(rawUrl, allowedHosts) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { valid: false, error: 'Stream URL must be a non-empty string' };
  }
  if (rawUrl.length > 2048) {
    return { valid: false, error: 'Stream URL exceeds 2048 character limit' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: 'Stream URL is not a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS stream URLs are permitted' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Stream URL must not contain embedded credentials' };
  }

  if (!parsed.hostname || isPrivateOrDisallowedHost(parsed.hostname)) {
    return { valid: false, error: 'Stream URL host is private, local, or an IP literal' };
  }

  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    return { valid: false, error: 'No approved stream hosts are configured (ALLOWED_STREAM_HOSTS)' };
  }

  if (!hostMatchesAllowlist(parsed.hostname, allowedHosts)) {
    return {
      valid: false,
      error: `Stream host "${parsed.hostname}" is not in ALLOWED_STREAM_HOSTS`
    };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

function isValidHlsPlaylist(bodyText) {
  if (typeof bodyText !== 'string') return false;
  const cleaned = bodyText.replace(/^\uFEFF/, '').trim();
  if (!cleaned.startsWith('#EXTM3U')) return false;
  if (/^\s*<!doctype\s+html/i.test(cleaned) || /<html[\s>]/i.test(cleaned)) return false;

  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hasHlsTag = lines.some(
    (l) =>
      l.startsWith('#EXT-X-STREAM-INF') ||
      l.startsWith('#EXT-X-TARGETDURATION') ||
      l.startsWith('#EXT-X-VERSION') ||
      l.startsWith('#EXTINF:') ||
      l.startsWith('#EXT-X-MEDIA')
  );

  const hasMediaUri = lines.some(
    (l) => !l.startsWith('#') && /\.(m3u8|ts|m4s|mp4|aac)(\?.*)?$/i.test(l)
  );

  return hasHlsTag || hasMediaUri;
}

function probeHlsStream(streamUrl, allowedHosts, options = {}, redirectCount = 0) {
  const timeoutMs = options.timeoutMs || 5000;
  const customFetcher = options.fetcher || null;

  const check = validateApprovedStreamUrl(streamUrl, allowedHosts);
  if (!check.valid) {
    return Promise.resolve({
      alive: false,
      status: 'REJECTED_URL',
      reason: check.error
    });
  }

  if (customFetcher) {
    return Promise.resolve(customFetcher(check.normalizedUrl)).then((result) => {
      const ok = result.statusCode >= 200 && result.statusCode < 300 && isValidHlsPlaylist(result.body);
      return {
        alive: ok,
        status: ok ? 'ONLINE' : 'OFFLINE',
        reason: ok ? 'Valid HLS playlist' : result.reason || 'Invalid HLS response'
      };
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    try {
      const req = https.get(
        check.normalizedUrl,
        {
          timeout: timeoutMs,
          headers: {
            'User-Agent': 'MatchesLive-HealthCheck/2.2',
            Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
          }
        },
        (res) => {
          const code = res.statusCode || 0;

          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume();
            if (redirectCount >= MAX_REDIRECTS) {
              return finish({ alive: false, status: 'OFFLINE', reason: 'Too many redirects' });
            }
            let nextUrl;
            try {
              nextUrl = new URL(res.headers.location, check.normalizedUrl).toString();
            } catch {
              return finish({ alive: false, status: 'OFFLINE', reason: 'Invalid redirect URL' });
            }
            return probeHlsStream(nextUrl, allowedHosts, options, redirectCount + 1).then(finish);
          }

          if (code < 200 || code >= 300) {
            res.resume();
            return finish({ alive: false, status: 'OFFLINE', reason: `HTTP ${code}` });
          }

          const chunks = [];
          let bytes = 0;

          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes <= MAX_PLAYLIST_BYTES) {
              chunks.push(chunk);
            } else {
              const remaining = MAX_PLAYLIST_BYTES - (bytes - chunk.length);
              if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
              res.destroy();
            }
          });

          const evaluate = () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            if (isValidHlsPlaylist(body)) {
              finish({ alive: true, status: 'ONLINE', reason: 'Valid HLS playlist' });
            } else {
              finish({ alive: false, status: 'OFFLINE', reason: 'Response is not a valid HLS playlist' });
            }
          };

          res.on('end', evaluate);
          res.on('close', evaluate);
          res.on('error', (err) => finish({ alive: false, status: 'OFFLINE', reason: err.message }));
        }
      );

      req.on('error', (err) => finish({ alive: false, status: 'OFFLINE', reason: err.message }));
      req.on('timeout', () => {
        req.destroy();
        finish({ alive: false, status: 'OFFLINE', reason: 'Request timeout' });
      });
    } catch (err) {
      finish({ alive: false, status: 'OFFLINE', reason: err.message });
    }
  });
}

function normalizeServerEntry(entry, idx) {
  if (typeof entry === 'string') {
    return {
      name: `HD ${idx + 1}`,
      url: entry,
      status: 'UNKNOWN',
      lastChecked: null
    };
  }
  return {
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `HD ${idx + 1}`,
    url: typeof entry.url === 'string' ? entry.url.trim() : '',
    status: typeof entry.status === 'string' ? entry.status : 'UNKNOWN',
    lastChecked: entry.lastChecked || null
  };
}

function createMatchesLiveBackend(customConfig = {}) {
  const port = customConfig.port !== undefined ? customConfig.port : Number(process.env.PORT || 5000);
  const nodeEnv = customConfig.nodeEnv || process.env.NODE_ENV || 'development';
  const dbFile = customConfig.dbFile || path.join(__dirname, 'database.json');
  const adminToken =
    customConfig.adminToken !== undefined ? customConfig.adminToken : process.env.ADMIN_API_TOKEN || '';
  const allowedHosts =
    customConfig.allowedHosts || parseAllowedHosts(process.env.ALLOWED_STREAM_HOSTS, nodeEnv);
  const allowDemoFeeds =
    customConfig.allowDemoFeeds !== undefined
      ? Boolean(customConfig.allowDemoFeeds)
      : process.env.ALLOW_DEMO_FEEDS === 'true' ||
        (nodeEnv !== 'production' && process.env.ALLOW_DEMO_FEEDS !== 'false');
  const healthCheckIntervalMs =
    customConfig.healthCheckIntervalMs !== undefined
      ? customConfig.healthCheckIntervalMs
      : Number(process.env.HEALTH_CHECK_INTERVAL_MS || 60000);
  const scoreApiUrl = customConfig.cricketApiUrl || process.env.CRICKET_API_URL || '';
  const scoreApiKey = customConfig.cricketApiKey || process.env.CRICKET_API_KEY || '';
  const scoreCacheTtlMs = Number(process.env.SCORE_CACHE_TTL_MS || 15000);
  const streamFetcher = customConfig.streamFetcher || null;

  const adConfig = {
    network: 'Unity Ads',
    gameId: customConfig.unityGameId || process.env.UNITY_GAME_ID || '',
    bannerPlacementId: process.env.UNITY_BANNER_PLACEMENT || 'Banner_Android',
    interstitialPlacementId: process.env.UNITY_INTERSTITIAL_PLACEMENT || 'Interstitial_Android',
    testMode: process.env.UNITY_TEST_MODE !== 'false'
  };

  let healthCheckInFlight = null;
  let lastHealthSummary = null;
  let scoreCache = { fetchedAt: 0, byId: new Map(), error: null };

  function getEmptyDB() {
    return {
      version: '2.2.0',
      minSupportedVersion: '2.2.0',
      updateUrl: 'https://github.com/Ikram4545/Matches-Live',
      announcement: 'Welcome to Matches Live.',
      categories: [],
      matches: [],
      channels: []
    };
  }

  function readDB() {
    if (!fs.existsSync(dbFile)) {
      return getEmptyDB();
    }
    const raw = fs.readFileSync(dbFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.matches)) parsed.matches = [];
    if (!Array.isArray(parsed.channels)) parsed.channels = [];
    if (!Array.isArray(parsed.categories)) parsed.categories = [];

    parsed.matches = parsed.matches.map((m) => ({
      ...m,
      servers: Array.isArray(m.servers) ? m.servers.map(normalizeServerEntry) : []
    }));
    parsed.channels = parsed.channels.map((c) => ({
      ...c,
      servers: Array.isArray(c.servers) ? c.servers.map(normalizeServerEntry) : []
    }));
    return parsed;
  }

  function writeDBAtomic(data) {
    const tmpFile = `${dbFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, dbFile);
  }

  function verifyAdminAuth(req) {
    if (!adminToken || adminToken.length < 16) {
      return {
        ok: false,
        statusCode: 503,
        error: 'Admin API is disabled: ADMIN_API_TOKEN (min 16 chars) is not configured on the server'
      };
    }

    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Bearer ')) {
      return { ok: false, statusCode: 401, error: 'Missing Bearer authorization token' };
    }

    const provided = header.slice('Bearer '.length).trim();
    const expectedBuf = Buffer.from(adminToken, 'utf-8');
    const providedBuf = Buffer.from(provided, 'utf-8');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { ok: false, statusCode: 401, error: 'Invalid admin authorization token' };
    }

    return { ok: true };
  }

  function validateServersPayload(servers) {
    if (!Array.isArray(servers) || servers.length === 0 || servers.length > 10) {
      return { valid: false, error: 'servers must be an array of 1 to 10 stream objects' };
    }
    const normalized = [];
    for (let i = 0; i < servers.length; i++) {
      const s = servers[i];
      if (!s || typeof s !== 'object') {
        return { valid: false, error: `servers[${i}] must be an object with name and url` };
      }
      if (typeof s.name !== 'string' || s.name.trim().length === 0 || s.name.trim().length > 60) {
        return { valid: false, error: `servers[${i}].name must be a non-empty string (max 60 chars)` };
      }
      const urlCheck = validateApprovedStreamUrl(s.url, allowedHosts);
      if (!urlCheck.valid) {
        return { valid: false, error: `servers[${i}].url invalid: ${urlCheck.error}` };
      }
      normalized.push({
        name: s.name.trim(),
        url: urlCheck.normalizedUrl,
        status: 'UNKNOWN',
        lastChecked: null
      });
    }
    return { valid: true, servers: normalized };
  }

  async function fetchLiveScoresIfConfigured() {
    if (!scoreApiUrl || !scoreApiKey) {
      return { configured: false, byId: new Map(), error: null };
    }

    const now = Date.now();
    if (now - scoreCache.fetchedAt < scoreCacheTtlMs && scoreCache.byId.size > 0) {
      return { configured: true, byId: scoreCache.byId, error: scoreCache.error };
    }

    try {
      const target = new URL(scoreApiUrl);
      if (target.protocol !== 'https:') {
        return { configured: true, byId: new Map(), error: 'CRICKET_API_URL must use HTTPS' };
      }
      if (!target.searchParams.has('apikey')) {
        target.searchParams.set('apikey', scoreApiKey);
      }

      const raw = await new Promise((resolve, reject) => {
        const req = https.get(target.toString(), { timeout: 5000 }, (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return reject(new Error(`Score API HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Score API timeout'));
        });
      });

      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed.data) ? parsed.data : [];
      const map = new Map();
      for (const item of list) {
        if (!item || !item.id) continue;
        const latestInning = Array.isArray(item.score) && item.score.length > 0 ? item.score[item.score.length - 1] : null;
        map.set(String(item.id), {
          score: latestInning ? `${latestInning.r}/${latestInning.w}` : item.status || '',
          overs: latestInning ? `${latestInning.o} ov` : item.status || '',
          status: item.matchEnded ? 'RECENT' : item.matchStarted ? 'LIVE' : 'UPCOMING'
        });
      }
      scoreCache = { fetchedAt: now, byId: map, error: null };
      return { configured: true, byId: map, error: null };
    } catch (err) {
      scoreCache = { fetchedAt: now, byId: scoreCache.byId, error: err.message };
      return { configured: true, byId: scoreCache.byId, error: err.message };
    }
  }

  async function runHealthChecks() {
    if (healthCheckInFlight) {
      return healthCheckInFlight;
    }

    healthCheckInFlight = (async () => {
      const snapshot = readDB();
      const targets = [];

      for (const m of snapshot.matches) {
        if (!allowDemoFeeds && m.isDemoFeed) continue;
        for (const s of m.servers) {
          if (s.url) targets.push({ kind: 'match', parentId: m.id, url: s.url });
        }
      }
      for (const c of snapshot.channels) {
        if (!allowDemoFeeds && c.isDemoFeed) continue;
        for (const s of c.servers) {
          if (s.url) targets.push({ kind: 'channel', parentId: c.id, url: s.url });
        }
      }

      // Deduplicate probes by URL
      const uniqueUrls = [...new Set(targets.map((t) => t.url))];
      const resultsByUrl = new Map();

      await Promise.allSettled(
        uniqueUrls.map(async (targetUrl) => {
          const result = await probeHlsStream(targetUrl, allowedHosts, {
            fetcher: streamFetcher
          });
          resultsByUrl.set(targetUrl, {
            ...result,
            checkedAt: new Date().toISOString()
          });
        })
      );

      // Re-read the LATEST database right before merging so newer admin edits are NEVER overwritten
      const latestDb = readDB();
      let changed = false;
      let onlineCount = 0;
      let offlineCount = 0;

      const applyResults = (items) => {
        for (const item of items) {
          for (const srv of item.servers) {
            const probe = resultsByUrl.get(srv.url);
            if (!probe) continue;
            if (probe.status === 'ONLINE') onlineCount++;
            else offlineCount++;

            if (srv.status !== probe.status || srv.lastChecked !== probe.checkedAt) {
              srv.status = probe.status;
              srv.lastChecked = probe.checkedAt;
              changed = true;
            }
          }
        }
      };

      applyResults(latestDb.matches);
      applyResults(latestDb.channels);

      if (changed) {
        writeDBAtomic(latestDb);
      }

      lastHealthSummary = {
        checkedAt: new Date().toISOString(),
        uniqueUrlsChecked: uniqueUrls.length,
        online: onlineCount,
        offline: offlineCount
      };
      return lastHealthSummary;
    })().finally(() => {
      healthCheckInFlight = null;
    });

    return healthCheckInFlight;
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let bytes = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          req.destroy();
          const err = new Error('Payload too large');
          err.statusCode = 413;
          return reject(err);
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve(text ? JSON.parse(text) : {});
        } catch {
          const err = new Error('Invalid JSON payload');
          err.statusCode = 400;
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
  }

  const server = http.createServer(async (req, res) => {
    const corsOrigin = process.env.CORS_ALLOWED_ORIGINS || '*';
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendJson(res, 400, { success: false, error: 'Malformed request URL' });
    }
    const pathname = parsedUrl.pathname;

    try {
      // GET /api/health
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, {
          status: 'RUNNING',
          service: 'Matches Live Backend',
          version: '2.2.0',
          nodeEnv,
          allowDemoFeeds,
          adminAuthConfigured: Boolean(adminToken && adminToken.length >= 16),
          allowedStreamHostsCount: allowedHosts.length,
          liveScoresProvider: scoreApiUrl && scoreApiKey ? 'configured' : 'unconfigured',
          lastHealthCheck: lastHealthSummary
        });
      }

      // GET /api/config
      if (pathname === '/api/config' && req.method === 'GET') {
        const db = readDB();
        return sendJson(res, 200, {
          success: true,
          version: db.version,
          minSupportedVersion: db.minSupportedVersion || db.version,
          updateUrl: db.updateUrl || '',
          announcement: db.announcement || '',
          ads: adConfig
        });
      }

      // GET /api/matches
      if (pathname === '/api/matches' && req.method === 'GET') {
        const db = readDB();
        const scores = await fetchLiveScoresIfConfigured();
        const matches = db.matches
          .filter((m) => allowDemoFeeds || !m.isDemoFeed)
          .map((m) => {
            const external = m.externalScoreId ? scores.byId.get(String(m.externalScoreId)) : null;
            return {
              ...m,
              score: external ? external.score : m.score,
              overs: external ? external.overs : m.overs,
              status: external ? external.status : m.status
            };
          });

        return sendJson(res, 200, {
          success: true,
          count: matches.length,
          liveScoresProvider: scores.configured ? 'configured' : 'unconfigured',
          liveScoresError: scores.error,
          updatedAt: new Date().toISOString(),
          announcement: db.announcement || '',
          matches
        });
      }

      // GET /api/channels
      if (pathname === '/api/channels' && req.method === 'GET') {
        const db = readDB();
        const channels = db.channels.filter((c) => allowDemoFeeds || !c.isDemoFeed);
        return sendJson(res, 200, {
          success: true,
          count: channels.length,
          updatedAt: new Date().toISOString(),
          categories: db.categories,
          channels
        });
      }

      // POST /api/admin/update-match (Authenticated)
      if (pathname === '/api/admin/update-match' && req.method === 'POST') {
        const auth = verifyAdminAuth(req);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { success: false, error: auth.error });
        }

        const payload = await readJsonBody(req);
        if (typeof payload.matchId !== 'string' || payload.matchId.trim().length === 0 || payload.matchId.length > 64) {
          return sendJson(res, 400, { success: false, error: 'matchId must be a non-empty string (max 64 chars)' });
        }

        const db = readDB();
        const match = db.matches.find((m) => m.id === payload.matchId.trim());
        if (!match) {
          return sendJson(res, 404, { success: false, error: 'Match not found' });
        }

        if (payload.score !== undefined) {
          if (typeof payload.score !== 'string' || payload.score.length > 80) {
            return sendJson(res, 400, { success: false, error: 'score must be a string (max 80 chars)' });
          }
          match.score = payload.score.trim();
        }

        if (payload.overs !== undefined) {
          if (typeof payload.overs !== 'string' || payload.overs.length > 80) {
            return sendJson(res, 400, { success: false, error: 'overs must be a string (max 80 chars)' });
          }
          match.overs = payload.overs.trim();
        }

        if (payload.status !== undefined) {
          if (!ALLOWED_MATCH_STATUSES.has(payload.status)) {
            return sendJson(res, 400, {
              success: false,
              error: 'status must be one of LIVE, UPCOMING, RECENT'
            });
          }
          match.status = payload.status;
        }

        if (payload.isDemoFeed !== undefined) {
          if (typeof payload.isDemoFeed !== 'boolean') {
            return sendJson(res, 400, { success: false, error: 'isDemoFeed must be a boolean' });
          }
          match.isDemoFeed = payload.isDemoFeed;
        }

        if (payload.announcement !== undefined) {
          if (typeof payload.announcement !== 'string' || payload.announcement.length > 300) {
            return sendJson(res, 400, { success: false, error: 'announcement must be a string (max 300 chars)' });
          }
          db.announcement = payload.announcement.trim();
        }

        if (payload.servers !== undefined) {
          const check = validateServersPayload(payload.servers);
          if (!check.valid) {
            return sendJson(res, 400, { success: false, error: check.error });
          }
          match.servers = check.servers;
        }

        match.updatedAt = new Date().toISOString();
        writeDBAtomic(db);

        return sendJson(res, 200, {
          success: true,
          message: 'Match updated safely',
          match
        });
      }

      // POST /api/admin/update-channel (Authenticated)
      if (pathname === '/api/admin/update-channel' && req.method === 'POST') {
        const auth = verifyAdminAuth(req);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { success: false, error: auth.error });
        }

        const payload = await readJsonBody(req);
        if (typeof payload.channelId !== 'string' || payload.channelId.trim().length === 0) {
          return sendJson(res, 400, { success: false, error: 'channelId must be a non-empty string' });
        }

        const db = readDB();
        const channel = db.channels.find((c) => c.id === payload.channelId.trim());
        if (!channel) {
          return sendJson(res, 404, { success: false, error: 'Channel not found' });
        }

        if (payload.name !== undefined) {
          if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 80) {
            return sendJson(res, 400, { success: false, error: 'name must be a non-empty string (max 80 chars)' });
          }
          channel.name = payload.name.trim();
        }

        if (payload.isDemoFeed !== undefined) {
          if (typeof payload.isDemoFeed !== 'boolean') {
            return sendJson(res, 400, { success: false, error: 'isDemoFeed must be a boolean' });
          }
          channel.isDemoFeed = payload.isDemoFeed;
        }

        if (payload.servers !== undefined) {
          const check = validateServersPayload(payload.servers);
          if (!check.valid) {
            return sendJson(res, 400, { success: false, error: check.error });
          }
          channel.servers = check.servers;
        }

        channel.updatedAt = new Date().toISOString();
        writeDBAtomic(db);

        return sendJson(res, 200, {
          success: true,
          message: 'Channel updated safely',
          channel
        });
      }

      // POST /api/admin/run-health-check (Authenticated)
      if (pathname === '/api/admin/run-health-check' && req.method === 'POST') {
        const auth = verifyAdminAuth(req);
        if (!auth.ok) {
          return sendJson(res, auth.statusCode, { success: false, error: auth.error });
        }
        const summary = await runHealthChecks();
        return sendJson(res, 200, { success: true, summary });
      }

      return sendJson(res, 404, { success: false, error: 'Endpoint not found' });
    } catch (err) {
      const code = err.statusCode || 500;
      return sendJson(res, code, { success: false, error: err.message || 'Internal server error' });
    }
  });

  let timer = null;
  function start() {
    return new Promise((resolve) => {
      server.listen(port, '0.0.0.0', () => {
        const actualPort = server.address().port;
        console.log(`[Matches Live Backend] v2.2.0 running on http://0.0.0.0:${actualPort} (env=${nodeEnv})`);
        if (healthCheckIntervalMs > 0) {
          runHealthChecks().catch((e) => console.error('[HealthCheck] Initial run failed:', e.message));
          timer = setInterval(() => {
            runHealthChecks().catch((e) => console.error('[HealthCheck] Periodic run failed:', e.message));
          }, healthCheckIntervalMs);
        }
        resolve(actualPort);
      });
    });
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return new Promise((resolve) => server.close(resolve));
  }

  return {
    server,
    start,
    stop,
    runHealthChecks,
    readDB
  };
}

if (require.main === module) {
  const app = createMatchesLiveBackend();
  app.start();
}

module.exports = {
  createMatchesLiveBackend,
  validateApprovedStreamUrl,
  isValidHlsPlaylist,
  probeHlsStream,
  parseAllowedHosts
};

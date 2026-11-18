const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createMatchesLiveBackend,
  validateApprovedStreamUrl,
  isValidHlsPlaylist
} = require('./server');

function requestJson(port, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve({
            statusCode: res.statusCode,
            body: text ? JSON.parse(text) : {}
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('Running Matches Live Backend Tests...\n');

  // 1. Unit tests: URL validation & SSRF protection
  const allowed = ['cdn.authorized.example', 'streams.mux.dev'];
  assert.strictEqual(validateApprovedStreamUrl('http://cdn.authorized.example/live.m3u8', allowed).valid, false, 'Must reject HTTP');
  assert.strictEqual(validateApprovedStreamUrl('https://127.0.0.1/live.m3u8', allowed).valid, false, 'Must reject loopback IP');
  assert.strictEqual(validateApprovedStreamUrl('https://localhost/live.m3u8', allowed).valid, false, 'Must reject localhost');
  assert.strictEqual(validateApprovedStreamUrl('https://169.254.169.254/latest/meta-data', allowed).valid, false, 'Must reject metadata IP');
  assert.strictEqual(validateApprovedStreamUrl('https://evil.attacker.com/live.m3u8', allowed).valid, false, 'Must reject unapproved host');
  assert.strictEqual(validateApprovedStreamUrl('https://user:pass@cdn.authorized.example/live.m3u8', allowed).valid, false, 'Must reject URL credentials');
  assert.strictEqual(validateApprovedStreamUrl('https://cdn.authorized.example/live/master.m3u8', allowed).valid, true, 'Must accept approved HTTPS URL');
  console.log('[PASS] URL allowlist & SSRF validation');

  // 2. Unit tests: HLS playlist validator
  assert.strictEqual(isValidHlsPlaylist('<!DOCTYPE html><html><body>200 OK Error</body></html>'), false, 'Must reject HTML 200 page');
  assert.strictEqual(isValidHlsPlaylist('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p.m3u8'), true, 'Must accept valid master playlist');
  assert.strictEqual(isValidHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg01.ts'), true, 'Must accept valid media playlist');
  console.log('[PASS] HLS playlist content validation');

  // 3. Integration tests with temp DB & deterministic mock fetcher
  const tmpDb = path.join(os.tmpdir(), `matches-live-test-${Date.now()}.json`);
  const seedDb = {
    version: '2.2.0',
    announcement: 'Initial Announcement',
    categories: [{ id: 'sports', name: 'SPORTS', desc: 'Live', icon: 'fa-tv' }],
    matches: [
      {
        id: 'm1',
        tournament: 'Authorized Cup',
        category: 'cricket',
        team1: { name: 'Pakistan', flag: '🇵🇰' },
        team2: { name: 'Australia', flag: '🇦🇺' },
        status: 'LIVE',
        score: '100/2',
        overs: '15.0 ov',
        isDemoFeed: false,
        servers: [
          { name: 'HD 1', url: 'https://cdn.authorized.example/good.m3u8', status: 'UNKNOWN' },
          { name: 'HD 2', url: 'https://cdn.authorized.example/html-error.m3u8', status: 'UNKNOWN' }
        ]
      },
      {
        id: 'm_demo',
        tournament: 'Demo Match',
        category: 'cricket',
        team1: { name: 'Demo A', flag: '🏏' },
        team2: { name: 'Demo B', flag: '🏏' },
        status: 'LIVE',
        score: '0/0',
        overs: '0.0',
        isDemoFeed: true,
        servers: [{ name: 'Demo', url: 'https://streams.mux.dev/demo.m3u8', status: 'UNKNOWN' }]
      }
    ],
    channels: [
      {
        id: 'c1',
        name: 'Official Sports',
        category: 'sports',
        code: 'OS',
        color: '#10b981',
        isDemoFeed: false,
        servers: [{ name: 'Primary', url: 'https://cdn.authorized.example/good.m3u8', status: 'UNKNOWN' }]
      }
    ]
  };
  fs.writeFileSync(tmpDb, JSON.stringify(seedDb, null, 2), 'utf-8');

  const ADMIN_SECRET = 'test-super-secret-admin-token-9999';

  // Mock async fetcher with delay so we can test concurrent admin edit preservation!
  const mockFetcher = async (targetUrl) => {
    await new Promise((r) => setTimeout(r, 150));
    if (targetUrl.includes('good.m3u8')) {
      return { statusCode: 200, body: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\n720p.m3u8' };
    }
    if (targetUrl.includes('html-error.m3u8')) {
      return { statusCode: 200, body: '<!DOCTYPE html><html><body>Stream unavailable</body></html>' };
    }
    return { statusCode: 404, body: 'Not Found' };
  };

  const backend = createMatchesLiveBackend({
    port: 0,
    nodeEnv: 'production',
    dbFile: tmpDb,
    adminToken: ADMIN_SECRET,
    allowedHosts: allowed,
    allowDemoFeeds: false,
    healthCheckIntervalMs: 0,
    streamFetcher: mockFetcher
  });

  const port = await backend.start();
  try {
    // Test 3a: Production mode filters out demo feeds
    const mRes = await requestJson(port, 'GET', '/api/matches');
    assert.strictEqual(mRes.statusCode, 200);
    assert.strictEqual(mRes.body.count, 1, 'Demo match must be excluded in production mode');
    assert.strictEqual(mRes.body.matches[0].id, 'm1');
    console.log('[PASS] GET /api/matches filters out demo feeds in production mode');

    // Test 3b: Unauthenticated admin update rejected with 401
    const unauth = await requestJson(port, 'POST', '/api/admin/update-match', { matchId: 'm1', score: 'HACKED' });
    assert.strictEqual(unauth.statusCode, 401, 'Unauthenticated admin request must return 401');
    console.log('[PASS] Unauthenticated POST /api/admin/update-match rejected (401)');

    // Test 3c: Wrong token rejected with 401
    const wrongTok = await requestJson(
      port,
      'POST',
      '/api/admin/update-match',
      { matchId: 'm1', score: 'HACKED' },
      { Authorization: 'Bearer wrong-token-value' }
    );
    assert.strictEqual(wrongTok.statusCode, 401, 'Invalid token must return 401');
    console.log('[PASS] Invalid Bearer token rejected (401)');

    // Test 3d: Authenticated update with unapproved/HTTP URL rejected with 400
    const badUrl = await requestJson(
      port,
      'POST',
      '/api/admin/update-match',
      {
        matchId: 'm1',
        servers: [{ name: 'Bad', url: 'http://cdn.authorized.example/insecure.m3u8' }]
      },
      { Authorization: `Bearer ${ADMIN_SECRET}` }
    );
    assert.strictEqual(badUrl.statusCode, 400, 'HTTP stream URL must be rejected with 400');
    console.log('[PASS] Non-HTTPS / unapproved URL rejected on admin update (400)');

    // Test 3e: Async health check waits for completion & preserves concurrent admin edits!
    const hcPromise = backend.runHealthChecks();

    // While health check is in-flight (150ms), perform a concurrent admin edit!
    await new Promise((r) => setTimeout(r, 40));
    const concurrentEdit = await requestJson(
      port,
      'POST',
      '/api/admin/update-match',
      { matchId: 'm1', score: '145/2', overs: '19.3 ov' },
      { Authorization: `Bearer ${ADMIN_SECRET}` }
    );
    assert.strictEqual(concurrentEdit.statusCode, 200);

    // Wait for health check to finish persisting
    const summary = await hcPromise;
    assert.strictEqual(summary.online, 2, 'Good HLS stream on match + channel should be ONLINE');
    assert.strictEqual(summary.offline, 1, 'HTML 200 error page must be marked OFFLINE');

    const after = await requestJson(port, 'GET', '/api/matches');
    const m1 = after.body.matches[0];
    assert.strictEqual(m1.score, '145/2', 'Health check MUST NOT overwrite newer concurrent admin edit!');
    assert.strictEqual(m1.overs, '19.3 ov', 'Health check MUST NOT overwrite newer overs edit!');
    assert.strictEqual(m1.servers[0].status, 'ONLINE', 'Valid HLS playlist marked ONLINE');
    assert.strictEqual(m1.servers[1].status, 'OFFLINE', '200 HTML page marked OFFLINE');
    console.log('[PASS] Async health check awaits probes, verifies #EXTM3U, and preserves concurrent admin edits');
  } finally {
    await backend.stop();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }

  console.log('\nALL BACKEND TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});

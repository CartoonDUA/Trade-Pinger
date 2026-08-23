const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { discordPayloads, safePostLink, sendDiscord } = require('../discord-alert');
const { TelegramListener, normalizeTelegramSource, messageTime } = require('../telegram-listener');
const { XMonitor, normalizeXSource } = require('../x-monitor');
const { DriveMonitor, normalizeDriveFolder } = require('../drive-monitor');
const { driveDiscordPayload, sendDriveDiscord } = require('../drive-discord');

test('X source normalization accepts handles and official profile URLs', () => {
  assert.equal(normalizeXSource('@jdncrtr'), '@jdncrtr');
  assert.equal(normalizeXSource('https://x.com/slace98'), '@slace98');
  assert.throws(() => normalizeXSource('https://example.com/jdncrtr'));
});

test('X monitor establishes a no-alert baseline then routes new posts once', async () => {
  const posts = [];
  const responses = [
    { data: { id: '42' } },
    { data: [{ id: '100', text: 'baseline', created_at: '2026-08-23T10:00:00.000Z' }] },
    { data: [{ id: '101', text: 'new post', created_at: '2026-08-23T10:05:00.000Z' }] },
    { data: [{ id: '101', text: 'duplicate event', created_at: '2026-08-23T10:05:00.000Z' }] }
  ];
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.match(options.headers.Authorization, /^Bearer /);
    return { ok: true, json: async () => responses.shift() };
  };
  const seen = new Set();
  const monitor = new XMonitor({
    fetcher,
    onState() {},
    onPost(post) {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      posts.push(post);
      return true;
    }
  });
  monitor.token = 'test-token-not-real';
  monitor.handles = ['@jdncrtr'];
  monitor.running = true;
  await monitor.poll();
  assert.equal(posts.length, 0);
  await monitor.poll();
  assert.deepEqual(posts.map(post => post.id), ['X:101']);
  assert.equal(posts[0].network, 'X');
  assert.equal(posts[0].link, 'https://x.com/jdncrtr/status/101');
  await monitor.poll();
  assert.equal(posts.length, 1);
  assert.match(urls[2], /since_id=100/);
  monitor.stop();
});

test('X uses the generic alert pipeline and write-only desktop setup', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const client = fs.readFileSync('public/app.js', 'utf8');
  const setup = fs.readFileSync('public/index.html', 'utf8');
  assert.match(server, /const xMonitor = new XMonitor\(\{\s*onPost: addPost/);
  assert.match(server, /xSources: config\.xSources, xEnabled: config\.xEnabled/);
  assert.match(client, /xBearerToken.*type="password"|secretFields = \[[^\]]*'xBearerToken'/s);
  assert.match(setup, /id="xBearerToken" type="password"/);
  assert.match(setup, /fa-x-twitter/);
  assert.doesNotMatch(`${server}\n${client}\n${setup}`, /nitter|syndication|X_BEARER_TOKEN|X_STREAM_ENABLED/i);
});

test('Google Drive folder normalization accepts the supplied URL and ID', () => {
  const id = '1BW5jENBH6nQsbcPP7L7x31VtffTc2aJH';
  assert.equal(normalizeDriveFolder(id), id);
  assert.equal(normalizeDriveFolder(`https://drive.google.com/drive/folders/${id}`), id);
  assert.throws(() => normalizeDriveFolder('https://example.com/folder'));
});

test('Google Drive monitor baselines history and routes each new file once', async () => {
  const oldFile = { id: 'old', name: 'Existing.pdf', mimeType: 'application/pdf', createdTime: '2026-08-23T10:00:00.000Z', modifiedTime: '2026-08-23T10:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/old/view' };
  const newFile = { id: 'new', name: 'New folder', mimeType: 'application/vnd.google-apps.folder', createdTime: '2026-08-23T10:01:00.000Z', modifiedTime: '2026-08-23T10:01:00.000Z', webViewLink: 'https://drive.google.com/drive/folders/new' };
  const replies = [[oldFile], [newFile, oldFile], [newFile, oldFile]];
  const posts = [];
  const monitor = new DriveMonitor({
    onFile: post => posts.push(post), onState() {}, onCredentials() {},
    fetcher: async (url, options) => {
      assert.match(url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/);
      assert.equal(options.headers.Authorization, 'Bearer mock-access');
      return { ok: true, json: async () => ({ files: replies.shift() }) };
    }
  });
  Object.assign(monitor, { running: true, folderId: 'folder-id-123', accessToken: 'mock-access', expiresAt: Date.now() + 3600000 });
  await monitor.poll();
  assert.equal(posts.length, 0);
  await monitor.poll();
  await monitor.poll();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'Drive:new');
  assert.equal(posts[0].network, 'Google Drive');
  assert.match(posts[0].text, /New folder/);
  monitor.stop();
});

test('Google Drive listing follows official pagination', async () => {
  const urls = [];
  const pages = [{ files: [{ id: 'one' }], nextPageToken: 'next-page' }, { files: [{ id: 'two' }] }];
  const monitor = new DriveMonitor({ onFile() {}, onState() {}, onCredentials() {}, fetcher: async url => {
    urls.push(url);
    return { ok: true, json: async () => pages.shift() };
  } });
  Object.assign(monitor, { folderId: 'folder-id-123', accessToken: 'mock-access', expiresAt: Date.now() + 3600000 });
  assert.deepEqual((await monitor.listFiles()).map(file => file.id), ['one', 'two']);
  assert.doesNotMatch(urls[0], /pageToken=/);
  assert.match(urls[1], /pageToken=next-page/);
});

test('Google Drive Discord payload is rich, scoped, and mocked', async () => {
  const post = { createdAt: '2026-08-23T10:01:00.000Z', link: 'https://drive.google.com/file/d/new/view', drive: { name: 'Report.pdf', mimeType: 'application/pdf', folderId: 'folder-id-123', modifiedTime: '2026-08-23T10:02:00.000Z' } };
  const payload = driveDiscordPayload(post);
  assert.equal(payload.content, '@everyone');
  assert.deepEqual(payload.allowed_mentions, { parse: ['everyone'] });
  assert.equal(payload.embeds[0].title, 'New Google Drive file');
  assert.equal(payload.embeds[0].url, post.link);
  assert.deepEqual(payload.embeds[0].fields.map(field => field.name), ['Name', 'Type', 'Folder ID', 'Created', 'Modified']);
  let sent;
  await sendDriveDiscord('https://local.invalid/drive-webhook', post, async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, status: 204 };
  });
  assert.equal(sent.url, 'https://local.invalid/drive-webhook');
  assert.equal(sent.body.embeds[0].fields[0].value, 'Report.pdf');
});

test('Telegram source normalization accepts every supported form', () => {
  const values = new Map([
    ['@cyberleekario', '@cyberleekario'],
    ['https://t.me/cyberleekario/42', '@cyberleekario'],
    ['https://web.telegram.org/k/#@cyberleekario', '@cyberleekario'],
    ['https://web.telegram.org/k/#-4391365124', '-4391365124']
  ]);
  for (const [input, expected] of values) assert.equal(normalizeTelegramSource(input), expected);
  assert.throws(() => normalizeTelegramSource('https://example.com/channel'));
});

test('multi-source listener registers live handlers without fetching history', async () => {
  const listener = new TelegramListener({ sessionFile: 'unused', onPost() {}, onState() {}, onSourceErrors() {} });
  const handlers = [];
  listener.client = {
    addEventHandler(handler) { handlers.push(handler); },
    getMessages() { throw new Error('Historical messages must not be fetched.'); }
  };
  listener.resolveSource = async value => ({ input: value, label: value, username: value.slice(1), entity: {}, peerId: value });
  await listener.listen(['@firstsource', '@secondsource']);
  assert.equal(handlers.length, 1);
});

test('listener ignores messages dated before listening starts', async () => {
  const posts = [];
  const diagnostics = [];
  const listener = new TelegramListener({ sessionFile: 'unused', onPost: post => posts.push(post), onState() {}, onSourceErrors() {}, onDiagnostics: value => diagnostics.push(value.map(item => ({ ...item }))) });
  listener.sources = [{ input: '-4391365124', label: 'Numeric source', username: null, entity: {}, peerId: '-1004391365124' }];
  listener.diagnostics = [{ source: '-4391365124', registered: true, received: 0, accepted: 0, beforeStart: 0, lastReceivedAt: null, lastAcceptedAt: null }];
  listener.startedAt = Date.now();
  await listener.routeMessage({ chatId: { toString: () => '-1004391365124' }, message: { id: 1, date: Math.floor(Date.now() / 1000) - 30, message: 'old', media: null } });
  assert.equal(posts.length, 0);
  assert.equal(diagnostics.at(-1)[0].beforeStart, 1);
  assert.ok(messageTime({ date: Math.floor(Date.now() / 1000) }) > 0);
});

test('canonical routing sends username and numeric events once to feed and Discord', async () => {
  const feed = [];
  const discord = [];
  const seen = new Set();
  const diagnostics = [];
  const listener = new TelegramListener({
    sessionFile: 'unused', onState() {}, onSourceErrors() {},
    onDiagnostics: value => diagnostics.push(value.map(item => ({ ...item }))),
    onPost: async post => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      feed.push(post);
      discord.push(discordPayloads(post));
      return true;
    }
  });
  listener.client = { addEventHandler(handler) { this.handler = handler; } };
  listener.resolveSource = async value => value.startsWith('@')
    ? { input: value, label: value, username: value.slice(1), entity: {}, peerId: '-100111' }
    : { input: value, label: 'Numeric source', username: null, entity: {}, peerId: '-1004391365124' };
  await listener.listen(['@firstsource', '-4391365124']);
  listener.startedAt = Date.now() - 5000;
  const message = (id, text) => ({ id, date: Math.floor(Date.now() / 1000), message: text, media: null });
  await listener.client.handler({ chatId: { toString: () => '-100111' }, message: message(1, 'username post') });
  await listener.client.handler({ chatId: { toString: () => '-1004391365124' }, message: message(2, 'numeric post') });
  await listener.client.handler({ chatId: { toString: () => '-1004391365124' }, message: message(2, 'numeric duplicate') });
  assert.deepEqual(feed.map(post => post.source), ['@firstsource', 'Numeric source']);
  assert.equal(discord.length, 2);
  assert.equal(discord[1][0].content, '@everyone');
  assert.equal(discord[1][0].embeds[0].description, 'numeric post');
  const latest = diagnostics.at(-1);
  assert.deepEqual(latest.map(item => [item.received, item.accepted]), [[1, 1], [2, 1]]);
});

test('Discord rich embed pings everyone with safe post context', () => {
  const post = { source: '@source', createdAt: '2026-08-22T12:00:00.000Z', text: 'complete post text', link: 'https://t.me/source/7', media: { attached: true } };
  const payload = discordPayloads(post)[0];
  assert.equal(payload.content, '@everyone');
  assert.deepEqual(payload.allowed_mentions, { parse: ['everyone'] });
  assert.equal(payload.embeds[0].title, 'New Telegram post · @source');
  assert.equal(payload.embeds[0].description, 'complete post text');
  assert.equal(payload.embeds[0].timestamp, '2026-08-22T12:00:00.000Z');
  assert.equal(payload.embeds[0].url, 'https://t.me/source/7');
  assert.deepEqual(payload.embeds[0].fields.map(field => field.name), ['Source', 'Provider', 'Media']);
  assert.match(payload.embeds[0].fields[2].value, /attached/i);
});

test('Discord embeds preserve long text and reject unsafe links', () => {
  const text = 'x'.repeat(9001);
  const payloads = discordPayloads({ source: 'Private source', createdAt: 'invalid', text, link: 'https://example.com/not-telegram', media: { tooLarge: true } });
  assert.equal(payloads.length, 3);
  assert.equal(payloads.map(payload => payload.embeds[0].description).join(''), text);
  assert.equal(payloads[0].content, '@everyone');
  assert.equal(payloads[1].content, undefined);
  assert.equal(payloads[0].embeds[0].url, undefined);
  assert.equal(payloads[0].embeds[0].timestamp, undefined);
  assert.match(payloads[0].embeds[0].fields[2].value, /8 MB/);
  assert.equal(safePostLink('https://t.me/source/7'), 'https://t.me/source/7');
  assert.equal(safePostLink('https://x.com/jdncrtr/status/7'), 'https://x.com/jdncrtr/status/7');
  assert.equal(safePostLink('https://t.me/+private/7'), null);
});

test('Discord sender posts rich embeds without using a real webhook', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, payload: JSON.parse(options.body) });
    return { ok: true, status: 204 };
  };
  await sendDiscord('https://local.invalid/webhook', {
    source: '@source',
    createdAt: '2026-08-22T12:00:00.000Z',
    text: 'new post',
    link: 'https://t.me/source/8'
  }, null, fetcher);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://local.invalid/webhook');
  assert.equal(requests[0].payload.content, '@everyone');
  assert.equal(requests[0].payload.embeds[0].description, 'new post');
});

test('local secrets, X token, and Telegram session are never returned by public config', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const secrets = fs.readFileSync('local-secrets.js', 'utf8');
  const publicConfig = server.match(/function publicConfig\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(publicConfig, /telegramApiHash:\s*config|xBearerToken:\s*config|driveClientId:\s*config|driveClientSecret:\s*config|driveAccessToken:\s*config|driveRefreshToken:\s*config|driveDiscordWebhookUrl:\s*config|discordWebhookUrl:\s*config|telegram\.session/);
  assert.match(server, /xBearerToken: config\.xBearerToken/);
  assert.match(server, /driveRefreshToken: config\.driveRefreshToken/);
  assert.match(server, /post\.network === 'Google Drive'[\s\S]*sendDriveDiscord\(config\.driveDiscordWebhookUrl/);
  assert.match(server, /post\.network === 'Google Drive'\s*\? \[sendDriveDiscord\(config\.driveDiscordWebhookUrl, post\)\]\s*:\s*\[sendSms\(post\), sendDiscord\(config\.discordWebhookUrl/);
  assert.match(server, /dataDir, 'telegram\.session'/);
  assert.match(server, /desktopNotifications: config\.desktopNotifications, notificationSound: config\.notificationSound/);
  assert.match(secrets, /safeStorage\.encryptString/);
  assert.match(secrets, /safeStorage\.decryptString/);
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /^data\/$/m);
});

test('wallet code signs text and never submits a transaction', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  assert.match(source, /signMessage/);
  assert.doesNotMatch(source, /sendTransaction|signAndSendTransaction|sendRawTransaction/);
});

test('desktop keeps its secure preload boundary and persisted themes', () => {
  const desktop = fs.readFileSync('electron.js', 'utf8');
  const client = fs.readFileSync('public/app.js', 'utf8');
  assert.match(desktop, /contextIsolation: true/);
  assert.match(desktop, /nodeIntegration: false/);
  assert.match(client, /localStorage\.setItem\('tradePingerTheme'/);
});

test('new-post desktop alerts are guarded by deduplication and listener cutoff', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const listener = fs.readFileSync('telegram-listener.js', 'utf8');
  const addPost = server.match(/async function addPost[\s\S]*?\n\}/)[0];
  assert.ok(addPost.indexOf('state.seen.includes(post.id)') < addPost.indexOf('tradePingerDesktopAlert'));
  assert.match(listener, /if \(messageTime\(message\) < this\.startedAt\) return/);
});

test('Electron alert uses a safe preview, optional sound, and click-to-focus', () => {
  const desktop = fs.readFileSync('electron.js', 'utf8');
  assert.match(desktop, /Notification\.isSupported\(\)/);
  assert.match(desktop, /slice\(0, 140\)/);
  assert.match(desktop, /if \(settings\.sound\) shell\.beep\(\)/);
  assert.match(desktop, /notification\.on\('click'/);
  assert.match(desktop, /window\.focus\(\)/);
});

test('CYBERLEEK uses factual DEX fields and neutral risk language', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const client = fs.readFileSync('public/app.js', 'utf8');
  const setup = fs.readFileSync('public/index.html', 'utf8');
  assert.match(setup, /ApZuxdpzMrbEYTGEzeY9afh5pj9d6qPRJCTgQYiipbKg/);
  for (const field of ['change5m', 'change1h', 'change6h', 'change24h', 'volume24h', 'liquidityUsd', 'marketCap', 'fdv', 'pairCreatedAt', 'dex', 'updatedAt']) {
    assert.match(`${server}\n${client}`, new RegExp(field));
  }
  assert.match(server, /api\.dexscreener\.com/);
  assert.match(setup, /not financial advice/i);
  assert.doesNotMatch(`${server}\n${client}\n${setup}`, /should (buy|sell)|recommended position|increase profit|AI prediction/i);
});

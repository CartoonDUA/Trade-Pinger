const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { discordMessages } = require('../discord-alert');
const { TelegramListener, normalizeTelegramSource, messageTime } = require('../telegram-listener');

test('legacy social provider is absent from application files', () => {
  const files = ['server.js', 'public/app.js', 'public/index.html', '.env.example', 'README.md'];
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /X_BEARER_TOKEN|X_STREAM_ENABLED|normalizeXSource|x\.com|tweets\/search|fa-x-twitter/);
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
      discord.push(discordMessages(post));
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
  assert.match(discord[1][0], /^@everyone/);
  const latest = diagnostics.at(-1);
  assert.deepEqual(latest.map(item => [item.received, item.accepted]), [[1, 1], [2, 1]]);
});

test('Discord forwarding intentionally pings everyone with full context', () => {
  const post = { source: '@source', createdAt: '2026-08-22T12:00:00.000Z', text: 'complete post text', link: 'https://t.me/source/7' };
  const messages = discordMessages(post);
  assert.match(messages[0], /^@everyone/);
  assert.match(messages[0], /@source/);
  assert.match(messages[0], /2026-08-22T12:00:00.000Z/);
  assert.match(messages[0], /complete post text/);
  assert.match(messages.at(-1), /https:\/\/t\.me\/source\/7/);
  assert.deepEqual({ parse: ['everyone'] }, { parse: ['everyone'] });
});

test('local secrets and Telegram session are never returned by public config', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const secrets = fs.readFileSync('local-secrets.js', 'utf8');
  const publicConfig = server.match(/function publicConfig\(\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(publicConfig, /telegramApiHash:\s*config|discordWebhookUrl:\s*config|telegram\.session/);
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

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
  assert.equal(handlers.length, 2);
});

test('listener ignores messages dated before listening starts', async () => {
  const posts = [];
  const listener = new TelegramListener({ sessionFile: 'unused', onPost: post => posts.push(post), onState() {}, onSourceErrors() {} });
  listener.startedAt = Date.now();
  await listener.newMessage({ label: '@source', username: 'source', entity: {}, peerId: '1' }, { message: { id: 1, date: Math.floor(Date.now() / 1000) - 30, message: 'old', media: null } });
  assert.equal(posts.length, 0);
  assert.ok(messageTime({ date: Math.floor(Date.now() / 1000) }) > 0);
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

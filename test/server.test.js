const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('wallet code signs a message and never submits a transaction', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  assert.match(source, /signMessage/);
  assert.doesNotMatch(source, /sendTransaction|signAndSendTransaction|sendRawTransaction/);
});

test('desktop uses a secure preload boundary', () => {
  const desktop = fs.readFileSync('electron.js', 'utf8');
  assert.match(desktop, /contextIsolation: true/);
  assert.match(desktop, /nodeIntegration: false/);
});

test('live provider updates use streaming responses', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /text\/event-stream/);
  assert.match(server, /tweets\/search\/stream/);
  assert.match(server, /timeout=25/);
});

test('desktop setup persists locally without returning secret contents', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /dataDir, 'config\.json'/);
  assert.match(server, /configured:\s*\{/);
  assert.match(server, /app\.get\('\/api\/config'.*publicConfig/s);
  assert.match(server, /app\.post\('\/api\/config'/);
});

test('source management accepts only supported public source formats', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /normalizeXSource/);
  assert.match(server, /normalizeTelegramSource/);
  assert.match(server, /Unsupported X source/);
  assert.match(server, /Unsupported Telegram public source/);
});

test('Discord webhook stays write-only and sends complete post context', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /discordWebhookUrl: Boolean\(config\.discordWebhookUrl\)/);
  assert.match(server, /clearDiscordWebhook/);
  assert.match(server, /allowed_mentions: \{ parse: \[\] \}/);
  assert.match(server, /post\.source/);
  assert.match(server, /post\.createdAt/);
  assert.match(server, /post\.link/);
});

test('market watchlist uses read-only DEX data and neutral risk flags', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const client = fs.readFileSync('public/app.js', 'utf8');
  assert.match(server, /api\.dexscreener\.com/);
  assert.match(server, /coinWatchlist/);
  assert.match(client, /Informational only—not a recommendation or personalized advice/);
  assert.doesNotMatch(client, /should (buy|sell|trade)|position size/i);
});

test('server does not reference recovery phrases or private keys', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.doesNotMatch(source, /private.?key|recovery.?phrase|seed.?phrase/i);
});

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const twilio = require('twilio');
const { TelegramListener, normalizeTelegramSource } = require('./telegram-listener');
const { XMonitor, normalizeXSource } = require('./x-monitor');
const { sendDiscord } = require('./discord-alert');
const LocalSecrets = require('./local-secrets');

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDir = path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');
const configFile = path.join(dataDir, 'config.json');
const sessionFile = path.join(dataDir, 'telegram.session');
const secretStore = new LocalSecrets(path.join(dataDir, 'secrets.json'));
const eventClients = new Set();

function splitSources(value) {
  return String(value || '').split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
}

function normalizeCoin(value) {
  const coin = value.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin)) return coin;
  if (/^[A-Za-z][A-Za-z0-9]{1,14}$/.test(coin)) return coin.toUpperCase();
  throw new Error(`Unsupported coin symbol or Solana token address: ${value}`);
}

const saved = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const localSecrets = secretStore.load();
const migratedSources = saved.telegramSources || splitSources(process.env.TELEGRAM_SOURCES);
let config = {
  telegramApiId: saved.telegramApiId || process.env.TELEGRAM_API_ID || '',
  telegramApiHash: localSecrets.telegramApiHash || saved.telegramApiHash || process.env.TELEGRAM_API_HASH || '',
  telegramSources: migratedSources.map(normalizeTelegramSource),
  xBearerToken: localSecrets.xBearerToken || '',
  xSources: (saved.xSources || ['@jdncrtr', '@slace98']).map(normalizeXSource),
  xEnabled: saved.xEnabled === true,
  discordWebhookUrl: localSecrets.discordWebhookUrl || saved.discordWebhookUrl || '',
  twilioAccountSid: localSecrets.twilioAccountSid || saved.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: localSecrets.twilioAuthToken || saved.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: localSecrets.twilioFromNumber || saved.twilioFromNumber || process.env.TWILIO_FROM_NUMBER || '',
  smsToNumber: localSecrets.smsToNumber || saved.smsToNumber || process.env.SMS_TO_NUMBER || '',
  coinWatchlist: saved.coinWatchlist || [],
  desktopNotifications: saved.desktopNotifications !== false,
  notificationSound: saved.notificationSound !== false
};
let state = {
  seen: [], posts: [], lastAlert: null, errors: [], sourceErrors: [], listenerDiagnostics: [],
  telegram: { connected: false, authorized: false, authorizing: false, lastSuccess: null, message: 'Waiting for setup.' },
  x: { connected: false, checking: false, lastSuccess: null, error: null, message: 'Official X monitoring is stopped.' }
};
if (fs.existsSync(stateFile)) {
  const previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.seen = previous.seen || [];
  state.posts = (previous.posts || []).filter(post => ['Telegram', 'X'].includes(post.network));
  state.lastAlert = previous.lastAlert || null;
}
let marketSnapshots = [];
let qrState = { dataUrl: null, expires: null };
let authPromise = null;

function saveJson(file, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function saveConfig() {
  saveJson(configFile, {
    telegramApiId: config.telegramApiId, telegramSources: config.telegramSources, xSources: config.xSources, xEnabled: config.xEnabled, coinWatchlist: config.coinWatchlist,
    desktopNotifications: config.desktopNotifications, notificationSound: config.notificationSound
  });
  secretStore.save({
    telegramApiHash: config.telegramApiHash, xBearerToken: config.xBearerToken, discordWebhookUrl: config.discordWebhookUrl,
    twilioAccountSid: config.twilioAccountSid, twilioAuthToken: config.twilioAuthToken,
    twilioFromNumber: config.twilioFromNumber, smsToNumber: config.smsToNumber
  });
}

function configured() {
  return {
    telegram: Boolean(config.telegramApiId && config.telegramApiHash),
    telegramApiId: Boolean(config.telegramApiId),
    telegramApiHash: Boolean(config.telegramApiHash),
    telegramSession: fs.existsSync(sessionFile),
    x: Boolean(config.xBearerToken),
    xBearerToken: Boolean(config.xBearerToken),
    discord: Boolean(config.discordWebhookUrl),
    discordWebhookUrl: Boolean(config.discordWebhookUrl),
    twilio: Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber && config.smsToNumber),
    twilioAccountSid: Boolean(config.twilioAccountSid),
    twilioAuthToken: Boolean(config.twilioAuthToken),
    twilioFromNumber: Boolean(config.twilioFromNumber),
    smsToNumber: Boolean(config.smsToNumber)
  };
}

function publicConfig() {
  return {
    telegramApiId: config.telegramApiId, telegramSources: config.telegramSources, xSources: config.xSources, xEnabled: config.xEnabled, coinWatchlist: config.coinWatchlist,
    desktopNotifications: config.desktopNotifications, notificationSound: config.notificationSound, configured: configured()
  };
}

function statusPayload() {
  return {
    sources: config.telegramSources.map(source => {
      const error = state.sourceErrors.find(item => item.source === source);
      const diagnostic = state.listenerDiagnostics.find(item => item.source === source);
      return { network: 'Telegram', source, label: source, configured: configured().telegramSession, error: error?.message || null, diagnostic: diagnostic || null };
    }).concat(config.xSources.map(source => ({ network: 'X', source, label: source, configured: configured().x, error: state.x.error }))),
    posts: state.posts,
    lastPoll: state.telegram.lastSuccess,
    lastAlert: state.lastAlert,
    errors: state.errors,
    sourceErrors: state.sourceErrors,
    providers: { Telegram: { ...state.telegram, mode: 'Personal account live updates' }, X: { ...state.x, enabled: config.xEnabled, configured: configured().x, mode: 'Official API v2 · 5-minute polling' } },
    smsConfigured: configured().twilio,
    discordConfigured: configured().discord,
    marketSnapshots
  };
}

function publish() {
  const message = `data: ${JSON.stringify(statusPayload())}\n\n`;
  eventClients.forEach(client => client.write(message));
}

function rememberError(service, error) {
  state.telegram.connected = false;
  state.errors.unshift({ service, message: error.message, time: new Date().toISOString() });
  state.errors = state.errors.slice(0, 8);
  publish();
}

async function sendSms(post) {
  if (!configured().twilio) return false;
  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
  await client.messages.create({ from: config.twilioFromNumber, to: config.smsToNumber, body: `${post.source}\n${post.text}\n${post.link}` });
  return true;
}

async function addPost(post, attachment) {
  if (state.seen.includes(post.id)) return false;
  state.seen.push(post.id);
  state.seen = state.seen.slice(-500);
  state.posts.unshift(post);
  state.posts = state.posts.slice(0, 50);
  global.tradePingerDesktopAlert?.(post, { desktop: config.desktopNotifications, sound: config.notificationSound });
  const alerts = await Promise.allSettled([sendSms(post), sendDiscord(config.discordWebhookUrl, post, attachment)]);
  if (alerts.some(result => result.status === 'fulfilled' && result.value)) state.lastAlert = new Date().toISOString();
  for (const result of alerts) {
    if (result.status === 'rejected') state.errors.unshift({ service: 'Alert', message: result.reason.message, time: new Date().toISOString() });
  }
  state.errors = state.errors.slice(0, 8);
  saveJson(stateFile, state);
  publish();
  return true;
}

const listener = new TelegramListener({
  sessionFile,
  onPost: addPost,
  onState: update => {
    state.telegram = { ...state.telegram, ...update };
    if (update.connected && !update.lastSuccess) state.telegram.lastSuccess = new Date().toISOString();
    publish();
  },
  onSourceErrors: errors => { state.sourceErrors = errors; publish(); },
  onDiagnostics: diagnostics => { state.listenerDiagnostics = diagnostics.map(item => ({ ...item })); publish(); }
});

const xMonitor = new XMonitor({
  onPost: addPost,
  onState: update => { state.x = { ...state.x, ...update }; publish(); }
});

async function restartTelegram() {
  state.errors = [];
  state.sourceErrors = [];
  await listener.start(config.telegramApiId, config.telegramApiHash, config.telegramSources);
}

function restartX() {
  xMonitor.start(config.xBearerToken, config.xSources, config.xEnabled);
}

function marketView(coin, pair) {
  if (!pair) return { coin, error: 'No Solana DEX pair found', updatedAt: new Date().toISOString() };
  return {
    coin, symbol: pair.baseToken?.symbol || coin, name: pair.baseToken?.name || '', priceUsd: pair.priceUsd || null,
    change5m: pair.priceChange?.m5 ?? null, change1h: pair.priceChange?.h1 ?? null,
    change6h: pair.priceChange?.h6 ?? null, change24h: pair.priceChange?.h24 ?? null,
    volume24h: pair.volume?.h24 ?? null, liquidityUsd: pair.liquidity?.usd ?? null,
    marketCap: pair.marketCap ?? null, fdv: pair.fdv ?? null, pairCreatedAt: pair.pairCreatedAt ?? null,
    dex: pair.dexId || null, pairUrl: pair.url || null, updatedAt: new Date().toISOString()
  };
}

async function fetchCoinMarket(coin) {
  const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin);
  const url = address ? `https://api.dexscreener.com/token-pairs/v1/solana/${coin}` : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(coin)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market API returned ${response.status}`);
  const result = await response.json();
  let pairs = (Array.isArray(result) ? result : result.pairs || []).filter(pair => pair.chainId === 'solana');
  if (!address) pairs = pairs.filter(pair => pair.baseToken?.symbol?.toUpperCase() === coin);
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return marketView(coin, pairs[0]);
}

async function refreshMarkets() {
  marketSnapshots = await Promise.all(config.coinWatchlist.map(async coin => {
    try { return await fetchCoinMarket(coin); }
    catch (error) { return { coin, error: error.message, updatedAt: new Date().toISOString() }; }
  }));
  publish();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (request, response) => response.json(statusPayload()));
app.get('/api/config', (request, response) => response.json(publicConfig()));
app.get('/api/telegram/auth', (request, response) => response.json({
  authorized: state.telegram.authorized, authorizing: state.telegram.authorizing,
  needsPassword: Boolean(state.telegram.needsPassword), passwordHint: state.telegram.passwordHint || '',
  qrDataUrl: qrState.dataUrl, qrExpires: qrState.expires, message: state.telegram.message
}));
app.get('/api/events', (request, response) => {
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.flushHeaders();
  eventClients.add(response);
  response.write(`data: ${JSON.stringify(statusPayload())}\n\n`);
  request.on('close', () => eventClients.delete(response));
});

app.post('/api/config', async (request, response) => {
  try {
    const input = request.body;
    const next = {
      ...config,
      telegramApiId: String(input.telegramApiId ?? config.telegramApiId).trim(),
      telegramSources: [...new Set((input.telegramSources || []).map(normalizeTelegramSource))],
      xSources: [...new Set((input.xSources || []).map(normalizeXSource))],
      xEnabled: input.xEnabled === true,
      coinWatchlist: [...new Set((input.coinWatchlist || []).map(normalizeCoin))],
      desktopNotifications: input.desktopNotifications !== false,
      notificationSound: input.notificationSound !== false
    };
    if (next.telegramApiId && !/^\d+$/.test(next.telegramApiId)) throw new Error('Telegram API ID must contain only digits.');
    if (next.telegramSources.length > 50) throw new Error('Telegram monitoring supports up to 50 sources.');
    if (next.xSources.length > 20) throw new Error('X monitoring supports up to 20 handles.');
    if (next.coinWatchlist.length > 20) throw new Error('Coin watchlist supports up to 20 entries.');
    for (const key of ['telegramApiHash', 'xBearerToken', 'twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber', 'smsToNumber', 'discordWebhookUrl']) {
      if (typeof input[key] === 'string' && input[key].trim()) next[key] = input[key].trim();
    }
    if (input.clearDiscordWebhook) next.discordWebhookUrl = '';
    if (input.clearXBearerToken) next.xBearerToken = '';
    if (next.discordWebhookUrl && !/^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(next.discordWebhookUrl)) throw new Error('Enter an official Discord webhook URL.');
    config = next;
    saveConfig();
    await restartTelegram();
    restartX();
    refreshMarkets();
    response.json({ saved: true, config: publicConfig() });
  } catch (error) {
    response.status(400).json({ saved: false, message: error.message });
  }
});

app.post('/api/telegram/authorize', (request, response) => {
  if (!config.telegramApiId || !config.telegramApiHash) return response.status(400).json({ message: 'Save the Telegram API ID and API hash first.' });
  if (authPromise) return response.status(409).json({ message: 'Telegram authorization is already in progress.' });
  authPromise = listener.authorize(config.telegramApiId, config.telegramApiHash, config.telegramSources, async qr => {
    qrState = { dataUrl: await QRCode.toDataURL(qr.url, { width: 240, margin: 1 }), expires: qr.expires };
  }).catch(error => rememberError('Telegram', error)).finally(() => { authPromise = null; qrState = { dataUrl: null, expires: null }; });
  response.status(202).json({ started: true });
});

app.post('/api/telegram/password', (request, response) => {
  try {
    listener.submitPassword(String(request.body.password || ''));
    response.json({ accepted: true });
  } catch (error) { response.status(400).json({ message: error.message }); }
});

app.post('/api/telegram/signout', async (request, response) => {
  await listener.signOut();
  qrState = { dataUrl: null, expires: null };
  response.json({ signedOut: true });
});

app.post('/api/check', async (request, response) => {
  try { response.json({ ok: await listener.check(), x: await xMonitor.poll() }); }
  catch (error) { rememberError('Telegram', error); response.json({ ok: false }); }
});

const server = app.listen(port, () => {
  console.log(`Trade-Pinger service running at http://localhost:${port}`);
  saveConfig();
  restartTelegram();
  restartX();
  refreshMarkets();
  setInterval(() => listener.check().catch(error => rememberError('Telegram', error)), 30000);
  setInterval(refreshMarkets, 60000);
});

server.on('close', () => { listener.disconnect(); xMonitor.stop(); });
module.exports = server;

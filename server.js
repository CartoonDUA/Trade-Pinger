require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const app = express();
const port = Number(process.env.PORT) || 3000;
const pollInterval = Math.max(Number(process.env.POLL_INTERVAL_SECONDS) || 15, 15) * 1000;
const dataDir = path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');
const configFile = path.join(dataDir, 'config.json');
const eventClients = new Set();
let monitorGeneration = 0;
let telegramController;
let xController;

function splitSources(value) {
  return (value || '').split(',').map(source => source.trim()).filter(Boolean);
}

function normalizeXSource(value) {
  const match = value.trim().match(/^(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com\/|@)?([A-Za-z0-9_]{1,15})\/?$/i);
  if (!match) throw new Error(`Unsupported X source: ${value}`);
  return `https://x.com/${match[1]}`;
}

function normalizeTelegramSource(value) {
  const match = value.trim().match(/^(?:https?:\/\/(?:www\.)?t\.me\/|@)?([A-Za-z0-9_]{5,32})\/?$/i);
  if (!match) throw new Error(`Unsupported Telegram public source: ${value}`);
  return `https://t.me/${match[1]}`;
}

const initialTelegramSources = splitSources(process.env.TELEGRAM_SOURCES);
const defaultConfig = {
  xBearerToken: process.env.X_BEARER_TOKEN || '',
  xSources: splitSources(process.env.X_SOURCES).map(normalizeXSource),
  xStreamEnabled: process.env.X_STREAM_ENABLED === 'true',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramSources: initialTelegramSources.filter(source => !source.includes('/+')).map(normalizeTelegramSource),
  telegramPrivateLink: initialTelegramSources.find(source => source.includes('/+')) || '',
  telegramPrivateChatId: process.env.TELEGRAM_PRIVATE_CHAT_ID || '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  smsToNumber: process.env.SMS_TO_NUMBER || '',
  discordWebhookUrl: '',
  coinWatchlist: []
};

let config = fs.existsSync(configFile) ? { ...defaultConfig, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) } : defaultConfig;
let state = {
  seen: [], posts: [], lastAlert: null, errors: [], telegramOffset: 0,
  providers: { X: { connected: false, lastSuccess: null }, Telegram: { connected: false, lastSuccess: null } }
};
let marketSnapshots = [];
if (fs.existsSync(stateFile)) state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
state.providers = {
  X: { connected: false, lastSuccess: state.providers?.X?.lastSuccess || null },
  Telegram: { connected: false, lastSuccess: state.providers?.Telegram?.lastSuccess || null }
};

function saveJson(file, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function xUsername(source) {
  return source.replace(/\/$/, '').split('/').pop();
}

function telegramUsername(source) {
  return source.replace(/\/$/, '').split('/').pop();
}

function providerMode(name) {
  if (name === 'X') return config.xStreamEnabled ? 'Filtered stream' : `${pollInterval / 1000}s polling`;
  return 'Long polling';
}

function publicConfig() {
  return {
    xSources: config.xSources,
    xStreamEnabled: config.xStreamEnabled,
    telegramSources: config.telegramSources,
    telegramPrivateChatId: config.telegramPrivateChatId,
    coinWatchlist: config.coinWatchlist || [],
    configured: {
      x: Boolean(config.xBearerToken),
      telegram: Boolean(config.telegramBotToken),
      twilio: Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber && config.smsToNumber),
      discord: Boolean(config.discordWebhookUrl),
      xBearerToken: Boolean(config.xBearerToken),
      telegramBotToken: Boolean(config.telegramBotToken),
      twilioAccountSid: Boolean(config.twilioAccountSid),
      twilioAuthToken: Boolean(config.twilioAuthToken),
      twilioFromNumber: Boolean(config.twilioFromNumber),
      smsToNumber: Boolean(config.smsToNumber),
      discordWebhookUrl: Boolean(config.discordWebhookUrl)
    }
  };
}

function statusPayload() {
  const successfulChecks = Object.values(state.providers).map(provider => provider.lastSuccess).filter(Boolean).sort();
  return {
    sources: [
      ...config.xSources.map(link => ({ network: 'X', link, configured: Boolean(config.xBearerToken) })),
      ...config.telegramSources.map(link => ({ network: 'Telegram', link, configured: Boolean(config.telegramBotToken) })),
      ...(config.telegramPrivateLink || config.telegramPrivateChatId ? [{ network: 'Telegram', link: 'Private Telegram channel', configured: Boolean(config.telegramBotToken && config.telegramPrivateChatId) }] : [])
    ],
    posts: state.posts,
    lastPoll: successfulChecks.at(-1) || null,
    lastAlert: state.lastAlert,
    errors: state.errors,
    providers: {
      X: { ...state.providers.X, mode: providerMode('X') },
      Telegram: { ...state.providers.Telegram, mode: providerMode('Telegram') }
    },
    smsConfigured: publicConfig().configured.twilio,
    discordConfigured: publicConfig().configured.discord,
    marketSnapshots
  };
}

function publish() {
  const message = `data: ${JSON.stringify(statusPayload())}\n\n`;
  eventClients.forEach(client => client.write(message));
}

function markSuccess(provider) {
  state.providers[provider].connected = true;
  state.providers[provider].lastSuccess = new Date().toISOString();
}

function rememberError(service, error) {
  if (error.name === 'AbortError') return;
  state.providers[service].connected = false;
  state.errors.unshift({ service, message: error.message, time: new Date().toISOString() });
  state.errors = state.errors.slice(0, 8);
  publish();
}

async function sendSms(post) {
  if (!publicConfig().configured.twilio) return;
  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
  await client.messages.create({ from: config.twilioFromNumber, to: config.smsToNumber, body: `${post.source}\n${post.text}\n${post.link}` });
  state.lastAlert = new Date().toISOString();
}

function discordMessages(post) {
  const header = `**New ${post.network} post from ${post.source}**\nTimestamp: ${post.createdAt}`;
  const chunks = post.text.match(/[\s\S]{1,1800}/g) || ['[Media post]'];
  return chunks.map((chunk, index) => {
    const prefix = index === 0 ? `${header}\n\n` : '';
    const link = index === chunks.length - 1 ? `\n\n${post.link}` : '';
    return `${prefix}${chunk}${link}`;
  });
}

function normalizeCoin(value) {
  const coin = value.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin)) return coin;
  if (/^[A-Za-z][A-Za-z0-9]{1,14}$/.test(coin)) return coin.toUpperCase();
  throw new Error(`Unsupported coin symbol or Solana token address: ${value}`);
}

function marketView(coin, pair) {
  if (!pair) return { coin, error: 'No Solana DEX pair found', updatedAt: new Date().toISOString() };
  return {
    coin,
    symbol: pair.baseToken?.symbol || coin,
    name: pair.baseToken?.name || '',
    priceUsd: pair.priceUsd || null,
    change24h: pair.priceChange?.h24 ?? null,
    volume24h: pair.volume?.h24 ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    marketCap: pair.marketCap ?? null,
    fdv: pair.fdv ?? null,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    dex: pair.dexId || null,
    pairUrl: pair.url || null,
    updatedAt: new Date().toISOString()
  };
}

async function fetchCoinMarket(coin) {
  const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coin);
  const url = address
    ? `https://api.dexscreener.com/token-pairs/v1/solana/${coin}`
    : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(coin)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market API returned ${response.status}`);
  const result = await response.json();
  const pairs = (Array.isArray(result) ? result : result.pairs || []).filter(pair => pair.chainId === 'solana');
  if (!address) pairs.splice(0, pairs.length, ...pairs.filter(pair => pair.baseToken?.symbol?.toUpperCase() === coin));
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return marketView(coin, pairs[0]);
}

async function refreshMarkets() {
  const watchlist = config.coinWatchlist || [];
  marketSnapshots = await Promise.all(watchlist.map(async coin => {
    try { return await fetchCoinMarket(coin); }
    catch (error) { return { coin, error: error.message, updatedAt: new Date().toISOString() }; }
  }));
  publish();
}

async function sendDiscord(post) {
  if (!config.discordWebhookUrl) return;
  for (const content of discordMessages(post)) {
    const response = await fetch(config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
    });
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
  }
  state.lastAlert = new Date().toISOString();
}

async function addPost(post) {
  if (state.seen.includes(post.id)) return;
  state.seen.push(post.id);
  state.seen = state.seen.slice(-500);
  state.posts.unshift(post);
  state.posts = state.posts.slice(0, 50);
  const alerts = await Promise.allSettled([sendSms(post), sendDiscord(post)]);
  for (const result of alerts) {
    if (result.status === 'rejected') state.errors.unshift({ service: 'Alert', message: result.reason.message, time: new Date().toISOString() });
  }
  state.errors = state.errors.slice(0, 8);
  saveJson(stateFile, state);
  publish();
}

async function pollX() {
  if (!config.xBearerToken || !config.xSources.length || config.xStreamEnabled) return;
  for (const source of config.xSources) {
    const username = xUsername(source);
    const query = encodeURIComponent(`from:${username} -is:retweet`);
    const response = await fetch(`https://api.x.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at`, { headers: { Authorization: `Bearer ${config.xBearerToken}` } });
    if (!response.ok) throw new Error(`X API returned ${response.status}`);
    const result = await response.json();
    for (const tweet of (result.data || []).reverse()) await addPost({ id: `x:${tweet.id}`, network: 'X', source: `@${username}`, text: tweet.text, link: `https://x.com/${username}/status/${tweet.id}`, createdAt: tweet.created_at });
  }
  markSuccess('X');
  saveJson(stateFile, state);
  publish();
}

async function configureXStream(signal) {
  const headers = { Authorization: `Bearer ${config.xBearerToken}`, 'Content-Type': 'application/json' };
  const rulesResponse = await fetch('https://api.x.com/2/tweets/search/stream/rules', { headers, signal });
  if (!rulesResponse.ok) throw new Error(`X stream rules returned ${rulesResponse.status}`);
  const rules = await rulesResponse.json();
  const ownRuleIds = (rules.data || []).filter(rule => rule.tag?.startsWith('trade-pinger:')).map(rule => rule.id);
  if (ownRuleIds.length) await fetch('https://api.x.com/2/tweets/search/stream/rules', { method: 'POST', headers, body: JSON.stringify({ delete: { ids: ownRuleIds } }), signal });
  const add = config.xSources.map(source => ({ value: `from:${xUsername(source)} -is:retweet`, tag: `trade-pinger:${xUsername(source)}` }));
  const response = await fetch('https://api.x.com/2/tweets/search/stream/rules', { method: 'POST', headers, body: JSON.stringify({ add }), signal });
  if (!response.ok) throw new Error(`X stream setup returned ${response.status}`);
}

async function runXStream(generation) {
  if (!config.xStreamEnabled || !config.xBearerToken || !config.xSources.length) return;
  xController = new AbortController();
  while (generation === monitorGeneration) {
    try {
      await configureXStream(xController.signal);
      const response = await fetch('https://api.x.com/2/tweets/search/stream?tweet.fields=created_at', { headers: { Authorization: `Bearer ${config.xBearerToken}` }, signal: xController.signal });
      if (!response.ok) throw new Error(`X stream returned ${response.status}`);
      state.providers.X.connected = true;
      publish();
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const item = JSON.parse(line);
          if (!item.data) continue;
          const username = item.matching_rules?.[0]?.tag?.replace('trade-pinger:', '') || 'source';
          markSuccess('X');
          await addPost({ id: `x:${item.data.id}`, network: 'X', source: `@${username}`, text: item.data.text, link: `https://x.com/${username}/status/${item.data.id}`, createdAt: item.data.created_at });
        }
      }
    } catch (error) {
      rememberError('X', error);
      if (generation === monitorGeneration) await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}

async function pollTelegram(signal) {
  const allowed = encodeURIComponent('["channel_post"]');
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=${state.telegramOffset}&timeout=25&allowed_updates=${allowed}`, { signal });
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
  const result = await response.json();
  const usernames = config.telegramSources.map(telegramUsername).map(name => name.toLowerCase());
  for (const update of result.result || []) {
    state.telegramOffset = Math.max(state.telegramOffset, update.update_id + 1);
    const post = update.channel_post;
    if (!post) continue;
    const username = (post.chat.username || '').toLowerCase();
    if (!usernames.includes(username) && String(post.chat.id) !== config.telegramPrivateChatId) continue;
    const source = post.chat.username ? `@${post.chat.username}` : post.chat.title;
    const link = post.chat.username ? `https://t.me/${post.chat.username}/${post.message_id}` : `https://t.me/c/${String(post.chat.id).replace('-100', '')}/${post.message_id}`;
    await addPost({ id: `telegram:${post.chat.id}:${post.message_id}`, network: 'Telegram', source, text: post.text || post.caption || '[Media post]', link, createdAt: new Date(post.date * 1000).toISOString() });
  }
  markSuccess('Telegram');
  saveJson(stateFile, state);
  publish();
}

async function runTelegram(generation) {
  if (!config.telegramBotToken || (!config.telegramSources.length && !config.telegramPrivateChatId)) return;
  telegramController = new AbortController();
  while (generation === monitorGeneration) {
    try { await pollTelegram(telegramController.signal); }
    catch (error) {
      rememberError('Telegram', error);
      if (generation === monitorGeneration) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function restartMonitors() {
  monitorGeneration += 1;
  xController?.abort();
  telegramController?.abort();
  state.providers.X.connected = false;
  state.providers.Telegram.connected = false;
  state.errors = [];
  pollX().catch(error => rememberError('X', error));
  runXStream(monitorGeneration);
  runTelegram(monitorGeneration);
  publish();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (request, response) => response.json(statusPayload()));
app.get('/api/config', (request, response) => response.json(publicConfig()));
app.get('/api/events', (request, response) => {
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.flushHeaders();
  eventClients.add(response);
  response.write(`data: ${JSON.stringify(statusPayload())}\n\n`);
  request.on('close', () => eventClients.delete(response));
});
app.post('/api/config', (request, response) => {
  try {
    const input = request.body;
    const next = {
      ...config,
      xSources: [...new Set((input.xSources || []).map(normalizeXSource))],
      xStreamEnabled: Boolean(input.xStreamEnabled),
      telegramSources: [...new Set((input.telegramSources || []).map(normalizeTelegramSource))],
      telegramPrivateChatId: String(input.telegramPrivateChatId || '').trim(),
      coinWatchlist: [...new Set((input.coinWatchlist || []).map(normalizeCoin))]
    };
    if (next.telegramPrivateChatId && !/^-100\d+$/.test(next.telegramPrivateChatId)) throw new Error('Private Telegram chat ID must start with -100 and contain only digits.');
    if (next.coinWatchlist.length > 20) throw new Error('Coin watchlist supports up to 20 entries.');
    for (const key of ['xBearerToken', 'telegramBotToken', 'twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber', 'smsToNumber', 'discordWebhookUrl']) {
      if (typeof input[key] === 'string' && input[key].trim()) next[key] = input[key].trim();
    }
    if (input.clearDiscordWebhook) next.discordWebhookUrl = '';
    if (next.discordWebhookUrl && !/^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(next.discordWebhookUrl)) throw new Error('Enter an official Discord webhook URL.');
    config = next;
    saveJson(configFile, config);
    restartMonitors();
    refreshMarkets();
    response.json({ saved: true, config: publicConfig() });
  } catch (error) {
    response.status(400).json({ saved: false, message: error.message });
  }
});
app.post('/api/poll', async (request, response) => {
  await pollX().catch(error => rememberError('X', error));
  response.json({ ok: true });
});

const server = app.listen(port, () => {
  console.log(`Trade-Pinger service running at http://localhost:${port}`);
  restartMonitors();
  refreshMarkets();
  setInterval(() => pollX().catch(error => rememberError('X', error)), pollInterval);
  setInterval(refreshMarkets, 60000);
});

module.exports = server;

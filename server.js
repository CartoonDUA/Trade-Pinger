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
const eventClients = new Set();

function splitSources(value) {
  return (value || '').split(',').map(source => source.trim()).filter(Boolean);
}

const xSources = splitSources(process.env.X_SOURCES);
const telegramSources = splitSources(process.env.TELEGRAM_SOURCES);
const privateTelegramId = process.env.TELEGRAM_PRIVATE_CHAT_ID || '';
const xStreaming = process.env.X_STREAM_ENABLED === 'true';

let state = {
  seen: [], posts: [], lastPoll: null, lastAlert: null, errors: [], telegramOffset: 0,
  providers: {
    X: { connected: false, mode: xStreaming ? 'Filtered stream' : `${pollInterval / 1000}s polling`, lastSuccess: null },
    Telegram: { connected: false, mode: 'Long polling', lastSuccess: null }
  }
};

if (fs.existsSync(stateFile)) state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
state.providers = {
  X: { connected: false, mode: xStreaming ? 'Filtered stream' : `${pollInterval / 1000}s polling`, lastSuccess: state.providers?.X?.lastSuccess || null },
  Telegram: { connected: false, mode: 'Long polling', lastSuccess: state.providers?.Telegram?.lastSuccess || null }
};

function saveState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function xUsername(source) {
  return source.replace(/\/$/, '').split('/').pop().replace(/^@/, '');
}

function telegramUsername(source) {
  const name = source.replace(/\/$/, '').split('/').pop();
  return name.startsWith('+') ? '' : name.replace(/^@/, '');
}

function statusPayload() {
  const successfulChecks = Object.values(state.providers).map(provider => provider.lastSuccess).filter(Boolean).sort();
  return {
    sources: [
      ...xSources.map(link => ({ network: 'X', link, configured: Boolean(process.env.X_BEARER_TOKEN) })),
      ...telegramSources.map(link => ({ network: 'Telegram', link, configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) }))
    ],
    posts: state.posts, lastPoll: successfulChecks.at(-1) || null, lastAlert: state.lastAlert, errors: state.errors,
    providers: state.providers,
    smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.SMS_TO_NUMBER)
  };
}

function publish() {
  const message = `data: ${JSON.stringify(statusPayload())}\n\n`;
  eventClients.forEach(client => client.write(message));
}

function markSuccess(provider) {
  const time = new Date().toISOString();
  state.providers[provider].connected = true;
  state.providers[provider].lastSuccess = time;
  state.lastPoll = time;
}

function rememberError(service, error) {
  state.providers[service].connected = false;
  state.errors.unshift({ service, message: error.message, time: new Date().toISOString() });
  state.errors = state.errors.slice(0, 8);
  publish();
}

async function sendSms(post) {
  const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SMS_TO_NUMBER'];
  if (!required.every(name => process.env[name])) return;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to: process.env.SMS_TO_NUMBER, body: `${post.source}\n${post.text}\n${post.link}` });
  state.lastAlert = new Date().toISOString();
}

async function addPost(post) {
  if (state.seen.includes(post.id)) return;
  state.seen.push(post.id);
  state.seen = state.seen.slice(-500);
  state.posts.unshift(post);
  state.posts = state.posts.slice(0, 50);
  await sendSms(post);
  saveState();
  publish();
}

async function pollX() {
  if (!process.env.X_BEARER_TOKEN || !xSources.length || xStreaming) return;
  for (const source of xSources) {
    const username = xUsername(source);
    const query = encodeURIComponent(`from:${username} -is:retweet`);
    const response = await fetch(`https://api.x.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at`, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    if (!response.ok) throw new Error(`X API returned ${response.status}`);
    const result = await response.json();
    for (const tweet of (result.data || []).reverse()) await addPost({ id: `x:${tweet.id}`, network: 'X', source: `@${username}`, text: tweet.text, link: `https://x.com/${username}/status/${tweet.id}`, createdAt: tweet.created_at });
  }
  markSuccess('X');
  saveState();
  publish();
}

async function configureXStream() {
  const headers = { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}`, 'Content-Type': 'application/json' };
  const rulesResponse = await fetch('https://api.x.com/2/tweets/search/stream/rules', { headers });
  if (!rulesResponse.ok) throw new Error(`X stream rules returned ${rulesResponse.status}`);
  const rules = await rulesResponse.json();
  const ownRuleIds = (rules.data || []).filter(rule => rule.tag?.startsWith('trade-pinger:')).map(rule => rule.id);
  if (ownRuleIds.length) await fetch('https://api.x.com/2/tweets/search/stream/rules', { method: 'POST', headers, body: JSON.stringify({ delete: { ids: ownRuleIds } }) });
  const add = xSources.map(source => ({ value: `from:${xUsername(source)} -is:retweet`, tag: `trade-pinger:${xUsername(source)}` }));
  const addResponse = await fetch('https://api.x.com/2/tweets/search/stream/rules', { method: 'POST', headers, body: JSON.stringify({ add }) });
  if (!addResponse.ok) throw new Error(`X stream setup returned ${addResponse.status}`);
}

async function runXStream() {
  if (!xStreaming || !process.env.X_BEARER_TOKEN || !xSources.length) return;
  while (true) {
    try {
      await configureXStream();
      const response = await fetch('https://api.x.com/2/tweets/search/stream?tweet.fields=created_at', { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
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
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}

async function pollTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !telegramSources.length) return;
  const allowed = encodeURIComponent('["channel_post"]');
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${state.telegramOffset}&timeout=25&allowed_updates=${allowed}`);
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
  const result = await response.json();
  const usernames = telegramSources.map(telegramUsername).filter(Boolean).map(name => name.toLowerCase());
  for (const update of result.result || []) {
    state.telegramOffset = Math.max(state.telegramOffset, update.update_id + 1);
    const post = update.channel_post;
    if (!post) continue;
    const username = (post.chat.username || '').toLowerCase();
    if (!usernames.includes(username) && String(post.chat.id) !== privateTelegramId) continue;
    const source = post.chat.username ? `@${post.chat.username}` : post.chat.title;
    const link = post.chat.username ? `https://t.me/${post.chat.username}/${post.message_id}` : `https://t.me/c/${String(post.chat.id).replace('-100', '')}/${post.message_id}`;
    await addPost({ id: `telegram:${post.chat.id}:${post.message_id}`, network: 'Telegram', source, text: post.text || post.caption || '[Media post]', link, createdAt: new Date(post.date * 1000).toISOString() });
  }
  markSuccess('Telegram');
  saveState();
  publish();
}

async function runTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !telegramSources.length) return;
  while (true) {
    try { await pollTelegram(); } catch (error) { rememberError('Telegram', error); await new Promise(resolve => setTimeout(resolve, 5000)); }
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (request, response) => response.json(statusPayload()));
app.get('/api/events', (request, response) => {
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.flushHeaders();
  eventClients.add(response);
  response.write(`data: ${JSON.stringify(statusPayload())}\n\n`);
  request.on('close', () => eventClients.delete(response));
});
app.post('/api/poll', async (request, response) => {
  await pollX().catch(error => rememberError('X', error));
  response.json({ ok: true });
});

const server = app.listen(port, () => {
  console.log(`Trade-Pinger service running at http://localhost:${port}`);
  pollX().catch(error => rememberError('X', error));
  setInterval(() => pollX().catch(error => rememberError('X', error)), pollInterval);
  runXStream();
  runTelegram();
});

module.exports = server;

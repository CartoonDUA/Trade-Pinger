require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

const app = express();
const port = Number(process.env.PORT) || 3000;
const pollInterval = Math.max(Number(process.env.POLL_INTERVAL_SECONDS) || 60, 15) * 1000;
const dataDir = path.join(__dirname, 'data');
const stateFile = path.join(dataDir, 'state.json');

function splitSources(value) {
  return (value || '').split(',').map(source => source.trim()).filter(Boolean);
}

const xSources = splitSources(process.env.X_SOURCES);
const telegramSources = splitSources(process.env.TELEGRAM_SOURCES);
const privateTelegramId = process.env.TELEGRAM_PRIVATE_CHAT_ID || '';

let state = {
  seen: [],
  posts: [],
  lastPoll: null,
  lastAlert: null,
  errors: [],
  telegramOffset: 0
};

if (fs.existsSync(stateFile)) {
  state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
}

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

function rememberError(service, error) {
  state.errors.unshift({ service, message: error.message, time: new Date().toISOString() });
  state.errors = state.errors.slice(0, 8);
}

async function sendSms(post) {
  const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SMS_TO_NUMBER'];
  if (!required.every(name => process.env[name])) return;

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to: process.env.SMS_TO_NUMBER,
    body: `${post.source}\n${post.text}\n${post.link}`
  });
  state.lastAlert = new Date().toISOString();
}

async function addPost(post) {
  if (state.seen.includes(post.id)) return;
  state.seen.push(post.id);
  state.seen = state.seen.slice(-500);
  state.posts.unshift(post);
  state.posts = state.posts.slice(0, 50);
  await sendSms(post);
}

async function pollX() {
  if (!process.env.X_BEARER_TOKEN || !xSources.length) return;

  for (const source of xSources) {
    const username = xUsername(source);
    const query = encodeURIComponent(`from:${username} -is:retweet`);
    const response = await fetch(`https://api.x.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at`, {
      headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }
    });
    if (!response.ok) throw new Error(`X API returned ${response.status}`);
    const result = await response.json();

    for (const tweet of (result.data || []).reverse()) {
      await addPost({
        id: `x:${tweet.id}`,
        network: 'X',
        source: `@${username}`,
        text: tweet.text,
        link: `https://x.com/${username}/status/${tweet.id}`,
        createdAt: tweet.created_at
      });
    }
  }
}

async function pollTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !telegramSources.length) return;

  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${state.telegramOffset}&timeout=0&allowed_updates=${encodeURIComponent('["channel_post"]')}`);
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}`);
  const result = await response.json();

  const usernames = telegramSources.map(telegramUsername).filter(Boolean).map(name => name.toLowerCase());
  for (const update of result.result || []) {
    state.telegramOffset = Math.max(state.telegramOffset, update.update_id + 1);
    const post = update.channel_post;
    if (!post) continue;

    const username = (post.chat.username || '').toLowerCase();
    const isConfigured = usernames.includes(username) || String(post.chat.id) === privateTelegramId;
    if (!isConfigured) continue;

    const source = post.chat.username ? `@${post.chat.username}` : post.chat.title;
    const link = post.chat.username
      ? `https://t.me/${post.chat.username}/${post.message_id}`
      : `https://t.me/c/${String(post.chat.id).replace('-100', '')}/${post.message_id}`;

    await addPost({
      id: `telegram:${post.chat.id}:${post.message_id}`,
      network: 'Telegram',
      source,
      text: post.text || post.caption || '[Media post]',
      link,
      createdAt: new Date(post.date * 1000).toISOString()
    });
  }
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  state.errors = [];

  await pollX().catch(error => rememberError('X', error));
  await pollTelegram().catch(error => rememberError('Telegram', error));
  state.lastPoll = new Date().toISOString();
  saveState();
  polling = false;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (request, response) => {
  response.json({
    sources: [
      ...xSources.map(link => ({ network: 'X', link, configured: Boolean(process.env.X_BEARER_TOKEN) })),
      ...telegramSources.map(link => ({ network: 'Telegram', link, configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) }))
    ],
    posts: state.posts,
    lastPoll: state.lastPoll,
    lastAlert: state.lastAlert,
    errors: state.errors,
    smsConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.SMS_TO_NUMBER)
  });
});

app.post('/api/poll', async (request, response) => {
  await poll();
  response.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Social alerts running at http://localhost:${port}`);
  poll();
  setInterval(poll, pollInterval);
});

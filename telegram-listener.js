const fs = require('fs');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');
const { getPeerId } = require('teleproto/Utils');

const usernamePattern = /^[A-Za-z0-9_]{5,32}$/;
const numericPattern = /^-\d+$/;

function normalizeTelegramSource(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Enter a Telegram channel or dialog link.');

  if (input.startsWith('@')) {
    const username = input.slice(1);
    if (!usernamePattern.test(username)) throw new Error('Telegram usernames must be 5–32 letters, numbers, or underscores.');
    return `@${username}`;
  }
  if (numericPattern.test(input)) return input;

  let url;
  try { url = new URL(input.includes('://') ? input : `https://${input}`); }
  catch { throw new Error('Use @username, a t.me link, or a Telegram Web dialog link.'); }

  const host = url.hostname.toLowerCase();
  if (['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(host)) {
    const username = url.pathname.replace(/^\//, '').split('/')[0];
    if (usernamePattern.test(username)) return `@${username}`;
  }
  if (host === 'web.telegram.org') {
    const dialog = url.hash.replace(/^#\/?/, '').split('?')[0];
    if (dialog.startsWith('@')) return normalizeTelegramSource(dialog);
    if (numericPattern.test(dialog)) return dialog;
  }
  throw new Error('Use @username, a t.me link, or a Telegram Web dialog link.');
}

function messageTime(message) {
  const value = message.date instanceof Date ? message.date.getTime() : Number(message.date) * 1000;
  return Number.isFinite(value) ? value : Date.now();
}

function peerIds(entity) {
  const values = new Set();
  if (entity?.id !== undefined) {
    const id = BigInt(entity.id.toString());
    values.add(id.toString());
    values.add((-id).toString());
  }
  try { values.add(getPeerId(entity).toString()); } catch {}
  return values;
}

class TelegramListener {
  constructor({ sessionFile, onPost, onState, onSourceErrors }) {
    this.sessionFile = sessionFile;
    this.onPost = onPost;
    this.onState = onState;
    this.onSourceErrors = onSourceErrors;
    this.client = null;
    this.startedAt = 0;
    this.qr = null;
    this.passwordRequest = null;
  }

  sessionValue() {
    return fs.existsSync(this.sessionFile) ? fs.readFileSync(this.sessionFile, 'utf8').trim() : '';
  }

  async connect(apiId, apiHash) {
    await this.disconnect();
    this.client = new TelegramClient(new StringSession(this.sessionValue()), Number(apiId), apiHash, { connectionRetries: 5 });
    await this.client.connect();
    return this.client.checkAuthorization();
  }

  async start(apiId, apiHash, sources) {
    if (!apiId || !apiHash) {
      this.onState({ connected: false, authorized: false, message: 'Telegram API credentials are not configured.' });
      return;
    }
    try {
      const authorized = await this.connect(apiId, apiHash);
      if (!authorized) {
        this.onState({ connected: false, authorized: false, message: 'Scan the setup QR code to authorize this account.' });
        return;
      }
      await this.listen(sources);
    } catch (error) {
      this.onState({ connected: false, authorized: false, message: error.message });
    }
  }

  async authorize(apiId, apiHash, sources, onQr) {
    const authorized = await this.connect(apiId, apiHash);
    if (authorized) {
      await this.listen(sources);
      return;
    }

    this.onState({ connected: false, authorized: false, authorizing: true, message: 'Waiting for QR scan.' });
    await this.client.signInUserWithQrCode({ apiId: Number(apiId), apiHash }, {
      qrCode: async code => {
        this.qr = { url: `tg://login?token=${code.token.toString('base64url')}`, expires: Number(code.expires) * 1000 };
        await onQr(this.qr);
      },
      password: async hint => new Promise(resolve => {
        this.passwordRequest = { resolve, hint: hint || '' };
        this.onState({ connected: false, authorized: false, authorizing: true, needsPassword: true, passwordHint: hint || '', message: 'Telegram two-step verification is required.' });
      }),
      onError: error => {
        this.onState({ connected: false, authorized: false, authorizing: true, message: error.message });
        return false;
      }
    });
    fs.mkdirSync(require('path').dirname(this.sessionFile), { recursive: true });
    fs.writeFileSync(this.sessionFile, this.client.session.save(), { encoding: 'utf8', mode: 0o600 });
    this.qr = null;
    this.passwordRequest = null;
    await this.listen(sources);
  }

  submitPassword(password) {
    if (!this.passwordRequest) throw new Error('Telegram is not waiting for a two-step verification password.');
    const request = this.passwordRequest;
    this.passwordRequest = null;
    request.resolve(password);
  }

  async resolveSource(value) {
    const normalized = normalizeTelegramSource(value);
    if (normalized.startsWith('@')) {
      const entity = await this.client.getEntity(normalized);
      const username = entity.username || normalized.slice(1);
      return { input: normalized, label: `@${username}`, username, entity, peerId: getPeerId(entity).toString() };
    }

    const dialogs = await this.client.getDialogs({});
    const dialog = dialogs.find(item => peerIds(item.entity).has(normalized));
    if (!dialog) throw new Error(`The signed-in account cannot resolve or access ${normalized}.`);
    const username = dialog.entity.username || null;
    return { input: normalized, label: username ? `@${username}` : dialog.title || dialog.name || normalized, username, entity: dialog.entity, peerId: getPeerId(dialog.entity).toString() };
  }

  async listen(values) {
    const sources = [];
    const errors = [];
    for (const value of values) {
      try { sources.push(await this.resolveSource(value)); }
      catch (error) { errors.push({ source: value, message: error.message }); }
    }
    this.onSourceErrors(errors);
    this.startedAt = Date.now();
    for (const source of sources) {
      this.client.addEventHandler(event => this.newMessage(source, event), new NewMessage({ chats: [source.entity] }));
    }
    this.onState({ connected: true, authorized: true, authorizing: false, message: sources.length ? `Listening to ${sources.length} source${sources.length === 1 ? '' : 's'}.` : 'Signed in; add an accessible source.' });
  }

  async newMessage(source, event) {
    const message = event.message;
    if (messageTime(message) < this.startedAt) return;
    const text = message.message || '[Media post]';
    const link = source.username ? `https://t.me/${source.username}/${message.id}` : '';
    let attachment = null;
    const size = Number(message.file?.size || 0);
    if (message.media && (!size || size <= 8 * 1024 * 1024)) {
      const content = await this.client.downloadMedia(message.media, {});
      if (content?.length) attachment = { name: message.file?.name || `telegram-${message.id}${message.file?.ext || '.bin'}`, content };
    }
    await this.onPost({
      id: `telegram:${source.peerId || getPeerId(source.entity)}:${message.id}`,
      network: 'Telegram', source: source.label, text, link,
      createdAt: new Date(messageTime(message)).toISOString(),
      media: message.media ? { attached: Boolean(attachment), tooLarge: size > 8 * 1024 * 1024 } : null
    }, attachment);
    this.onState({ connected: true, authorized: true, lastSuccess: new Date().toISOString(), message: 'Listening for new Telegram posts.' });
  }

  async check() {
    if (!this.client) return false;
    const authorized = await this.client.checkAuthorization();
    if (authorized) this.onState({ connected: true, authorized: true, lastSuccess: new Date().toISOString(), message: 'Telegram connection checked successfully.' });
    return authorized;
  }

  async disconnect() {
    if (this.client) await this.client.disconnect();
    this.client = null;
  }

  async signOut() {
    if (this.client) {
      try { await this.client.invoke(new (require('teleproto').Api.auth.LogOut)()); } catch {}
      await this.disconnect();
    }
    if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
    this.onState({ connected: false, authorized: false, authorizing: false, message: 'Telegram account signed out locally.' });
  }
}

module.exports = { TelegramListener, normalizeTelegramSource, messageTime };

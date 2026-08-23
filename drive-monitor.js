const crypto = require('crypto');

function normalizeDriveFolder(value) {
  const input = String(value || '').trim();
  const match = input.match(/^(?:https:\/\/drive\.google\.com\/drive\/folders\/)?([A-Za-z0-9_-]{10,})\/?(?:\?.*)?$/);
  if (!match) throw new Error('Enter a Google Drive folder URL or folder ID.');
  return match[1];
}

class DriveMonitor {
  constructor({ onFile, onState, onCredentials, fetcher = fetch }) {
    this.onFile = onFile;
    this.onState = onState;
    this.onCredentials = onCredentials;
    this.fetcher = fetcher;
    this.baseline = new Set();
    this.timer = null;
    this.running = false;
    this.pendingState = null;
  }

  authorizationUrl(clientId, redirectUri) {
    this.pendingState = crypto.randomBytes(24).toString('hex');
    this.redirectUri = redirectUri;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: this.pendingState
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async completeAuthorization(code, state) {
    if (!code || !state || state !== this.pendingState) throw new Error('Google authorization state did not match. Start authorization again.');
    this.pendingState = null;
    const body = new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: this.redirectUri, grant_type: 'authorization_code' });
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) throw new Error(`Google OAuth returned ${response.status}`);
    const result = await response.json();
    this.accessToken = result.access_token;
    this.refreshToken = result.refresh_token || this.refreshToken;
    this.expiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    this.onCredentials({ accessToken: this.accessToken, refreshToken: this.refreshToken, expiresAt: this.expiresAt });
    return true;
  }

  async token() {
    if (this.accessToken && Date.now() < this.expiresAt - 60000) return this.accessToken;
    if (!this.refreshToken) throw new Error('Google Drive authorization is required.');
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' });
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) throw new Error(`Google token refresh returned ${response.status}`);
    const result = await response.json();
    this.accessToken = result.access_token;
    this.expiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    this.onCredentials({ accessToken: this.accessToken, refreshToken: this.refreshToken, expiresAt: this.expiresAt });
    return this.accessToken;
  }

  async listFiles() {
    const params = new URLSearchParams({
      q: `'${this.folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: '100'
    });
    const response = await this.fetcher(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!response.ok) throw new Error(`Google Drive API returned ${response.status}`);
    return (await response.json()).files || [];
  }

  async poll() {
    if (!this.running) return false;
    this.onState({ checking: true, message: 'Checking Google Drive folder.' });
    try {
      const files = await this.listFiles();
      if (!this.ready) {
        this.baseline = new Set(files.map(file => file.id));
        this.ready = true;
      } else {
        for (const file of files.slice().reverse()) {
          if (this.baseline.has(file.id)) continue;
          this.baseline.add(file.id);
          await this.onFile({
            id: `Drive:${file.id}`,
            network: 'Google Drive',
            source: `Google Drive · ${this.folderId}`,
            text: `${file.name}\nType: ${file.mimeType}`,
            createdAt: file.createdTime || file.modifiedTime || new Date().toISOString(),
            link: file.webViewLink || '',
            drive: { name: file.name, mimeType: file.mimeType, folderId: this.folderId, modifiedTime: file.modifiedTime || null }
          });
        }
      }
      this.onState({ connected: true, checking: false, lastSuccess: new Date().toISOString(), error: null, message: 'Google Drive polling active.' });
      return true;
    } catch (error) {
      this.onState({ connected: false, checking: false, error: error.message, message: 'Google Drive needs attention.' });
      return false;
    }
  }

  start(settings, intervalMs = 60000) {
    this.stop();
    Object.assign(this, settings);
    this.baseline.clear();
    this.ready = false;
    this.running = Boolean(settings.enabled && settings.folderId && settings.clientId && settings.clientSecret && settings.refreshToken);
    if (!this.running) {
      this.onState({ connected: false, checking: false, lastSuccess: null, error: null, message: settings.enabled ? 'Google Drive setup or authorization is incomplete.' : 'Google Drive monitoring is stopped.' });
      return;
    }
    this.onState({ connected: false, checking: false, lastSuccess: null, error: null, message: 'Establishing Drive folder baseline.' });
    this.poll();
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }
}

module.exports = { DriveMonitor, normalizeDriveFolder };

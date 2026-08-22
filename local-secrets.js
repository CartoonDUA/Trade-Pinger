const fs = require('fs');

let safeStorage;
try { ({ safeStorage } = require('electron')); } catch {}

class LocalSecrets {
  constructor(file) {
    this.file = file;
  }

  available() {
    return Boolean(safeStorage?.isEncryptionAvailable());
  }

  load() {
    if (!this.available() || !fs.existsSync(this.file)) return {};
    const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    return Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, safeStorage.decryptString(Buffer.from(value, 'base64'))]));
  }

  save(values) {
    if (!this.available()) throw new Error('Protected secret storage is available in the desktop app. Launch Trade-Pinger with npm start.');
    const encrypted = Object.fromEntries(Object.entries(values).filter(([, value]) => value).map(([key, value]) => [key, safeStorage.encryptString(value).toString('base64')]));
    fs.mkdirSync(require('path').dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(encrypted, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = LocalSecrets;

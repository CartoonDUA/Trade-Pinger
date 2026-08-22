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

test('server does not reference recovery phrases or private keys', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.doesNotMatch(source, /private.?key|recovery.?phrase|seed.?phrase/i);
});

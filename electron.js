const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');

let window;

function desktopAlert(post, settings) {
  if (settings.sound) shell.beep();
  if (!settings.desktop || !Notification.isSupported()) return;
  const preview = String(post.text || '[Media post]').replace(/\s+/g, ' ').trim().slice(0, 140);
  const notification = new Notification({ title: `New post from ${post.source}`, body: preview, silent: true });
  notification.on('click', () => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  notification.show();
}

function createWindow() {
  global.tradePingerDesktopAlert = desktopAlert;
  require('./server');
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#111111',
    title: 'Trade-Pinger',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  window.removeMenu();
  window.loadURL(`http://localhost:${process.env.PORT || 3000}?desktop=1`);
  window.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('open-external', (event, url) => shell.openExternal(url));
app.whenReady().then(() => {
  app.setAppUserModelId('CartoonDUA.TradePinger');
  createWindow();
});
app.on('window-all-closed', () => app.quit());

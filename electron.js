const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let window;

function createWindow() {
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
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

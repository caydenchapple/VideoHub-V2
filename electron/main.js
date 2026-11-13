// VideoHub as an app: one native window around the local VideoHub server (http://127.0.0.1:<port>). The server is the
// same hub.js as ever; this file only starts it when it is not running, shows its UI and sends links to the default browser.
// hub.json (written next to this file by scripts/build-mac-app.mjs) says where the VideoHub folder is.
'use strict';
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'hub.json'), 'utf8')); } catch { }
const HUB = cfg.hubDir || '';
const readPort = () => {
  if (+process.env.VIDEOHUB_PORT) return +process.env.VIDEOHUB_PORT;
  try { return +JSON.parse(fs.readFileSync(path.join(HUB, 'data', 'config.json'), 'utf8')).port || 7788; } catch { return 7788; }
};
const PORT = readPort(), BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = () => new Promise(res => {
  const q = http.get(BASE + '/api/ping', { timeout: 1500 }, r => { r.resume(); res(r.statusCode === 200); });
  q.on('error', () => res(false)); q.on('timeout', () => { q.destroy(); res(false); });
});
function findNode() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
  for (const c of [cfg.node, ...dirs.map(d => d && path.join(d, 'node'))]) { try { if (c && fs.statSync(c).isFile()) return c; } catch { } }
  return null;
}
async function ensureServer() {
  if (await alive()) return true;
  const node = findNode();
  if (!node) throw new Error('Node.js was not found. Install it (brew install node) and open VideoHub again.');
  fs.mkdirSync(path.join(HUB, 'data'), { recursive: true });
  const log = fs.openSync(path.join(HUB, 'data', 'hub.log'), 'a');
  const env = { ...process.env, PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(path.delimiter) };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(node, [path.join(HUB, 'server', 'hub.js')], { cwd: HUB, detached: true, stdio: ['ignore', log, log], env }).unref();   // outlives this window: it closes itself when idle
  for (let i = 0; i < 80; i++) { if (await alive()) return true; await sleep(250); }
  throw new Error('VideoHub did not start (see ' + path.join(HUB, 'data', 'hub.log') + ').');
}

let win = null;
const hashArg = argv => (argv.find(a => a.startsWith('--hash=')) || '').slice(7);
async function openWindow(hash = '') {
  // a window that is already open is only brought to the front: the page decides whether to switch (it never takes you out of a film)
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#14161c', title: 'VideoHub', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  // links to other sites open in the browser; VideoHub's own pages (a film's preview, a video) stay in the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE + '/')) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(BASE + '/') && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  // the server went away (it closes after 2 idle minutes, or a crash): start it again and reload
  win.webContents.on('did-fail-load', async (_e, code, _d, url, isMain) => {
    if (!isMain || code === -3 || !url.startsWith(BASE)) return;
    try { await ensureServer(); await sleep(300); if (win) win.loadURL(url); } catch (err) { dialog.showErrorBox('VideoHub', String(err.message || err)); }
  });
  try { await ensureServer(); } catch (err) { dialog.showErrorBox('VideoHub could not start', String(err.message || err)); app.quit(); return; }
  win.loadURL(BASE + '/' + hash);
}

if (!HUB || !fs.existsSync(path.join(HUB, 'server', 'hub.js'))) {
  app.whenReady().then(() => { dialog.showErrorBox("VideoHub's folder was not found", 'It was moved or deleted. Run setup.sh again from the VideoHub folder.'); app.quit(); });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openWindow(hashArg(argv)));
  app.on('activate', () => openWindow());
  app.on('window-all-closed', () => app.quit());   // the server stays and closes itself when idle
  app.whenReady().then(() => {
    const isMac = process.platform === 'darwin';
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(isMac ? [{ label: 'VideoHub', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
      { role: 'windowMenu' },
      { label: 'Help', submenu: [{ label: 'Open VideoHub in the browser', click: () => shell.openExternal(BASE) }] },
    ]));
    openWindow(hashArg(process.argv));
  });
}

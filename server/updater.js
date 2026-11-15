// App updates. Releases are published to a Zephyr application ("videohub-updates"): a manifest.json plus videohub-<version>.tar.gz
// (scripts/make-release.mjs builds them, scripts/release.mjs uploads them). This file looks at the manifest, and when the user clicks
// "Download update and restart" it downloads the package, checks its SHA-256, backs up the code it replaces, copies the new code over
// (data/, settings, films and notes are never touched), runs npm install only when the lock file changed, and starts the hub again.
// Nothing is checked or downloaded until the user clicks; a check is one small request for manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { HUB_DIR, DATA_DIR, readJson, writeJson } from './util.js';

// what a release contains (kept in step with ITEMS in update.sh); never node_modules, data, hub.json or build output
export const RELEASE_ITEMS = ['server', 'ui', 'electron', 'templates', 'skill', 'claude', 'examples', 'engine-hooks', 'docs', 'scripts', 'guard',
  'CLAUDE.md', 'README.md', 'LICENSE', 'SETUP.cmd', 'UPDATE.cmd', 'SETUP.command', 'OPEN.command', 'UPDATE.command', 'update.ps1', 'setup.ps1',
  'uninstall.ps1', 'open.ps1', 'open.vbs', 'setup.sh', 'open.sh', 'update.sh', 'uninstall.sh', 'package.json', 'package-lock.json'];
export const RELEASE_EXCLUDE = ['node_modules', 'hub.json', 'build', '.DS_Store', '._*'];

const FILE = path.join(DATA_DIR, 'updates.json');
export const currentVersion = (dir = HUB_DIR) => String(readJson(path.join(dir, 'package.json'), {})?.version || '0.0.0');
// 1.2.10 > 1.2.9 > 1.2 ; a pre-release tail (-beta) sorts before the release
export function compareVersions(a, b) {
  const p = v => String(v).trim().replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  const pa = /-/.test(a), pb = /-/.test(b);
  return pa === pb ? 0 : pa ? -1 : 1;
}
// where the manifest lives: data/updates.json (the user's own choice) or the address built into package.json
export const updateBase = () => {
  const u = String(readJson(FILE, {})?.url || readJson(path.join(HUB_DIR, 'package.json'), {})?.videohub?.updateUrl || '').trim().replace(/\/+$/, '');
  return okUrl(u) ? u : '';
};
// https only; plain http just for this computer (tests, a local mirror)
const okUrl = u => /^https:\/\/[^\s]+$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/[^\s]*)?$/.test(u);
export const setUpdateBase = url => {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !okUrl(u)) throw Object.assign(new Error('The update address must start with https://'), { code: 400 });
  writeJson(FILE, { ...(readJson(FILE, {}) || {}), url: u });
  return updateBase();
};

// a manifest is trusted only in this shape: a plain file name next to manifest.json, a 64-hex SHA-256
export function readManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('The update information is not valid.');
  const version = String(m.version || '');
  if (!/^\d+(\.\d+){0,3}(-[\w.]+)?$/.test(version)) throw new Error('The update information has no valid version.');
  const file = String(m.file || '');
  if (!/^[\w.-]+\.tar\.gz$/.test(file)) throw new Error('The update information names an invalid file.');
  const sha256 = String(m.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('The update information has no valid checksum.');
  return { version, file, sha256, bytes: +m.bytes || 0, date: m.date || null, notes: String(m.notes || '').slice(0, 2000) };
}

let state = { phase: 'idle', current: currentVersion(), latest: null, available: false, message: '', checkedAt: 0 };   // idle | checking | downloading | installing | restarting | error
const listeners = new Set();
export const onUpdate = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const updateState = () => ({ ...state, current: currentVersion(), configured: !!updateBase() });
const set = patch => { state = { ...state, ...patch }; const s = updateState(); for (const f of listeners) try { f(s); } catch { } return s; };

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15e3), headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`The update server answered ${r.status}.`);
  return r.json();
}
export async function checkUpdate() {
  const base = updateBase();
  if (!base) return set({ phase: 'error', message: 'No update address is set yet.' });
  if (['downloading', 'installing', 'restarting'].includes(state.phase)) return updateState();
  set({ phase: 'checking', message: '' });
  try {
    const m = readManifest(await getJson(`${base}/manifest.json?t=${Date.now()}`));
    const available = compareVersions(m.version, currentVersion()) > 0;
    return set({ phase: 'idle', latest: m, available, checkedAt: Date.now(), message: available ? `Version ${m.version} is ready.` : 'VideoHub is up to date.' });
  } catch (e) {
    return set({ phase: 'error', message: 'Could not check for updates: ' + (e.name === 'TimeoutError' ? 'the update server did not answer.' : e.message) });
  }
}

// copy a release over a VideoHub folder: back up what is replaced, add and replace files, leave everything else alone
export function installFiles(srcDir, destDir, backupDir) {
  let n = 0;
  for (const it of RELEASE_ITEMS) {
    const s = path.join(srcDir, it), d = path.join(destDir, it);
    if (!fs.existsSync(s)) continue;
    if (fs.existsSync(d)) fs.cpSync(d, path.join(backupDir, it), { recursive: true, filter: f => !/(^|[\\/])node_modules([\\/]|$)/.test(f) });
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.cpSync(s, d, { recursive: true, force: true, filter: f => !/(^|[\\/])(node_modules|hub\.json|build|\.DS_Store|\._[^\\/]*)$/.test(f) });
    n++;
  }
  return n;
}
const sha256File = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });

// busy(): a string saying why now is a bad time (render running...), or ''
export async function applyUpdate({ busy = () => '', restart = true } = {}) {
  if (['downloading', 'installing', 'restarting'].includes(state.phase)) return updateState();
  const why = busy();
  if (why) { set({ phase: 'error', message: why }); throw Object.assign(new Error(why), { code: 409 }); }
  await checkUpdate();   // always the manifest as it is now, never an old answer
  const st = state;
  if (st.phase === 'error') throw new Error(st.message);
  if (!st.available || !st.latest) return set({ phase: 'idle', message: 'VideoHub is up to date.' });
  const m = st.latest, base = updateBase(), tmp = path.join(DATA_DIR, 'update-tmp'), stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'x'), { recursive: true });
    set({ phase: 'downloading', message: `Downloading version ${m.version}…` });
    const pkg = path.join(tmp, m.file);
    const r = await fetch(`${base}/${m.file}`, { signal: AbortSignal.timeout(10 * 60e3) });
    if (!r.ok || !r.body) throw new Error(`The update server answered ${r.status}.`);
    const out = fs.createWriteStream(pkg); let got = 0;
    for await (const chunk of r.body) { got += chunk.length; if (!out.write(chunk)) await new Promise(ok => out.once('drain', ok)); }
    await new Promise((ok, no) => out.end(e => e ? no(e) : ok()));
    if (m.bytes && got !== m.bytes) throw new Error('The download is incomplete. Nothing was changed; try again.');
    if (await sha256File(pkg) !== m.sha256) throw new Error('The download does not match its checksum, so it was not installed. Nothing was changed.');
    set({ phase: 'installing', message: 'Installing…' });
    const x = spawnSync('tar', ['-xzf', pkg, '-C', path.join(tmp, 'x')], { encoding: 'utf8' });
    if (x.status !== 0) throw new Error('Could not unpack the update: ' + (x.stderr || '').trim().slice(0, 200));
    const src = path.join(tmp, 'x');
    if (!fs.existsSync(path.join(src, 'server', 'hub.js')) || currentVersion(src) !== m.version) throw new Error('The package is not the version it says it is. Nothing was changed.');
    const lockOld = fs.existsSync(path.join(HUB_DIR, 'package-lock.json')) ? crypto.createHash('sha1').update(fs.readFileSync(path.join(HUB_DIR, 'package-lock.json'))).digest('hex') : '';
    const backup = path.join(DATA_DIR, 'update-backup', stamp); fs.mkdirSync(backup, { recursive: true });
    installFiles(src, HUB_DIR, backup);
    const lockNew = crypto.createHash('sha1').update(fs.readFileSync(path.join(HUB_DIR, 'package-lock.json'))).digest('hex');
    if (lockOld !== lockNew || !fs.existsSync(path.join(HUB_DIR, 'node_modules'))) {
      set({ message: 'Updating packages…' });
      const npm = await new Promise(ok => { const c = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: HUB_DIR, stdio: 'ignore', shell: process.platform === 'win32' }); c.on('exit', ok); c.on('error', () => ok(1)); });
      if (npm) throw new Error('The new code is installed but its packages could not be (npm install failed). The old code is in ' + backup);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    set({ phase: 'restarting', current: m.version, available: false, message: restart ? 'Restarting…' : 'Updated. Restart VideoHub to use it.' });
    if (restart) restartHub();
    return updateState();
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    set({ phase: 'error', message: e.message });
    throw e;
  }
}

// the same hub, started again by a small helper once this process has let go of the port; the window reconnects by itself
export function restartHub() {
  const hub = path.join(HUB_DIR, 'server', 'hub.js');
  const code = `const fs=require('fs');setTimeout(()=>{let l='ignore';try{l=fs.openSync(${JSON.stringify(path.join(DATA_DIR, 'hub.log'))},'a')}catch{}require('child_process').spawn(process.execPath,[${JSON.stringify(hub)}],{cwd:${JSON.stringify(HUB_DIR)},detached:true,stdio:['ignore',l,l],env:process.env}).unref();process.exit(0)},1800)`;
  spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore', env: process.env }).unref();
  setTimeout(() => process.exit(0), 600).unref();
}

// Programs that hold a lot of RAM next to a render (an Android emulator once held 7.4 GB of a 16 GB PC during a render).
// Renders, Windows itself, the Claude app and VideoHub are left out; nothing is ever closed from here, the user decides.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { IS_MAC } from './platform.js';

const NAMES = {
  mumunxdevice: 'MuMuPlayer (Android emulator)', mumunxmain: 'MuMuPlayer (Android emulator)', mumuplayer: 'MuMuPlayer (Android emulator)',
  mumuvmmheadless: 'MuMuPlayer (Android emulator)', mumuvmmsvc: 'MuMuPlayer (Android emulator)', mumumultiplayer: 'MuMuPlayer (Android emulator)',
  'hd-player': 'BlueStacks (Android emulator)', 'hd-agent': 'BlueStacks (Android emulator)', ldplayer: 'LDPlayer (Android emulator)', 'dnplayer': 'LDPlayer (Android emulator)',
  noxvmhandle: 'Nox (Android emulator)', nox: 'Nox (Android emulator)',
  chrome: 'Chrome (browser)', msedge: 'Edge (browser)', firefox: 'Firefox', opera: 'Opera', brave: 'Brave',
  discord: 'Discord', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games', obs64: 'OBS',
  razerappengine: 'Razer Synapse', spotify: 'Spotify', telegram: 'Telegram', whatsapp: 'WhatsApp', teams: 'Teams', 'ms-teams': 'Teams',
  code: 'VS Code', photoshop: 'Photoshop', 'adobe premiere pro': 'Premiere Pro', afterfx: 'After Effects', resolve: 'DaVinci Resolve',
  'google chrome': 'Chrome (browser)', 'microsoft edge': 'Edge (browser)', 'brave browser': 'Brave', safari: 'Safari', slack: 'Slack', 'zoom.us': 'Zoom', docker: 'Docker', 'docker desktop': 'Docker',
  'visual studio code': 'VS Code', 'adobe photoshop 2025': 'Photoshop', 'final cut pro': 'Final Cut Pro', 'logic pro x': 'Logic Pro', xcode: 'Xcode', simulator: 'iOS Simulator', utm: 'UTM (virtual machine)', 'parallels desktop': 'Parallels', 'vmware fusion': 'VMware',
  blender: 'Blender', vmmem: 'WSL / virtual machine', vmmemwsl: 'WSL / virtual machine', 'vmware-vmx': 'VMware', virtualboxvm: 'VirtualBox',
};
// never listed: Windows, drivers, antivirus, the Claude app, the render tools themselves
const SKIP = new Set(['system', 'registry', 'memory compression', 'idle', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass',
  'svchost', 'dwm', 'explorer', 'msmpeng', 'nissrv', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
  'runtimebroker', 'ctfmon', 'fontdrvhost', 'sihost', 'taskhostw', 'audiodg', 'conhost', 'powershell', 'pwsh', 'cmd', 'wmiprvse', 'spoolsv',
  'claude', 'node', 'ffmpeg',
  'kernel_task', 'launchd', 'windowserver', 'loginwindow', 'finder', 'dock', 'systemuiserver', 'controlcenter', 'spotlight', 'mds', 'mds_stores', 'mdworker', 'mdworker_shared', 'coreaudiod', 'corespotlightd', 'terminal', 'iterm2', 'ps', 'login', 'zsh', 'bash', 'sh', 'ffprobe', 'renderguard', 'msedgewebview2', 'radeonsoftware', 'amdrssrcext', 'atieclxx', 'atiesrxx', 'amdfendrsr',
  'nvcontainer', 'nvdisplay.container', 'lockapp', 'widgets', 'phoneexperiencehost', 'securityhealthservice', 'smartscreen', 'dllhost', 'applicationframehost']);

const PS = `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ n = $_.Name; p = [int]$_.ProcessId; pp = [int]$_.ParentProcessId; m = [int64]$_.PrivatePageCount; h = [bool]($_.CommandLine -match '--headless|--app=http://127\\.0\\.0\\.1') } } | ConvertTo-Json -Compress`;

let cache = { at: 0, list: [] }, running = null;

// macOS: one `ps` listing; the program is the .app the process lives in (Chrome's helpers count for "Google Chrome")
const BROWSER_KEYS = new Set(['chrome', 'msedge', 'google chrome', 'microsoft edge', 'brave browser']);
function scanMac() {
  return new Promise(resolve => {
    execFile('ps', ['-axo', 'pid=,ppid=,rss=,command='], { maxBuffer: 16 << 20, timeout: 20000 }, (err, out) => {
      if (err) return resolve(null);
      const rows = [];
      for (const l of String(out).split('\n')) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); if (!m) continue;
        const cmd = m[4], app = cmd.match(/\/([^/]+)\.app\//);
        const n = app ? app[1] : path.basename(cmd.split(/ -{1,2}\w/)[0].trim());
        rows.push({ n, p: +m[1], pp: +m[2], m: +m[3] * 1024, h: /--headless|--app=http:\/\/127\.0\.0\.1/.test(cmd) });
      }
      resolve(group(rows));
    });
  });
}
function group(rows) {
  const byPid = new Map(rows.map(r => [r.p, r]));
  // a browser process belongs to a headless render (or the VideoHub window) when the top process of its tree says so
  const top = r => { let x = r, k = 0; while (k++ < 20) { const up = byPid.get(x.pp); if (!up || up.n !== x.n) return x; x = up; } return x; };
  const groups = new Map();
  for (const r of rows) {
    const key = String(r.n || '').replace(/\.exe$/i, '').toLowerCase();
    if (!key || SKIP.has(key) || key.startsWith('videohub') || key.startsWith('com.apple.')) continue;   // never VideoHub itself or macOS' own services
    if (BROWSER_KEYS.has(key) && top(r).h) continue;
    const name = NAMES[key] || r.n.replace(/\.exe$/i, '');
    const g = groups.get(name) || { name, bytes: 0, procs: 0, pids: [] };
    g.bytes += r.m || 0; g.procs++; g.pids.push(r.p); groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

function scan() {
  if (IS_MAC) return scanMac();
  return new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true, maxBuffer: 16 << 20, timeout: 20000 }, (err, out) => {
      if (err) return resolve(null);
      let rows; try { rows = JSON.parse(out); } catch { return resolve(null); }
      resolve(group(rows));
    });
  });
}

// cached list of programs over minBytes; refreshes in the background when older than maxAgeMs
export function ramHogs({ minBytes = 600 * 2 ** 20, maxAgeMs = 30e3 } = {}) {
  if (Date.now() - cache.at > maxAgeMs && !running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; });
  return cache.list.filter(g => g.bytes >= minBytes);
}

// the same, fresh (waits for a scan up to ~20 s)
export async function ramHogsNow(opts = {}) {
  if (Date.now() - cache.at > 10e3) { if (!running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; }); await running; }
  return ramHogs({ ...opts, maxAgeMs: 1e9 });
}

// every program with at least minBytes of RAM and the process ids behind it (the Focus panel picks from this list)
export async function programList({ minBytes = 80 * 2 ** 20, fresh = false } = {}) {
  if (fresh || Date.now() - cache.at > 5e3) { if (!running) running = scan().then(l => { if (l) cache = { at: Date.now(), list: l }; running = null; }); await running; }
  return cache.list.filter(g => g.bytes >= minBytes);
}

const gb = b => (b / 2 ** 30).toFixed(1) + ' GB';
// one sentence for the job log / Claude: big programs only (≥ 1.5 GB), or null
export function ramNote(list, availMB) {
  const big = list.filter(g => g.bytes >= 1.5 * 2 ** 30);
  if (!big.length) return null;
  return `Programs using RAM: ${big.map(g => `${g.name} ${gb(g.bytes)}`).join(', ')}${availMB ? ` (free RAM ${gb(availMB * 2 ** 20)})` : ''}. ` +
    'Closing them during rendering can speed up the render and keep your computer responsive (the user decides what to close).';
}

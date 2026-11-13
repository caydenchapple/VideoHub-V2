// Everything that differs between Windows and macOS lives here or behind these helpers: process trees, free memory,
// opening files and folders, notifications, the folder picker's AppleScript, browsers and the places tools are installed.
// No imports from util.js (util.js imports this file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const PLATFORM_NAME = IS_MAC ? 'macOS' : IS_WIN ? 'Windows' : process.platform;
export const HOME = os.homedir();

// Apps started from Finder, launchd or a login item get a bare PATH (/usr/bin:/bin:...), without Homebrew. ffmpeg and node
// are looked up through PATH by render scripts and child processes, so the usual install folders are added once, here.
export const MAC_TOOL_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/opt/local/bin'];
if (IS_MAC) {
  const have = new Set((process.env.PATH || '').split(path.delimiter));
  const add = MAC_TOOL_DIRS.filter(d => !have.has(d) && fs.existsSync(d));
  if (add.length) process.env.PATH = [process.env.PATH, ...add].filter(Boolean).join(path.delimiter);
}

// ---------- browsers (Chromium based: renders drive them through puppeteer, the VideoHub window is --app=)
const mac = (app, exe = app) => [`/Applications/${app}.app/Contents/MacOS/${exe}`, path.join(HOME, 'Applications', `${app}.app`, 'Contents', 'MacOS', exe)];
const winPF = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files'].filter(Boolean);
const firstFile = list => list.find(f => { try { return fs.existsSync(f); } catch { return false; } }) || null;
export function findBrowsers() {
  if (IS_MAC) return {
    edge: firstFile(mac('Microsoft Edge')),
    chrome: firstFile([...mac('Google Chrome'), ...mac('Google Chrome Beta', 'Google Chrome Beta')]),
    brave: firstFile(mac('Brave Browser')),
    chromium: firstFile(mac('Chromium')),
  };
  return {
    edge: firstFile(winPF.map(d => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))),
    chrome: firstFile([...winPF.map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')), path.join(HOME, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    brave: firstFile(winPF.map(d => path.join(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))),
    chromium: null,
  };
}
// the browser the VideoHub window and renders use: Edge first on Windows (always there), Chrome first on a Mac
export const pickBrowser = b => (IS_MAC ? b.chrome || b.edge || b.brave || b.chromium : b.edge || b.chrome || b.brave || b.chromium) || null;

// VideoHub.app (the Electron app made by scripts/build-mac-app.mjs): the window of the hub. null when it is not installed.
export function findElectronApp() {
  if (!IS_MAC) return null;
  for (const d of [process.env.VIDEOHUB_APP, path.join(HOME, 'Applications', 'VideoHub.app'), '/Applications/VideoHub.app']) {
    if (d && fs.existsSync(path.join(d, 'Contents', 'Resources', 'app', 'hub.json'))) return d;
  }
  return null;
}

// ---------- processes
// every process that descends from pid (children, grandchildren...), from one `ps` listing; [] when ps fails
function psTable() {
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 << 20 }).split('\n')
      .map(l => l.trim().split(/\s+/).map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite));
  } catch { return []; }
}
export function descendants(pid) {
  const rows = psTable(), kids = new Map();
  for (const [p, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const out = [], stack = [pid], seen = new Set([pid]);
  while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); }
  return out;
}
// the process and everything it started (a render is node -> Chrome -> helpers, and ffmpeg)
export function killTree(pid, { force = true } = {}) {
  pid = +pid; if (!pid) return false;
  if (IS_WIN) { try { spawn('taskkill', ['/PID', String(pid), '/T', force ? '/F' : '/T'], { windowsHide: true, stdio: 'ignore' }).on('error', () => { }); return true; } catch { return false; } }
  const sig = force ? 'SIGKILL' : 'SIGTERM', all = [...descendants(pid).reverse(), pid];   // leaves first, so nothing is restarted by its parent
  let ok = false;
  for (const p of all) { try { process.kill(p, sig); ok = true; } catch { } }
  return ok;
}

// Free memory the way Activity Monitor would count it. os.freemem() on macOS is only the pages nothing uses: the OS keeps
// "free" tiny on purpose and fills the rest with cache it gives back at once, so it would always look like a memory shortage.
let memCache = { at: 0, mb: 0 };
export function availableMemMB() {
  if (!IS_MAC) return os.freemem() / 1048576;
  if (Date.now() - memCache.at < 1500) return memCache.mb;
  let mb;
  try {
    const out = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 3000 });
    const size = +(out.match(/page size of (\d+) bytes/) || [])[1] || 16384, n = k => +((out.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] || 0);
    mb = (n('Pages free') + n('Pages inactive') + n('Pages speculative') + n('Pages purgeable')) * size / 1048576;
  } catch { mb = os.freemem() / 1048576; }
  memCache = { at: Date.now(), mb };
  return mb;
}

// ---------- opening things for the user
// the file with its default app, or the folder in Finder; reveal = the file selected inside its folder
export function openCommand(target, { reveal = false } = {}) {
  if (IS_MAC) return { command: 'open', args: reveal ? ['-R', target] : [target] };
  return { command: 'explorer.exe', args: [reveal ? '/select,"' + target + '"' : '"' + target + '"'], verbatim: true };
}
export function openUrlCommand(url) {
  return IS_MAC ? { command: 'open', args: [url] } : { command: 'cmd', args: ['/c', 'start', '', url] };
}
export function spawnDetached(command, args, opts = {}) {
  const c = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  c.on('error', () => { }); c.unref();
  return c;
}

// a desktop notification (macOS: Notification Center, through osascript; the text goes in as arguments, never into the script)
export function notifyMac(title, body) {
  const script = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
  const c = spawn('osascript', [...script.flatMap(l => ['-e', l]), String(title || '').slice(0, 120), String(body || '').slice(0, 200)], { stdio: 'ignore', detached: true });
  c.on('error', () => { }); c.unref();
}

// the "Choose folder" dialog; resolves to a folder path or null
export function pickFolderMac(start, title) {
  const lines = ['on run argv', 'tell current application to activate',
    'if (count of argv) > 1 and (item 2 of argv) is not "" then', 'set f to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))', 'else',
    'set f to choose folder with prompt (item 1 of argv)', 'end if', 'return POSIX path of f', 'end run'];
  return new Promise(res => {
    let s = ''; try { if (start && fs.statSync(start).isDirectory()) s = start; } catch { }
    execFile('osascript', [...lines.flatMap(l => ['-e', l]), String(title || 'Choose folder'), s], { timeout: 10 * 60e3 }, (err, out) => {
      const p = err ? '' : String(out).trim();   // cancelling is an error (-128)
      res(p ? (p.length > 1 ? p.replace(/\/+$/, '') : p) : null);
    });
  });
}

// ---------- the Trash. NSFileManager.trashItem (through osascript's JavaScript bridge) moves a file to the Trash the way Finder
// does ("Put Back" works) without controlling Finder, so macOS shows no Automation prompt and it works from any process
// (a Terminal, the VideoHub app, a login item). Finder is only the fallback. Resolves to { ok, error }.
const TRASH_JXA = `ObjC.import('Foundation');
function run(argv) {
  const fm = $.NSFileManager.defaultManager, url = $.NSURL.fileURLWithPath(argv[0]), err = Ref();
  if (!fm.trashItemAtURLResultingItemURLError(url, $(), err)) throw new Error(ObjC.unwrap(err[0].localizedDescription));
  return 'ok';
}`;
const osa = (args, ms = 120e3) => new Promise(res => execFile('osascript', args, { timeout: ms }, (err, out, stderr) => res({ ok: !err, out: String(out || ''), err: String(stderr || (err && err.message) || '') })));
export async function moveToTrashMac(file) {
  const a = await osa(['-l', 'JavaScript', '-e', TRASH_JXA, file]);
  if (a.ok) return { ok: true };
  if (!fs.existsSync(file)) return { ok: true };   // gone meanwhile
  const lines = ['on run argv', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', 'end run'];
  const b = await osa([...lines.flatMap(l => ['-e', l]), file]);
  if (b.ok) return { ok: true };
  const m = b.err || a.err;
  return { ok: false, error: /not allowed|-1743|-10004/.test(b.err) ? 'macOS did not allow VideoHub to use Finder (System Settings > Privacy & Security > Automation).' : (m.trim().split('\n').pop() || 'Could not move it to the Trash.').slice(0, 300) };
}

// The path to write into things that outlive this process (LaunchAgent, Claude's MCP config): Homebrew's node lives in a versioned
// folder (/opt/homebrew/Cellar/node/26.7.0/bin/node) that disappears on upgrade; /opt/homebrew/bin/node keeps working.
export function stableNodePath() {
  let real; try { real = fs.realpathSync(process.execPath); } catch { return process.execPath; }
  for (const d of [...(process.env.PATH || '').split(path.delimiter), ...MAC_TOOL_DIRS]) {
    if (!d) continue;
    const f = path.join(d, 'node');
    try { if (fs.realpathSync(f) === real) return f; } catch { }
  }
  return process.execPath;
}

// ---------- start at login (a LaunchAgent that runs the hub with no window)
export const LAUNCH_AGENT_LABEL = 'com.videohub.server';
export const launchAgentFile = () => path.join(HOME, 'Library', 'LaunchAgents', LAUNCH_AGENT_LABEL + '.plist');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function launchAgentPlist(hubDir) {
  const hubJs = path.join(hubDir, 'server', 'hub.js'), log = path.join(hubDir, 'data', 'hub.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(stableNodePath())}</string><string>${xml(hubJs)}</string></array>
  <key>WorkingDirectory</key><string>${xml(hubDir)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH || '/usr/bin:/bin')}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

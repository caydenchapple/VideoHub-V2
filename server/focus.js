// Focus: while a render runs, slow down the programs you choose so the render gets the computer. macOS only (the Windows build
// has the render's own CPU limit and priority instead). A slowed program is put in the background class (`taskpolicy -b`): lowest CPU,
// disk and network priority, but it keeps running and nothing is closed or lost; `taskpolicy -B` puts it back, which is what happens
// the moment the render ends, Focus is switched off or VideoHub quits (also after a crash: the ids are remembered in
// data/focus-slowed.json and restored at the next start). Only programs you ticked are touched, never VideoHub, the render's own
// processes, Claude, Terminal or the system (server/ramhogs.js keeps that list).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DATA_DIR, readJson, writeJson, run, processAlive } from './util.js';
import { IS_MAC, descendants } from './platform.js';
import { programList } from './ramhogs.js';

const FILE = path.join(DATA_DIR, 'focus.json'), SLOWED_FILE = path.join(DATA_DIR, 'focus-slowed.json');
const DEFAULTS = { enabled: false, apps: [], awake: true, manual: false };
export const focusConfig = () => { const j = readJson(FILE, {}) || {}; return { ...DEFAULTS, ...j, apps: Array.isArray(j.apps) ? j.apps.filter(a => typeof a === 'string') : [] }; };
export function saveFocus(patch = {}) {
  const c = focusConfig();
  if (typeof patch.enabled === 'boolean') c.enabled = patch.enabled;
  if (typeof patch.awake === 'boolean') c.awake = patch.awake;
  if (typeof patch.manual === 'boolean') c.manual = patch.manual;
  if (Array.isArray(patch.apps)) c.apps = [...new Set(patch.apps.filter(a => typeof a === 'string' && a && a.length <= 80))].slice(0, 60);
  writeJson(FILE, c);
  return c;
}

// which processes to slow: those of the chosen programs, minus the ones that must never be touched. Pure (tested).
export function choosePids(groups, apps, skip = new Set()) {
  const want = new Set(apps), out = new Map();
  for (const g of groups || []) if (want.has(g.name)) for (const pid of g.pids || []) if (!skip.has(pid)) out.set(pid, g.name);
  return out;
}

const slowed = new Map();   // pid -> program name
let lastScan = 0;
const persist = () => { try { writeJson(SLOWED_FILE, [...slowed.keys()]); } catch { } };
const set = (pid, bg) => run('taskpolicy', [bg ? '-b' : '-B', '-p', String(pid)]);

// called by render protection every few seconds with whether a render is running and the render's own root processes
export async function focusTick(rendering, protectPids = [], force = false) {
  if (!IS_MAC) return;
  const c = focusConfig(), want = (c.enabled && rendering) || c.manual;
  if (!want || !c.apps.length) { if (slowed.size) await releaseFocus(); return; }
  if (!force && Date.now() - lastScan < 6000) return;   // programs start helpers all the time: look again every few seconds
  lastScan = Date.now();
  const groups = await programList({ minBytes: 0, fresh: true });
  const skip = new Set([process.pid, process.ppid]);
  for (const root of protectPids) { skip.add(root); for (const d of descendants(root)) skip.add(d); }
  for (const [pid, name] of choosePids(groups, c.apps, skip)) {
    if (slowed.has(pid)) continue;
    if ((await set(pid, true)).code === 0) slowed.set(pid, name);   // not ours to change (another user's process): skipped
  }
  for (const pid of [...slowed.keys()]) if (!processAlive(pid)) slowed.delete(pid);
  persist();
}
export async function releaseFocus() {
  const pids = [...slowed.keys()]; slowed.clear(); lastScan = 0;
  await Promise.all(pids.filter(processAlive).map(pid => set(pid, false)));
  persist();
}
function releaseSync() { for (const pid of slowed.keys()) { try { spawnSync('taskpolicy', ['-B', '-p', String(pid)], { timeout: 2000 }); } catch { } } }
if (IS_MAC) {
  process.on('exit', releaseSync);
  // a crash or kill -9 of an earlier hub left programs slowed: put them back now
  try { for (const pid of readJson(SLOWED_FILE, []) || []) if (processAlive(pid)) spawnSync('taskpolicy', ['-B', '-p', String(pid)], { timeout: 2000 }); writeJson(SLOWED_FILE, []); } catch { }
}

// keep the Mac awake while a render runs (display may sleep; the render continues): caffeinate exits with the render
export function keepAwake(pid) {
  if (!IS_MAC || !pid || !focusConfig().awake) return;
  try { const c = spawn('caffeinate', ['-i', '-w', String(pid)], { detached: true, stdio: 'ignore' }); c.on('error', () => { }); c.unref(); } catch { }
}

export function focusState() {
  const c = focusConfig(), by = new Map();
  for (const [, name] of slowed) by.set(name, (by.get(name) || 0) + 1);
  return { supported: IS_MAC, enabled: c.enabled, manual: c.manual, awake: c.awake, apps: c.apps, active: [...by].map(([name, procs]) => ({ name, procs })), total: slowed.size };
}

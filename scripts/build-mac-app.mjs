// Builds VideoHub.app (an Electron app: a native window around the local VideoHub server) and saves it where you say.
//   node scripts/build-mac-app.mjs [--out <folder, default ~/Applications>]
// It installs Electron into electron/ (a separate package: the hub itself has no Electron dependency), draws the icon,
// packages electron/ as VideoHub.app and signs it ad hoc (needed on Apple Silicon). The app finds the hub through
// Contents/Resources/app/hub.json, written here with this folder's path: do not move the VideoHub folder afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stableNodePath, moveToTrashMac } from '../server/platform.js';
import { makeIcns } from './make-icon.mjs';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EL = path.join(HUB, 'electron');
export const appOwnedBy = (appPath, hub = HUB) => { try { return JSON.parse(fs.readFileSync(path.join(appPath, 'Contents', 'Resources', 'app', 'hub.json'), 'utf8')).hubDir === hub; } catch { return false; } };

export async function buildApp(outDir, { log = console.log } = {}) {
  const dest = path.join(outDir, 'VideoHub.app');
  if (fs.existsSync(dest) && !appOwnedBy(dest) && fs.existsSync(path.join(dest, 'Contents', 'Resources', 'app', 'hub.json'))) throw new Error(`${dest} belongs to another VideoHub install: left alone.`);
  log('  installing Electron (once, about 150 MB; this takes a minute)…');
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: EL, stdio: 'inherit' });
  if (npm.status !== 0) throw new Error('npm install in electron/ failed');
  const icon = path.join(EL, 'build', 'VideoHub.icns');
  try { await makeIcns(icon); } catch (e) { log(`  (no icon: ${e.message})`); }
  fs.writeFileSync(path.join(EL, 'hub.json'), JSON.stringify({ hubDir: HUB, node: stableNodePath() }, null, 1));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videohub-app-'));
  try {
    log('  packaging VideoHub.app…');
    const { packager } = await import(pathToFileURL(path.join(EL, 'node_modules', '@electron', 'packager', 'dist', 'index.js')).href);
    const out = await packager({ dir: EL, out: tmp, name: 'VideoHub', platform: 'darwin', arch: process.arch, overwrite: true, asar: false, prune: true,
      icon: fs.existsSync(icon) ? icon : undefined, appBundleId: 'com.videohub.app', appCategoryType: 'public.app-category.video',
      ignore: [/^\/build($|\/)/, /^\/README/, /\/\.cache($|\/)/], quiet: true });
    const built = path.join(out[0], 'VideoHub.app');
    if (!fs.existsSync(built)) throw new Error('the packager made no app');
    const cs = spawnSync('codesign', ['--force', '--deep', '--sign', '-', built], { encoding: 'utf8' });
    if (cs.status !== 0) log('  (ad-hoc signing failed: ' + (cs.stderr || '').trim().split('\n').pop() + ')');
    fs.mkdirSync(outDir, { recursive: true });
    if (fs.existsSync(dest)) { const r = await moveToTrashMac(dest); if (!r.ok) throw new Error(`could not replace ${dest}: ${r.error}`); for (let k = 0; k < 40 && fs.existsSync(dest); k++) await new Promise(r => setTimeout(r, 250)); }   // the old one goes to the Trash
    const mv = spawnSync('ditto', [built, dest], { encoding: 'utf8' });
    if (mv.status !== 0) throw new Error('could not copy the app to ' + outDir + ': ' + (mv.stderr || '').trim());
    spawnSync('touch', [dest]);   // Finder reads the icon again
    return dest;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out'), out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(os.homedir(), 'Applications'));
  try { console.log('VideoHub app: ' + await buildApp(out)); } catch (e) { console.error(e.message); process.exit(1); }
}

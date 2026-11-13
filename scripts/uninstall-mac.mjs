// VideoHub uninstall for macOS: undoes what setup.sh did on this Mac. Your films, their notes (.videohub folders), the
// outputs folder and this VideoHub folder itself are NOT touched; delete the folder yourself afterwards if you want.
//   ./uninstall.sh [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchAgentFile, moveToTrashMac } from '../server/platform.js';
import { appOwnedBy } from './build-mac-app.mjs';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), HOME = os.homedir();
const DRY = process.argv.includes('--dry-run');
const say = (m, c = 37) => console.log(`\x1b[${c}m${m}\x1b[0m`);
async function doIt(what, act) { if (DRY) say(`  [dry run] would: ${what}`, 36); else { await act(); say(`done: ${what}`, 32); } }
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
say(`== VideoHub uninstall: ${HUB}`, 36);

// 1. stop this install's hub (only node processes running <this folder>/server/hub.js)
const hubJs = path.join(HUB, 'server', 'hub.js');
const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n');
for (const l of ps) { const m = l.trim().match(/^(\d+)\s+(.*)$/); if (m && +m[1] !== process.pid && m[2].includes(hubJs)) await doIt(`stop the VideoHub server (pid ${m[1]})`, () => process.kill(+m[1], 'SIGTERM')); }

// 2. Claude: MCP server, skill, global rule - only when they belong to THIS install (another VideoHub folder keeps its own)
const mcp = path.join(HUB, 'server', 'mcp.js'), cj = path.join(HOME, '.claude.json'), j = readJson(cj);
const entry = j?.mcpServers?.videohub;
if (entry && JSON.stringify(entry).includes(mcp)) {
  await doIt(`remove the MCP server "videohub" from ${cj}`, () => { fs.copyFileSync(cj, cj + '.videohub-backup'); delete j.mcpServers.videohub; fs.writeFileSync(cj, JSON.stringify(j, null, 2)); });
} else say('The registered MCP server "videohub" is not this install (or none is registered): left alone.');
const sk = path.join(HOME, '.claude', 'skills', 'videohub');
if (fs.existsSync(path.join(sk, 'SKILL.md'))) {
  if (fs.readFileSync(path.join(sk, 'SKILL.md'), 'utf8').includes(HUB)) await doIt(`move the skill folder ${sk} to the Trash`, async () => { const r = await moveToTrashMac(sk); if (!r.ok) throw new Error(r.error); });
  else say(`The skill in ${sk} belongs to another install: left alone.`);
}
const cm = path.join(HOME, '.claude', 'CLAUDE.md');
if (fs.existsSync(cm)) {
  const cur = fs.readFileSync(cm, 'utf8'), rx = /\n?<!-- videohub:begin[\s\S]*?<!-- videohub:end -->\n?/;
  const m = cur.match(rx);
  if (m && m[0].includes(HUB)) await doIt(`remove the VideoHub rule block from ${cm}`, () => { fs.copyFileSync(cm, cm + '.videohub-backup'); fs.writeFileSync(cm, cur.replace(rx, '\n').trimStart()); });
}

// 3. the VideoHub.app launcher and login item
for (const app of [path.join(HOME, 'Applications', 'VideoHub.app'), path.join(HOME, 'Desktop', 'VideoHub.app'), '/Applications/VideoHub.app']) {
  let mine = appOwnedBy(app);   // the Electron app names this folder in Resources/app/hub.json; the older launchers in Info.plist / the script
  for (const f of ['Info.plist', 'MacOS/VideoHub']) { try { if (fs.readFileSync(path.join(app, 'Contents', f), 'latin1').includes(f === 'Info.plist' ? HUB.replace(/&/g, '&amp;').replace(/</g, '&lt;') : HUB)) mine = true; } catch { } }
  if (mine) await doIt(`move the app ${app} to the Trash`, async () => { for (const p of spawnSync('pgrep', ['-f', path.join(app, 'Contents')], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)) { try { process.kill(+p, 'SIGTERM'); } catch { } } const r = await moveToTrashMac(app); if (!r.ok) throw new Error(r.error); });
}
const agent = launchAgentFile();
if (fs.existsSync(agent) && fs.readFileSync(agent, 'utf8').includes(HUB)) await doIt('remove the "start at login" item', () => {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, agent], { stdio: 'ignore' }); fs.unlinkSync(agent);
});

console.log('');
say('== Done. Left in place: this folder (with data/), your films and their .videohub notes, the outputs folder,', 36);
say("   and ~/Library/Application Support/RenderGuard (render protection settings). Delete them yourself if you want them gone.", 36);

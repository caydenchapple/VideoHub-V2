// VideoHub setup for macOS: a short guided install (the same steps as setup.ps1 on Windows). Safe to run again: it updates
// instead of duplicating, keeps every answer already given and never moves or overwrites your folders or settings.
//   ./setup.sh [--dry-run] [--yes] [answers...]          (setup.sh checks for Node, then runs this file)
//   --dry-run          ask nothing, assume the recommended answers and print every step; change nothing outside this folder
//   --yes              accept every recommended answer, ask nothing
// Answers (each question has one; "ask" = ask when needed, the default):
//   --workspace <folder>          where your video work lives (default ~/Documents/VideoHub)
//   --watch-found ask|yes|no      also watch video folders found on the Desktop / in Documents (recommended: no)
//   --gpu-encoder ask|yes|no      render with the Mac's hardware video encoder (VideoToolbox) (recommended: yes)
//   --global-rule ask|yes|no      add the "review before rendering" rule to ~/.claude/CLAUDE.md (recommended: yes)
//   --shortcut ask|yes|no         build VideoHub.app, an Electron app (recommended: yes; needs a ~150 MB download once)
//   --app-dir <folder>            where VideoHub.app is saved (default ~/Applications: Launchpad and Spotlight find it)
//   --startup ask|yes|no          start VideoHub (server only, no window) when you log in (recommended: no)
//   --example ask|yes|no          add the example film (recommended: yes)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../server/util.js';
import { MAC_TOOL_DIRS, stableNodePath, launchAgentFile, launchAgentPlist } from '../server/platform.js';
import { state, checkWorkspace, initConfig } from './init-config.mjs';
import { detectEncoders } from '../server/encoders.js';
import { buildApp, appOwnedBy } from './build-mac-app.mjs';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = (k, d = '') => { const i = argv.findIndex(a => a === k || a.startsWith(k + '=')); if (i < 0) return d; return argv[i].includes('=') ? argv[i].slice(k.length + 1) : (argv[i + 1] ?? d); };
const choice = (k, d = 'ask') => { const v = val(k, d).toLowerCase(); if (!['ask', 'yes', 'no'].includes(v)) { console.error(`${k}: ask | yes | no`); process.exit(2); } return v; };
const DRY = flag('--dry-run') || flag('--test'), YES = flag('--yes');
const interactive = process.stdin.isTTY && !DRY && !YES;
const A = { watch: choice('--watch-found'), gpu: choice('--gpu-encoder'), rule: choice('--global-rule'), shortcut: choice('--shortcut'), startup: choice('--startup'), example: choice('--example') };
const WORKSPACE = val('--workspace');

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const say = (m, col = 37) => console.log(c(col, m));
const plan = m => console.log(c(36, `  [dry run] would: ${m}`));
const todo = [];
const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = async q => (await rl.question(q)).trim();
async function yesNo(question, preset, recommended) {
  if (preset === 'yes') return true; if (preset === 'no') return false;
  if (!interactive) { say(`${question} -> ${recommended ? 'yes' : 'no'} (recommended)`, 90); return recommended; }
  for (;;) {
    const a = (await ask(`${question} ${recommended ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
    if (!a) return recommended; if (/^(y|yes)$/.test(a)) return true; if (/^(n|no)$/.test(a)) return false;
    say('  Please type y (yes) or n (no), or press Enter for the recommended answer.', 33);
  }
}
const run = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', ...o }); return { code: r.status ?? 1, out: String(r.stdout || ''), err: String(r.stderr || '') }; };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

say(`== VideoHub setup: ${HUB}`, 36);
if (DRY) say('Dry run: no questions, the recommended answers, nothing outside this folder is changed.', 33);
else if (YES || !interactive) say('Using the recommended answer for every question that was not answered on the command line.', 33);
else say('A few plain questions follow. Press Enter to take the recommended answer shown in [brackets].');

// answers this Mac already gave (a second run does not ask them again); data/ is per machine, never in git
const answersFile = path.join(HUB, 'data', 'setup-answers.json');
const answers = readJson(answersFile) || {};

// ---------- 1. tools
const major = +process.versions.node.split('.')[0];
if (major < 22) { say(`Node.js is too old here (version ${major}; VideoHub needs 22 or newer). Install it with Homebrew: brew install node`, 31); process.exit(1); }
say(`Node.js v${process.versions.node}: ok`, 32);
const haveFfmpeg = TOOLS.ffmpeg !== 'ffmpeg' || run('ffmpeg', ['-version']).code === 0;
if (haveFfmpeg) say(`ffmpeg: ok (${TOOLS.ffmpeg})`, 32);
else {
  say('ffmpeg is missing. VideoHub still lists your films, but it needs ffmpeg to make videos (renders), previews and frame pictures.', 33);
  say('  Install it in Terminal:   brew install ffmpeg      (no Homebrew? https://brew.sh)', 33);
  todo.push('Install ffmpeg (renders need it):  brew install ffmpeg   - then run ./setup.sh again');
}
if (TOOLS.browser) say(`Browser for rendering: ok (${TOOLS.browser})`, 32);
else {
  say('No Google Chrome, Microsoft Edge, Brave or Chromium found. Renders draw every frame in one of them (invisibly), so they need one.', 33);
  say('  Install Chrome:   brew install --cask google-chrome      (or https://www.google.com/chrome)', 33);
  todo.push('Install Chrome (renders use it):  brew install --cask google-chrome   - then run ./setup.sh again');
}
// Claude Code: on PATH, or where its installers put it (the desktop app keeps its own copy under Application Support)
function findClaude() {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...MAC_TOOL_DIRS, path.join(HOME, '.local', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.npm-global', 'bin')];
  for (const d of dirs) { const f = path.join(d, 'claude'); try { if (fs.statSync(f).isFile()) return f; } catch { } }
  const root = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code');
  try { for (const v of fs.readdirSync(root).sort().reverse()) { const f = path.join(root, v, 'claude.app', 'Contents', 'MacOS', 'claude'); if (fs.existsSync(f)) return f; } } catch { }
  return null;
}
const claude = findClaude();
if (claude) say(`Claude Code: ok (${claude})`, 32);
else say('Claude Code was not found. VideoHub works without it, but Claude Code is what writes the films: https://claude.com/claude-code (the Claude tools are registered anyway).', 33);

// ---------- 2. packages (inside this folder)
if (DRY) plan(`npm install in ${HUB}`);
else {
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: HUB, stdio: 'inherit' });
  if (r.status !== 0) { say('npm install failed', 31); process.exit(1); }
  say('Packages: ok', 32);
}
// a git clone has nothing to ignore this Mac's own files: keep them out of git in the clone itself
const gitInfo = path.join(HUB, '.git', 'info');
if (fs.existsSync(gitInfo) && !fs.existsSync(path.join(HUB, '.gitignore')) && !DRY) {
  const ex = path.join(gitInfo, 'exclude'), have = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8').split('\n') : [];
  const want = ['node_modules/', 'data/', '*.log', '.test-tmp/', 'examples/*/render/', 'examples/*/.videohub/', 'examples/*/node_modules/', '.DS_Store'].filter(x => !have.includes(x));
  if (want.length) fs.appendFileSync(ex, (have.length && have.at(-1) !== '' ? '\n' : '') + want.join('\n') + '\n');
}

// ---------- 3. the workspace, folders found on this Mac and render speed (decided and written by scripts/init-config.mjs)
const st = state();
if (st.error) { say(st.error, 31); process.exit(1); }
let ws = null, watch = [], enc = null;
if (st.installed) say(`\nYour video work lives in: ${st.workspace}  (already set; change single folders in VideoHub > Settings)`, 32);
else {
  console.log(c(97, '\nWhere should your video work live?'));
  say('  One folder holds everything VideoHub makes: your films, every finished video (outputs), sounds, thumbnails');
  say(`  and an archive for old versions. Recommended: ${st.defaultWorkspace}`);
  ws = WORKSPACE || (interactive ? '' : st.defaultWorkspace);
  for (;;) {
    if (!ws) { const a = (await ask('  Press Enter for the recommended folder, or type another full path: ')).replace(/^"(.*)"$/, '$1'); ws = a || st.defaultWorkspace; }
    const why = checkWorkspace(ws);
    if (!why) break;
    say('  ' + why, 33);
    if (WORKSPACE || !interactive) process.exit(1);
    ws = '';
  }
  say(`  Workspace: ${ws}`, 32);
  if (st.discovered.length) {
    console.log(c(97, '\nVideoHub found folders that look like video work:'));
    for (const d of st.discovered) say(`  - ${d.path}`);
    say('  It can list the films in them too (it never moves or changes them). You can also turn them on later in');
    say('  VideoHub > Settings > Watched folders.');
    if (await yesNo('  Watch these folders as well?', A.watch, false)) watch = st.discovered.map(d => d.path);
  }
}
if (st.encoder) say(`Render speed: ${st.encoder} (already set; change it in VideoHub > Settings > Render speed)`, 32);
else if (!haveFfmpeg) { enc = 'auto'; say('Render speed: decided once ffmpeg is installed (run setup again then).', 33); }
else {
  const det = await detectEncoders({ ffmpeg: TOOLS.ffmpeg, cacheFile: DRY ? null : path.join(HUB, 'data', 'encoders.json') });
  const gpu = det.available.filter(e => e !== 'x264');
  if (gpu.length) {
    console.log(c(97, `\nYour Mac (${det.gpus[0] || 'Apple graphics'}) can encode video in hardware.`));
    enc = (await yesNo('  Use it for renders? Same picture quality, usually faster, and your processor stays free.', A.gpu, true)) ? 'auto' : 'x264';
  } else { enc = 'auto'; say('\nRenders will use the processor (no hardware video encoder worked on this Mac).'); }
}
const res = initConfig({ workspace: ws, watch, encoder: enc, dryRun: DRY });
for (const line of res.actions) { if (line.startsWith('would ')) plan(line.slice(6)); else say('  ' + line, 90); }
const wsNow = res.workspace;

// ---------- 4. Claude: the MCP server "videohub" (user scope)
const nodeBin = stableNodePath(), mcp = path.join(HUB, 'server', 'mcp.js');
if (DRY) plan(`register the MCP server: claude mcp add --scope user videohub -- ${nodeBin} "${mcp}"  (or write it into ~/.claude.json)`);
else {
  let ok = false;
  if (claude) {
    run(claude, ['mcp', 'remove', 'videohub', '--scope', 'user']);
    ok = run(claude, ['mcp', 'add', '--scope', 'user', 'videohub', '--', nodeBin, mcp]).code === 0;
  }
  if (!ok) {
    // no CLI: merge into ~/.claude.json ourselves (backup first); a file that is not readable JSON is never replaced
    const cj = path.join(HOME, '.claude.json');
    let j = {}, fine = true;
    if (fs.existsSync(cj)) { fs.copyFileSync(cj, cj + '.videohub-backup'); j = readJson(cj); if (!j || typeof j !== 'object' || Array.isArray(j)) fine = false; }
    if (fine) { j.mcpServers = j.mcpServers || {}; j.mcpServers.videohub = { type: 'stdio', command: nodeBin, args: [mcp], env: {} }; write(cj, JSON.stringify(j, null, 2)); ok = true; }
  }
  if (ok) say('Claude tools (MCP server "videohub") registered; new Claude Code sessions will see the hub_* tools', 32);
  else todo.push(`The MCP server could not be registered: claude mcp add --scope user videohub -- ${nodeBin} "${mcp}"`);
}

// the skill and rule texts were written with Windows paths: {{VIDEOHUB_DIR}}\server\cli.js and <workspace>\films\<name>
const forMac = t => t.replace(/\{\{VIDEOHUB_DIR\}\}((?:\\[\w.-]+)+)/g, (_, rest) => HUB + rest.replace(/\\/g, '/')).replaceAll('{{VIDEOHUB_DIR}}', HUB)
  .replace(/<workspace>\\(\w+)(\\<[\w-]+>)?/g, (_, a, b) => `<workspace>/${a}${b ? b.replace('\\', '/') : ''}`).replace(/C:\\\\path\\\\to\\\\film/g, '/path/to/film');

// ---------- 5. the skill Claude reads (~/.claude/skills/videohub), with this install's path filled in
const claudeHome = path.join(HOME, '.claude'), sk = path.join(claudeHome, 'skills', 'videohub');
if (DRY) plan(`copy skill/videohub to ${sk} (with {{VIDEOHUB_DIR}} = ${HUB})`);
else {
  fs.mkdirSync(sk, { recursive: true });
  for (const f of fs.readdirSync(path.join(HUB, 'skill', 'videohub'))) fs.writeFileSync(path.join(sk, f), forMac(fs.readFileSync(path.join(HUB, 'skill', 'videohub', f), 'utf8')));
  say(`Skill installed: ${sk}`, 32);
}

// ---------- 6. the global rule: every Claude Code session reviews films in VideoHub before rendering.
//    Kept between marker lines in ~/.claude/CLAUDE.md, replaced on the next run, removed by uninstall.sh.
const cm = path.join(claudeHome, 'CLAUDE.md');
const begin = '<!-- videohub:begin (added by VideoHub setup; remove with uninstall.sh) -->', end = '<!-- videohub:end -->';
const rule = forMac(fs.readFileSync(path.join(HUB, 'claude', 'global-rule.md'), 'utf8')).trim();
const cur = fs.existsSync(cm) ? fs.readFileSync(cm, 'utf8') : '';
const rx = new RegExp('<!-- videohub:begin[\\s\\S]*?' + end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
let wantRule = A.rule;
if (wantRule === 'ask' && rx.test(cur)) wantRule = 'yes';                    // added on an earlier run: refreshed, not asked again
else if (wantRule === 'ask' && answers.globalRule === 'no') wantRule = 'no';   // declined on an earlier run
if (wantRule === 'ask') {
  console.log(c(97, '\nShould Claude show you every new film in VideoHub before it renders?'));
  say('  This adds a short rule to your Claude instructions (~/.claude/CLAUDE.md): Claude opens each new film in');
  say("  VideoHub's live preview and waits for your notes before making the video. uninstall.sh removes it again.");
  wantRule = (await yesNo('  Add the rule?', 'ask', true)) ? 'yes' : 'no';
}
answers.globalRule = wantRule;
if (wantRule === 'yes') {
  const block = `${begin}\n${rule}\n${end}`;
  const next = rx.test(cur) ? cur.replace(rx, () => block) : cur.trim() ? cur.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  if (DRY) { plan(`write this block into ${cm} (replacing an older VideoHub block if there is one):`); console.log(c(90, block)); }
  else { if (fs.existsSync(cm)) fs.copyFileSync(cm, cm + '.videohub-backup'); write(cm, next); say(`Global rule added to ${cm} (backup: CLAUDE.md.videohub-backup)`, 32); }
} else say('Global rule skipped (run setup again with --global-rule yes to add it later).');

// ---------- 7. VideoHub.app: an Electron app (a native window around the hub), saved in ~/Applications (--app-dir)
const appDir = path.resolve(val('--app-dir') || path.join(HOME, 'Applications')), appPath = path.join(appDir, 'VideoHub.app');
// ours when its hub.json names this folder; the older launchers of this port (script / Swift, no Electron) are recognised too
const appMine = () => {
  if (appOwnedBy(appPath)) return true;
  const xml = HUB.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const f of ['Info.plist', 'MacOS/VideoHub']) { try { if (fs.readFileSync(path.join(appPath, 'Contents', f), 'latin1').includes(f === 'Info.plist' ? xml : HUB)) return true; } catch { } }
  return false;
};
let wantApp = A.shortcut === 'ask' ? (fs.existsSync(appPath) ? true : answers.shortcut === 'no' ? false : null) : A.shortcut === 'yes';
if (wantApp === null) { console.log(c(97, `\nMake VideoHub an app in ${appDir} (found by Launchpad and Spotlight, with its own Dock icon)?`)); say('  It is built once with Electron: a download of about 150 MB.'); wantApp = await yesNo('  Make the app?', 'ask', true); }
answers.shortcut = wantApp ? 'yes' : 'no';
if (wantApp) {
  if (DRY) plan(`build the Electron app ${appPath} (npm install in electron/, then package it)`);
  else if (fs.existsSync(appPath) && !appMine()) say(`${appPath} exists and is not VideoHub's: left alone.`, 33);
  else {
    try { say(`VideoHub app: ${await buildApp(appDir, { log: m => say(m, 90) })}`, 32); }
    catch (e) { say(`The VideoHub app could not be built: ${e.message}`, 33); todo.push('Build the app again with:  node scripts/build-mac-app.mjs   (VideoHub itself works without it: ./open.sh opens it in your browser)'); wantApp = false; }
  }
}

// ---------- 8. start at login: off unless chosen (it can also be switched on later on VideoHub's Renders page)
const agent = launchAgentFile();
let wantRun = A.startup === 'ask' ? (fs.existsSync(agent) ? true : answers.startup ? answers.startup === 'yes' : null) : A.startup === 'yes';
if (wantRun === null) { console.log(c(97, "\nVideoHub can start quietly when you log in (no window), so Claude's tools and the render queue are always ready.")); wantRun = await yesNo('  Start VideoHub at login?', 'ask', false); }
answers.startup = wantRun ? 'yes' : 'no';
if (wantRun) {
  if (DRY) plan(`add the login item ${agent}`);
  else { write(agent, launchAgentPlist(HUB)); say('VideoHub starts at login (server only, no window; from the next login on)', 32); }
}

// ---------- 9. the example film: a 10-second film that shows the whole loop (the same copy as the Welcome panel's button)
const exDest = path.join(wsNow, 'films', 'hello-film'), exHave = fs.existsSync(path.join(exDest, 'index.html'));
const wantEx = A.example !== 'ask' ? A.example === 'yes' : (exHave || answers.example) ? false
  : (console.log(c(97, '\nAdd the example film so you can try VideoHub right away? (a 10-second film; delete it whenever you like)')), await yesNo('  Add it?', 'ask', true));
if (!answers.example) answers.example = wantEx || exHave ? 'yes' : 'no';
if (wantEx) {
  if (DRY) plan(`copy examples/hello-film into ${path.join(wsNow, 'films')} (unless it is there already)`);
  else {
    const r = run(process.execPath, [path.join(HUB, 'scripts', 'init-config.mjs'), '--example']);
    let ex = {}; try { ex = JSON.parse(r.out); } catch { ex = { error: r.err || 'no answer' }; }
    if (ex.error) say(`The example film could not be added: ${ex.error}  (the Welcome panel in VideoHub offers it too)`, 33);
    else if (ex.kept) say(`The example film is already there: ${ex.target}`, 32); else say(`Example film added: ${ex.path}`, 32);
  }
}

// ---------- remember the answers (a second run shows them instead of asking)
if (DRY) plan(`remember the answers in ${answersFile}`); else write(answersFile, JSON.stringify(answers, null, 2));
rl?.close();

console.log('');
say('== Done. What now:', 36);
say(`  Your video work lives in  ${wsNow}  (films, outputs, sounds, thumbnails, archive; README.txt says what each is).`);
say(wantApp ? `  Open VideoHub from Launchpad or Spotlight ("VideoHub"), or ${appPath}.` : `  Open VideoHub: run ${path.join(HUB, 'open.sh')} (or double-click OPEN.command, which opens it in your browser).`);
say("  Start a NEW Claude Code session (sessions already open do not see VideoHub's tools).");
say(wantEx || exHave ? '  First thing to try: click the "hello-film" card in VideoHub, press Space to play it, click a frame to leave a note.'
  : '  First thing to try: ask Claude Code "make me a 10-second animated title as a VideoHub film" and watch it appear in VideoHub.');
say('  Notes for a Mac: the first time VideoHub reads Documents or Desktop, macOS asks whether it may; say yes.', 90);
if (DRY) { console.log(''); say('Dry run finished: nothing outside this folder was changed.', 33); }
if (todo.length) { console.log(''); say('Left for you to do:', 33); for (const t of todo) say(' - ' + t, 33); }

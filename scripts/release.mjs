// Publishes a VideoHub release to the Zephyr application that serves updates:   npm run release   (or: node scripts/release.mjs [--notes "text"])
// 1) builds release/ (scripts/make-release.mjs)  2) uploads it with Zephyr's CLI (`zephyr-cli deploy dist`).
// The upload uses YOUR Zephyr login: the first time the CLI opens a browser to sign in. Nothing is uploaded without running this.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notes = process.argv.includes('--notes') ? ['--notes', process.argv[process.argv.indexOf('--notes') + 1]] : [];
let r = spawnSync(process.execPath, [path.join(root, 'scripts', 'make-release.mjs'), ...notes], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
// only release/dist is uploaded (the files the updater downloads); release/ itself holds the git repo and package.json Zephyr reads
fs.mkdirSync(path.join(root, 'release', 'dist'));
for (const f of fs.readdirSync(path.join(root, 'release'))) if (/^(manifest\.json|index\.html|videohub-.*\.tar)$/.test(f)) fs.renameSync(path.join(root, 'release', f), path.join(root, 'release', 'dist', f));
// the upload folder is its own little project so Zephyr names the application "videohub-updates"
fs.writeFileSync(path.join(root, 'release', 'package.json'), JSON.stringify({ name: 'videohub-updates', version: '1.0.0', private: true }, null, 2) + '\n');
// Zephyr names an application from the git repository it runs in: app = package name, project = repo name, organization = repo owner.
// release/ is therefore its own local-only repo whose remote names the Zephyr organization and project that hold "videohub-updates"
// (config below). It is never pushed anywhere.
const ZE_ORG = 'cayden', ZE_PROJECT = 'videohub';
const git = (...a) => spawnSync('git', a, { cwd: path.join(root, 'release'), stdio: 'ignore' }).status;
git('init', '-q'); git('remote', 'add', 'origin', `https://github.com/${ZE_ORG}/${ZE_PROJECT}.git`); git('add', '-A');
git('-c', 'user.name=VideoHub release', '-c', 'user.email=release@localhost', 'commit', '-q', '-m', 'release');
console.log('\nUploading release/ to Zephyr (a browser window may open to sign in)…');
r = spawnSync('npx', ['-y', 'zephyr-cli', 'deploy', 'dist'], { cwd: path.join(root, 'release'), stdio: 'inherit' });
if (r.status !== 0) { console.error('\nThe upload did not finish. The release folder is ready in release/; run `npm run release` again after signing in to Zephyr.'); process.exit(r.status || 1); }
console.log('\nDone. Look at the printed address: that is VideoHub\'s update address (Settings, or videohub.updateUrl in package.json).');

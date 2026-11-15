// Publishes a VideoHub release to the Zephyr application that serves updates:   npm run release   (or: node scripts/release.mjs [--notes "text"])
// 1) builds release/ (scripts/make-release.mjs)  2) uploads it with Zephyr's CLI (`zephyr-cli deploy release`).
// The upload uses YOUR Zephyr login: the first time the CLI opens a browser to sign in. Nothing is uploaded without running this.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notes = process.argv.includes('--notes') ? ['--notes', process.argv[process.argv.indexOf('--notes') + 1]] : [];
let r = spawnSync(process.execPath, [path.join(root, 'scripts', 'make-release.mjs'), ...notes], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
// the upload folder is its own little project so Zephyr names the application "videohub-updates"
fs.writeFileSync(path.join(root, 'release', 'package.json'), JSON.stringify({ name: 'videohub-updates', version: '1.0.0', private: true }, null, 2) + '\n');
console.log('\nUploading release/ to Zephyr (a browser window may open to sign in)…');
r = spawnSync('npx', ['-y', 'zephyr-cli', 'deploy', 'release'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.error('\nThe upload did not finish. The release folder is ready in release/; run `npm run release` again after signing in to Zephyr.'); process.exit(r.status || 1); }
console.log('\nDone. Look at the printed address: that is VideoHub\'s update address (Settings, or videohub.updateUrl in package.json).');

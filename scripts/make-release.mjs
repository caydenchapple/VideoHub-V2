// Builds a release folder for the updater: release/videohub-<version>.tar.gz + release/manifest.json (+ a small index.html).
//   node scripts/make-release.mjs [--notes "what changed"]
// Upload that folder to the Zephyr application with: node scripts/release.mjs   (see docs/UPDATES.md)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE_ITEMS, RELEASE_EXCLUDE } from '../server/updater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'release');
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : ''; };
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const gitNotes = () => { const r = spawnSync('git', ['log', '-5', '--pretty=- %s'], { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const notes = arg('notes') || gitNotes();

fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const file = `videohub-${version}.tar.gz`, tgz = path.join(out, file);
const items = RELEASE_ITEMS.filter(i => fs.existsSync(path.join(root, i)));
const r = spawnSync('tar', ['-czf', tgz, ...RELEASE_EXCLUDE.flatMap(e => ['--exclude', e]), '-C', root, ...items], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
if (r.status !== 0) { console.error('tar failed'); process.exit(1); }
const buf = fs.readFileSync(tgz);
const manifest = { name: 'videohub', version, file, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, date: new Date().toISOString(), notes };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>VideoHub updates</title><p>VideoHub ${version}: <a href="${file}">${file}</a> (<a href="manifest.json">manifest.json</a>)`);
console.log(`Release ${version}: ${path.relative(root, tgz)} (${(buf.length / 1048576).toFixed(1)} MB), sha256 ${manifest.sha256.slice(0, 12)}…`);

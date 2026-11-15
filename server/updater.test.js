import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, readManifest, installFiles } from './updater.js';

test('versions compare numerically, and a pre-release is older than its release', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('v1.0.0-beta', '1.0.0'), -1);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
});
test('a manifest must have a version, a plain tar.gz name next to it and a SHA-256', () => {
  const ok = { version: '0.2.0', file: 'videohub-0.2.0.tar.gz', sha256: 'a'.repeat(64), bytes: 10 };
  assert.equal(readManifest(ok).version, '0.2.0');
  assert.throws(() => readManifest({ ...ok, file: '../evil.tar.gz' }));
  assert.throws(() => readManifest({ ...ok, file: 'https://evil.example/x.tar.gz' }));
  assert.throws(() => readManifest({ ...ok, sha256: 'abc' }));
  assert.throws(() => readManifest({ ...ok, version: 'latest' }));
  assert.throws(() => readManifest(null));
});
test('installing a release replaces code, keeps data and node_modules, and backs up what it replaced', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-upd-'));
  const src = path.join(t, 'src'), dst = path.join(t, 'dst'), bak = path.join(t, 'bak');
  const w = (b, f, s) => { fs.mkdirSync(path.dirname(path.join(b, f)), { recursive: true }); fs.writeFileSync(path.join(b, f), s); };
  w(src, 'server/hub.js', 'new'); w(src, 'server/added.js', 'added'); w(src, 'package.json', '{"version":"2"}'); w(src, 'ui/node_modules/x.js', 'no');
  w(dst, 'server/hub.js', 'old'); w(dst, 'server/gone.js', 'only in old'); w(dst, 'data/config.json', 'mine'); w(dst, 'node_modules/p/i.js', 'pkg');
  const n = installFiles(src, dst, bak);
  assert.ok(n >= 2);
  assert.equal(fs.readFileSync(path.join(dst, 'server/hub.js'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(dst, 'server/added.js'), 'utf8'), 'added');
  assert.equal(fs.readFileSync(path.join(dst, 'server/gone.js'), 'utf8'), 'only in old');
  assert.equal(fs.readFileSync(path.join(dst, 'data/config.json'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(dst, 'node_modules/p/i.js'), 'utf8'), 'pkg');
  assert.equal(fs.readFileSync(path.join(bak, 'server/hub.js'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(dst, 'ui/node_modules')), false);
  fs.rmSync(t, { recursive: true, force: true });
});

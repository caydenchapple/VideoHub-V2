import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitingFor, codeFingerprint } from './live.js';

const make = (root, name, script, extra = {}) => {
  const d = path.join(root, name); fs.mkdirSync(path.join(d, 'web'), { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), '<html><body><script>window.renderOut=()=>{}</script><script src="web/film.js"></script><script src="web/extra.js"></script></body></html>');
  fs.writeFileSync(path.join(d, 'web', 'film.js'), script);
  for (const [f, s] of Object.entries(extra)) fs.writeFileSync(path.join(d, 'web', f), s);
  return { id: name, name, title: name, path: d, outputs: [] };
};

test('an unchanged copy of another film is "waiting" until its code changes; the original and different films are not', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-wait-'));
  const orig = make(root, 'orig', 'draw("suitcase")', { 'extra.js': 'x' });
  await new Promise(r => setTimeout(r, 20));
  const copy = make(root, 'copy', 'draw("suitcase")');           // lacks extra.js, like a half copy; everything it has is identical
  const other = make(root, 'other', 'draw("something else")', { 'extra.js': 'x' });
  const all = [orig, copy, other];
  fs.utimesSync(orig.path, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  assert.ok(codeFingerprint(copy).size >= 2);
  const born = p => fs.statSync(p.path).birthtimeMs;
  // the newer folder is the copy (birth time differs by ~20 ms; skip the order check on file systems with coarse birth times)
  if (born(copy) > born(orig)) {
    assert.equal(waitingFor(copy, all)?.id, 'orig');
    assert.equal(waitingFor(orig, all), null);
  }
  assert.equal(waitingFor(other, all), null);
  fs.writeFileSync(path.join(copy.path, 'web', 'film.js'), 'draw("a new film")');   // Claude rewrote it
  assert.equal(waitingFor(copy, all), null);
  fs.writeFileSync(path.join(copy.path, 'web', 'film.js'), 'draw("suitcase")');
  copy.outputs = [{ rel: 'a.mp4' }];                                                     // once it was rendered it is a film of its own
  assert.equal(waitingFor(copy, all), null);
  fs.rmSync(root, { recursive: true, force: true });
});

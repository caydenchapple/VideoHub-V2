import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCache } from './framecache.js';

test('a cache with no saved pictures never paints (the film draws live) and reports its state', () => {
  const seen = []; const c = createFrameCache({ onChange: i => seen.push(i.state) });
  assert.equal(c.paint(1.5), false); assert.equal(c.shown(), false);
  assert.equal(c.info().state, 'idle'); assert.equal(c.mode, true);
  c.reset(); assert.deepEqual(seen, ['idle']);
});
test('switching it off drops everything and keeps the choice', () => {
  const c = createFrameCache(); assert.equal(c.setMode(false), false); assert.equal(c.mode, false); assert.equal(c.paint(0), false);
  assert.equal(c.setMode(true), true);
});

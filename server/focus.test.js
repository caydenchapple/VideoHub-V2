import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePids, saveFocus, focusConfig, focusState } from './focus.js';

const groups = [
  { name: 'Chrome (browser)', pids: [10, 11, 12] },
  { name: 'Slack', pids: [20] },
  { name: 'Spotify', pids: [30, 31] },
];
test('choosePids takes only the ticked programs and never a protected process', () => {
  assert.deepEqual([...choosePids(groups, ['Slack', 'Spotify']).keys()], [20, 30, 31]);
  assert.deepEqual([...choosePids(groups, ['Chrome (browser)'], new Set([11])).keys()], [10, 12]);   // 11 belongs to the render
  assert.equal(choosePids(groups, []).size, 0);
  assert.equal(choosePids(groups, ['Unknown app']).size, 0);
  assert.equal(choosePids(null, ['Slack']).size, 0);
});
test('saveFocus keeps only valid values and the list is unique and bounded', () => {
  const before = focusConfig();
  try {
    const c = saveFocus({ enabled: true, awake: false, apps: ['Slack', 'Slack', 5, '', 'x'.repeat(200), 'Spotify'], manual: 'yes' });
    assert.equal(c.enabled, true); assert.equal(c.awake, false); assert.equal(c.manual, false);   // 'yes' is not a boolean
    assert.deepEqual(c.apps, ['Slack', 'Spotify']);
    assert.equal(saveFocus({ apps: Array.from({ length: 100 }, (_, i) => 'app' + i) }).apps.length, 60);
    assert.equal(focusState().supported, process.platform === 'darwin');
  } finally { saveFocus({ enabled: before.enabled, awake: before.awake, manual: before.manual, apps: before.apps }); }
});

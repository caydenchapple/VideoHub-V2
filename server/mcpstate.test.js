import test from 'node:test';
import assert from 'node:assert/strict';
import { hello, bye, mcpStatus, sent, waitForSent, waitingCount, hasPending } from './mcpstate.js';

test('a Claude session says hello, shows as connected, and leaves with bye', () => {
  assert.equal(mcpStatus().connected, 0);
  hello({ id: 'a', name: 'claude', pid: 1 }); hello({ id: 'b', pid: 2 });
  assert.equal(mcpStatus().connected, 2); assert.equal(mcpStatus().clients[0].name, 'claude');
  bye('a'); bye('b'); assert.equal(mcpStatus().connected, 0);
});
test('hub_wait_for_notes: a waiting Claude gets the notes the moment they are sent, and counts as listening meanwhile', async () => {
  const w = waitForSent('p1', 5);
  assert.equal(mcpStatus().waiting, 1); assert.equal(waitingCount(), 1);
  sent('p1', [1, 2]);
  assert.deepEqual(await w, { sent: true }); assert.equal(mcpStatus().waiting, 0); assert.equal(hasPending('p1'), false);
});
test('notes sent while nobody listens wait for the next call; another project is not affected; a quiet wait times out', async () => {
  sent('p2', [3]); assert.equal(hasPending('p2'), true);
  assert.deepEqual(await waitForSent('p3', 0.05), { sent: false });   // nothing for p3
  assert.deepEqual(await waitForSent('p2', 5), { sent: true });       // p2 was sent earlier: returns at once, once
  assert.deepEqual(await waitForSent('p2', 0.05), { sent: false });
});

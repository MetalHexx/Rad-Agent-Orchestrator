import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initStage,
  beginNavigate,
  beginLiveReload,
  markIncomingReady,
  settleStage,
  frontFileName,
} from './stage-transition';

test('a navigation keeps the outgoing doc visible until the incoming is ready, then promotes (FR-16, DD-7, DD-8)', () => {
  let s = initStage('A.html');
  s = beginNavigate(s, 'B.html');
  assert.equal(frontFileName(s), 'A.html', 'outgoing stays the foreground while the incoming loads (no white gap)');
  assert.notEqual(s.incoming, null, 'incoming loads into the background slot');
  assert.equal(s.slots[s.incoming!]?.fileName, 'B.html', 'background slot holds the incoming file');
  assert.equal(s.crossfading, false, 'no crossfade until the incoming reports ready');

  s = markIncomingReady(s);
  assert.equal(s.crossfading, true, 'crossfade begins only once the incoming is ready');
  assert.equal(frontFileName(s), 'A.html', 'foreground is unchanged during the fade — incoming fades in on top of it');

  const incomingSlot = s.incoming!;
  s = settleStage(s);
  assert.equal(frontFileName(s), 'B.html', 'incoming is promoted to the foreground once the fade completes');
  assert.equal(s.front, incomingSlot, 'the promoted slot is the SAME physical slot the incoming loaded into (no remount)');
  assert.equal(s.incoming, null, 'no incoming after settle');
  assert.equal(s.crossfading, false, 'crossfade cleared after settle');
  assert.equal(s.slots[incomingSlot === 0 ? 1 : 0], null, 'the outgoing buffer is freed');
});

test('markIncomingReady is idempotent — a repeated ready signal cannot re-trigger promotion (no swap loop)', () => {
  let s = initStage('A.html');
  s = beginNavigate(s, 'B.html');
  const ready1 = markIncomingReady(s);
  const ready2 = markIncomingReady(ready1);
  assert.equal(ready2.front, ready1.front, 'front does not move on a repeated ready signal');
  assert.equal(ready2.incoming, ready1.incoming, 'incoming does not move on a repeated ready signal');
  assert.equal(ready2.crossfading, true, 'still cross-fading, not flipped back');
  // After settle, the incoming is cleared so a stray ready signal is a no-op.
  const settled = settleStage(ready2);
  assert.equal(markIncomingReady(settled), settled, 'a ready signal after settle is a no-op (loop is impossible)');
});

test('two consecutive navigations ping-pong between the two slots (DD-7)', () => {
  let s = initStage('A.html'); // A in slot 0
  s = settleStage(markIncomingReady(beginNavigate(s, 'B.html')));
  const bSlot = s.front;
  assert.notEqual(bSlot, 0, 'B promoted into the other slot, not A\'s slot');
  s = settleStage(markIncomingReady(beginNavigate(s, 'C.html')));
  assert.notEqual(s.front, bSlot, 'C promoted into the slot B vacated — slots alternate');
  assert.equal(frontFileName(s), 'C.html');
});

test('beginNavigate to the current file is a no-op', () => {
  const s = initStage('A.html');
  assert.equal(beginNavigate(s, 'A.html'), s, 'navigating to the already-foreground file changes nothing');
});

test('beginLiveReload loads the same file into the background slot at a new generation, in live mode', () => {
  const s = initStage('A.html');
  const frontSlot = s.front;
  const reloaded = beginLiveReload(s, 'A.html', 1);
  assert.notEqual(reloaded.incoming, null, 'the reload loads into the background slot');
  assert.notEqual(reloaded.incoming, frontSlot, 'the background slot is NOT the foreground slot');
  assert.equal(reloaded.slots[reloaded.incoming!]?.fileName, 'A.html', 'background slot holds the SAME file');
  assert.equal(reloaded.slots[reloaded.incoming!]?.reloadKey, 1, 'background slot carries the new generation');
  assert.equal(reloaded.front, frontSlot, 'the foreground slot is untouched');
  assert.equal(reloaded.slots[frontSlot]?.reloadKey, undefined, 'the foreground layer\'s reloadKey is unaffected');
  assert.equal(reloaded.crossfading, false, 'no crossfade yet — same as a fresh navigation');
  assert.equal(reloaded.mode, 'live', 'a live reload is tagged mode: live, not navigate');
});

test('beginLiveReload is a no-op for a file that is not on the foreground (FR-1)', () => {
  const s = initStage('A.html');
  const reloaded = beginLiveReload(s, 'B.html', 1);
  assert.equal(reloaded, s, 'a live change to a doc that is not on the stage leaves the stage alone');
});

test('beginLiveReload does not clobber an in-flight navigation', () => {
  let s = initStage('A.html');
  s = beginNavigate(s, 'B.html'); // navigation in flight, mode: navigate, incoming !== null
  const reloaded = beginLiveReload(s, 'A.html', 1);
  assert.equal(reloaded, s, 'a live edit arriving mid-navigation does not cancel or corrupt it');
});

test('beginLiveReload can load a fresh generation while a PRIOR live reload is still in flight', () => {
  let s = initStage('A.html');
  s = beginLiveReload(s, 'A.html', 1); // mode: live, incoming !== null
  const reloaded = beginLiveReload(s, 'A.html', 2);
  assert.notEqual(reloaded, s, 'a second live edit is not blocked by an in-flight live reload (only navigations block)');
  assert.equal(reloaded.slots[reloaded.incoming!]?.reloadKey, 2, 'the background slot advances to the newest generation');
});

test('settleStage after a live reload promotes the reloaded slot and frees the outgoing one', () => {
  let s = initStage('A.html');
  const outgoingSlot = s.front;
  s = beginLiveReload(s, 'A.html', 1);
  const incomingSlot = s.incoming!;
  s = markIncomingReady(s);
  s = settleStage(s);
  assert.equal(s.front, incomingSlot, 'the reloaded slot is promoted to the foreground');
  assert.equal(frontFileName(s), 'A.html', 'the promoted slot still holds the same file');
  assert.equal(s.slots[s.front]?.reloadKey, 1, 'the promoted layer keeps its reload generation');
  assert.equal(s.slots[outgoingSlot], null, 'the outgoing buffer is freed');
  assert.equal(s.incoming, null, 'no incoming after settle');
  assert.equal(s.crossfading, false, 'crossfade cleared after settle');
});

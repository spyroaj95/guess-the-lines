import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerLines, pickLines, slotToTake, snapTimes } from '../js/lines.js';

test('scheduled runs take Sunday night and Monday morning, in Eastern time', () => {
  // October is daylight time (UTC-4): the cron runs at 03:45Z / 04:45Z and 12:07Z / 13:07Z.
  assert.equal(slotToTake(new Date('2026-10-12T03:45Z')), 'sun'); // Sun 11:45 PM: on time
  assert.equal(slotToTake(new Date('2026-10-12T04:45Z'), { sun: {} }), null); // Mon 12:45 AM: already have it
  assert.equal(slotToTake(new Date('2026-10-12T04:45Z')), 'sun'); // …unless the 11:45 run never came
  assert.equal(slotToTake(new Date('2026-10-12T12:07Z')), 'mon'); // Mon 8:07 AM
  assert.equal(slotToTake(new Date('2026-10-12T13:07Z'), { mon: {} }), null); // Mon 9:07 AM: already have it
  // December is standard time (UTC-5): the other run of each pair is the on-time one.
  assert.equal(slotToTake(new Date('2026-12-14T03:45Z')), 'sun'); // Sun 10:45 PM: fills in
  assert.equal(slotToTake(new Date('2026-12-14T04:45Z'), { sun: {} }), 'sun'); // Sun 11:45 PM: overwrites
  assert.equal(slotToTake(new Date('2026-12-14T12:07Z')), 'mon'); // Mon 7:07 AM: fills in
  assert.equal(slotToTake(new Date('2026-12-14T13:07Z'), { mon: {} }), 'mon'); // Mon 8:07 AM: overwrites
  // Any other time: nothing.
  assert.equal(slotToTake(new Date('2026-10-14T16:00Z')), null); // Wednesday noon
  assert.equal(slotToTake(new Date('2026-10-12T17:00Z')), null); // Monday 1 PM
});

const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const snaps = {
  sun: { at: '2026-10-12T03:45:00Z', lines: { a: -3, b: 6.5, c: null, d: null } },
  mon: { at: '2026-10-12T12:07:00Z', lines: { a: -3.5, b: null, c: null, d: null } },
};

test('the reveal uses Monday morning, then Sunday night, then the live line', () => {
  const { lines, from } = pickLines(games, snaps, { c: 1, d: null });
  assert.deepEqual(lines, { a: -3.5, b: 6.5, c: 1, d: null });
  assert.deepEqual(from, { a: 'mon', b: 'sun', c: 'live' });
  assert.deepEqual(pickLines(games, null, {}).lines, { a: null, b: null, c: null, d: null }); // no snapshots, nothing live
});

test('a Sunday-night reveal picks up Monday morning, but never overwrites a hand-fixed line', () => {
  const sundayOnly = { sun: snaps.sun };
  const revealed = { games, revealedAt: 1, ...pickLines(games, sundayOnly, { c: 1 }), edited: {} };
  revealed.lineFrom = revealed.from;
  revealed.edited = { b: true };
  assert.equal(newerLines(revealed, sundayOnly), null); // nothing newer yet
  assert.deepEqual(newerLines(revealed, snaps), { a: { line: -3.5, from: 'mon' } }); // b was fixed by hand
  assert.equal(newerLines({ ...revealed, lineFrom: undefined }, snaps), null); // revealed before snapshots existed
  assert.equal(newerLines({ ...revealed, revealedAt: null }, snaps), null); // not revealed yet
});

test('snapshot times', () => {
  assert.deepEqual(snapTimes(snaps), { sun: Date.parse(snaps.sun.at), mon: Date.parse(snaps.mon.at) });
  assert.deepEqual(snapTimes(null), {});
});

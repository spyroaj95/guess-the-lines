import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerLines, pickLines, slotToTake, snapTimes } from '../js/lines.js';

test('scheduled runs take Sunday night and Monday morning, in Eastern time', () => {
  const taken = (iso) => ({ at: iso });
  // October is daylight time (UTC-4).
  assert.equal(slotToTake(new Date('2026-10-12T03:05Z')), 'sun'); // Sun 11:05 PM: first run in the hour takes it
  assert.equal(slotToTake(new Date('2026-10-12T03:45Z'), { sun: taken('2026-10-12T03:05:07Z') }), null); // 11:45 PM: already taken tonight
  assert.equal(slotToTake(new Date('2026-10-12T04:45Z')), 'sun'); // Mon 12:45 AM: fills in if nothing came at 11
  assert.equal(slotToTake(new Date('2026-10-12T12:07Z')), 'mon'); // Mon 8:07 AM
  assert.equal(slotToTake(new Date('2026-10-12T13:07Z'), { mon: taken('2026-10-12T12:07:00Z') }), null); // 9:07 AM: already taken
  assert.equal(slotToTake(new Date('2026-10-12T13:07Z')), 'mon'); // 9:07 AM: fills in
  // December is standard time (UTC-5): nothing is taken before the target hour.
  assert.equal(slotToTake(new Date('2026-12-14T03:45Z')), null); // Sun 10:45 PM: too early
  assert.equal(slotToTake(new Date('2026-12-14T04:05Z')), 'sun'); // Sun 11:05 PM
  assert.equal(slotToTake(new Date('2026-12-14T04:45Z'), { sun: taken('2026-12-14T04:05:07Z') }), null); // 11:45 PM: taken
  assert.equal(slotToTake(new Date('2026-12-14T11:50Z'), { sun: taken('2026-12-14T04:05:07Z') }), null); // Mon 6:50 AM (a late Sunday cron): not Monday's line
  assert.equal(slotToTake(new Date('2026-12-14T12:07Z')), null); // Mon 7:07 AM: too early
  assert.equal(slotToTake(new Date('2026-12-14T13:05Z')), 'mon'); // Mon 8:05 AM
  assert.equal(slotToTake(new Date('2026-12-14T13:20Z'), { mon: taken('2026-12-14T13:05:07Z') }), null); // 8:20 AM: taken
  // Last week's snapshot of the same target week (Super Bowl, offseason) does not count as taken.
  assert.equal(slotToTake(new Date('2027-02-08T04:05Z'), { sun: taken('2027-02-01T04:05:07Z'), mon: taken('2027-02-01T13:05:07Z') }), 'sun');
  assert.equal(slotToTake(new Date('2027-02-08T13:05Z'), { sun: taken('2027-02-08T04:05:07Z'), mon: taken('2027-02-01T13:05:07Z') }), 'mon');
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

test('a Monday snapshot older than the Sunday one is last week\u2019s and is ignored', () => {
  const twoSundays = { sun: { at: '2027-02-08T04:05:00.000Z', lines: { a: -2.5 } }, mon: { at: '2027-02-01T13:05:00.000Z', lines: { a: -1.5 } } };
  assert.deepEqual(pickLines([{ id: 'a' }], twoSundays, {}), { lines: { a: -2.5 }, from: { a: 'sun' } });
});

test('snapshot times', () => {
  assert.deepEqual(snapTimes(snaps), { sun: Date.parse(snaps.sun.at), mon: Date.parse(snaps.mon.at) });
  assert.deepEqual(snapTimes(null), {});
});

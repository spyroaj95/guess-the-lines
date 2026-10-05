import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeLine, parseEvent, weekId } from '../js/espn.js';

const events = JSON.parse(readFileSync(new URL('./espn-week3-fixture.json', import.meta.url)));

test('home line follows ESPN details, whichever team is favored', () => {
  assert.equal(homeLine({ details: 'BUF -7', spread: -7 }, 'BUF', 'LAC'), -7);
  assert.equal(homeLine({ details: 'CAR -1.5', spread: 1.5 }, 'CLE', 'CAR'), 1.5);
  assert.equal(homeLine({ details: 'EVEN', spread: 0 }, 'NYG', 'TEN'), 0);
  assert.equal(homeLine({ details: '', spread: 2.5 }, 'DEN', 'LAR'), 2.5); // falls back to spread
  assert.equal(homeLine({}, 'DEN', 'LAR'), null);
});

test('parses real ESPN events (Week 3 fixture)', () => {
  const byName = Object.fromEntries(events.map((e) => [e.shortName, parseEvent(e)]));
  const buf = byName['LAC @ BUF'];
  assert.equal(buf.home.abbr, 'BUF');
  assert.equal(buf.away.abbr, 'LAC');
  assert.equal(buf.line, -7);
  assert.equal(buf.lineSource, 'DraftKings');
  assert.equal(byName['CAR @ CLE'].line, 1.5);
  assert.equal(byName['ATL @ GB'].line, null); // finished games drop their odds
});

test('week ids sort chronologically', () => {
  const ids = [weekId(2026, 3, 1), weekId(2026, 2, 10), weekId(2026, 2, 3)].sort();
  assert.deepEqual(ids, ['2026-2-03', '2026-2-10', '2026-3-01']);
});

test('parses venue, TV and neutral site (Week 4 fixture: London and TNF)', () => {
  const venues = JSON.parse(readFileSync(new URL('./espn-week4-venues-fixture.json', import.meta.url)));
  const byName = Object.fromEntries(venues.map((e) => [e.shortName, parseEvent(e)]));
  const london = byName['IND VS WSH'];
  assert.equal(london.neutral, true);
  assert.equal(london.note, 'NFL London Games');
  assert.deepEqual(london.venue, { city: 'London', country: 'England' });
  assert.equal(london.tv, 'NFL Net');
  const tnf = byName['PIT @ CLE'];
  assert.equal(tnf.neutral, false);
  assert.equal(tnf.note, '');
  assert.equal(tnf.venue.country, 'USA');
  assert.equal(tnf.tv, 'Prime Video');
});

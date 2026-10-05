import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameBadges, internationalCity } from '../js/util.js';

// Kickoffs are UTC, the way ESPN sends them; labels go by Eastern time.
const labels = (kickoff, extra = {}) => gameBadges({ kickoff, ...extra }).map((b) => b.label);
const abroad = (city, country, note) => ({ venue: { city, country }, note });

test('night windows go by Eastern time', () => {
  assert.deepEqual(labels('2026-10-09T00:15Z'), ['TNF']); // Thu 8:15 PM ET
  assert.deepEqual(labels('2026-10-12T00:20Z'), ['SNF']); // Sun 8:20 PM ET
  assert.deepEqual(labels('2026-10-13T00:15Z'), ['MNF']); // Mon 8:15 PM ET
  assert.deepEqual(labels('2026-10-11T17:00Z'), []); // Sun 1:00 PM ET
  assert.deepEqual(labels('2026-12-20T01:20Z'), []); // Sat 8:20 PM ET
  assert.deepEqual(labels('2026-09-10T00:20Z'), []); // the Wednesday opener
  assert.deepEqual(labels('2027-01-10T05:00Z', abroad('Orchard Park', 'USA', 'Flex Game: 1/9 or 1/10')), []); // time TBD
});

test('holidays beat the night label', () => {
  assert.deepEqual(labels('2026-11-26T18:00Z'), ['Thanksgiving']);
  assert.deepEqual(labels('2026-11-27T01:20Z'), ['Thanksgiving']); // the night game
  assert.deepEqual(labels('2026-11-27T20:00Z'), ['Black Friday']);
  assert.deepEqual(labels('2026-12-26T01:15Z'), ['Christmas']); // Christmas night
  assert.deepEqual(labels('2026-12-25T01:15Z'), ['TNF']); // Christmas Eve
});

test('games abroad are marked with the city the league uses', () => {
  assert.deepEqual(labels('2026-10-11T13:30Z', abroad('London', 'England', 'NFL London Games')), ['London']);
  assert.deepEqual(labels('2026-10-25T13:30Z', abroad('Saint-Denis', 'France', 'NFL Paris Game')), ['Paris']);
  assert.deepEqual(labels('2026-11-23T01:20Z', abroad('Mexico City', 'Mexico', 'NFL Mexico City Game')), ['SNF', 'Mexico City']);
  assert.deepEqual(labels('2026-09-11T00:35Z', abroad('Melbourne', 'Australia', 'NFL Melbourne Game')), ['TNF', 'Melbourne']);
  assert.equal(internationalCity(abroad('Rio De Janeiro', 'Brazil', '')), 'Rio De Janeiro'); // no note: venue city
  assert.equal(internationalCity(abroad('Kansas City', 'USA', 'NFL Kickoff Game')), null); // US venue wins
  assert.equal(internationalCity({}), null); // older week snapshots have no venue
});

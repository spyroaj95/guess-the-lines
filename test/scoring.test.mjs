import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreWeek, scoreSeason, miss, isFlip } from '../js/scoring.js';

// Week 3 of 2026: real DraftKings lines (home-team spreads) and the sample guesses
// shown in the design mockups. The mockups say Mike 7, Spyro 6, Nick 2.
const LINES = {
  'LAC@BUF': -7, 'CAR@CLE': 1.5, 'NYJ@DET': -6.5, 'HOU@IND': 1.5, 'KC@MIA': 10,
  'TEN@NYG': -2.5, 'CIN@PIT': 3.5, 'SEA@WSH': 7.5, 'NE@JAX': -3, 'ARI@SF': -7.5,
  'MIN@TB': 1.5, 'BAL@DAL': 3, 'LV@NO': -3.5, 'LAR@DEN': 2.5, 'PHI@CHI': 3.5,
};
const IDS = Object.keys(LINES);
const picks = (arr) => Object.fromEntries(IDS.map((id, i) => [id, arr[i]]));
const week3 = { id: '2026-2-03', games: IDS.map((id) => ({ id })), lines: LINES };
const guesses3 = {
  spyro: { picks: picks([-6.5, -1, -6.5, -2.5, 7, -3, 2.5, 6, -3.5, -9.5, 2.5, 1.5, -3, 3, 6]) },
  mike: { picks: picks([-3, 2.5, -7, 1, 10.5, -1, -1, 7.5, -1, -7, -1, 3, -6, -1, 4]) },
  nick: { picks: picks([-7.5, -2.5, -4, 3, 13, -2.5, 6, 3, -2.5, -10, 3, -1, -2.5, 3.5, 1]) },
};

test('miss and flip basics', () => {
  assert.equal(miss(-6.5, -7), 0.5);
  assert.equal(miss(-1, 1.5), 2.5); // CLE -1 when it was CAR -1.5
  assert.equal(isFlip(-1, 1.5), true);
  assert.equal(isFlip(0, 3), false); // pick'em is never a flip
  assert.equal(isFlip(-3, -7), false);
});

test('week 3 matches the mockups', () => {
  const r = scoreWeek(week3, guesses3);
  const by = Object.fromEntries(r.players.map((p) => [p.playerId, p]));
  assert.deepEqual(r.players.map((p) => p.playerId), ['mike', 'spyro', 'nick']);
  assert.equal(by.mike.won, 7);
  assert.equal(by.spyro.won, 6);
  assert.equal(by.nick.won, 2);
  assert.equal(by.spyro.avg.toFixed(2), '1.43');
  assert.equal(by.mike.avg.toFixed(2), '1.60');
  assert.equal(by.nick.avg.toFixed(2), '2.10');
  assert.deepEqual(r.weekWinners, ['mike']);
  assert.equal(r.bestAvg, by.spyro.avg);
  assert.deepEqual([by.spyro.exact, by.mike.exact, by.nick.exact], [1, 2, 1]);
  assert.deepEqual([by.spyro.flips, by.mike.flips, by.nick.flips], [2, 3, 2]);
  const buf = r.games.find((g) => g.game.id === 'LAC@BUF');
  assert.deepEqual(buf.winners.sort(), ['nick', 'spyro']); // ½ off each, they split it
});

test('games with no line are skipped, missing picks just do not count', () => {
  const wk = { id: 'w', games: [{ id: 'a' }, { id: 'b' }], lines: { a: -3, b: null } };
  const r = scoreWeek(wk, { p1: { picks: { a: -3, b: -7 } }, p2: { picks: { b: 1 } } });
  assert.equal(r.players.length, 1); // p2 only picked the game with no line
  assert.equal(r.players[0].games, 1);
  assert.equal(r.games[1].line, null);
});

test('a three-way tie splits the game in thirds', () => {
  const wk = { id: 'w', games: [{ id: 'a' }], lines: { a: -3 } };
  const r = scoreWeek(wk, { a: { picks: { a: -2 } }, b: { picks: { a: -4 } }, c: { picks: { a: -2 } } });
  const won = Object.fromEntries(r.players.map((p) => [p.playerId, p.won]));
  assert.ok(Math.abs(won.a - 1 / 3) < 1e-9 && Math.abs(won.b - 1 / 3) < 1e-9 && Math.abs(won.c - 1 / 3) < 1e-9);
});

test('season ranks by average miss and is fair to a late joiner', () => {
  const wk1 = { id: '2026-2-01', games: [{ id: 'x' }, { id: 'y' }], lines: { x: -3, y: 7 } };
  const g1 = { spyro: { picks: { x: -3, y: 6 } }, mike: { picks: { x: -1, y: 7.5 } } };
  const g3 = guesses3;
  const s = scoreSeason([{ week: week3, guesses: g3 }, { week: wk1, guesses: g1 }]); // out of order on purpose
  assert.deepEqual(s.byWeek.map((w) => w.week.id), ['2026-2-01', '2026-2-03']);
  const by = Object.fromEntries(s.standings.map((p) => [p.playerId, p]));
  assert.equal(by.nick.weeksPlayed, 1);
  assert.equal(by.nick.firstWeek.id, '2026-2-03');
  assert.equal(by.spyro.games, 17);
  assert.equal(s.standings[0].playerId, 'spyro'); // lowest average miss
  assert.equal(by.spyro.weeksWon, 1); // week 1: 1–1 on games, spyro takes it on average miss
  assert.equal(by.mike.weeksWon, 1); // week 3
  assert.equal(s.best.exact, true);
  assert.equal(s.worst.miss, 4.5);
});

test('the reveal waits for regulars and newcomers, not for a guest who stopped showing up', async () => {
  const { expectedPlayers } = await import('../js/scoring.js');
  const players = {
    spyro: { joinedAt: 100 },
    mike: { joinedAt: 110 },
    nick: { joinedAt: 500 }, // guest, played week 3 only
    kev: { joinedAt: 2000 }, // joined after week 4 was revealed
  };
  const week4 = { id: '2026-2-04', revealedAt: 1500 };
  const lastGuesses = { spyro: { picks: { a: -3 } }, mike: { picks: { a: -1 } } }; // nick skipped week 4
  // Week 5, nobody has picked yet: regulars + the newcomer, not nick.
  assert.deepEqual(expectedPlayers({ players, guesses: {}, lastWeek: week4, lastGuesses }).sort(), ['kev', 'mike', 'spyro']);
  // Nick comes back and starts guessing: now he counts.
  const back = { nick: { picks: { b: 7 } } };
  assert.ok(expectedPlayers({ players, guesses: back, lastWeek: week4, lastGuesses }).includes('nick'));
  // First week ever: everyone counts.
  assert.equal(expectedPlayers({ players, guesses: {}, lastWeek: null, lastGuesses: {} }).length, 4);
});

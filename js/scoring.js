// Pure scoring: no DOM, no network. Picks and lines are HOME-team spreads (see util.js).
//
// The rules, in plain English:
//   • Closest guess to the real line takes the game. Ties split it.
//   • Most games takes the week (tiebreak: lower average miss).
//   • The season is ranked by average miss per game, so someone who joins in Week 6
//     isn't punished for the weeks they weren't around.

export const miss = (pick, line) => Math.abs(pick - line);

// Picked the other team as the favorite. A pick'em on either side is never a flip.
export const isFlip = (pick, line) => pick * line < 0;

const EPS = 1e-9;
const same = (a, b) => Math.abs(a - b) < EPS;

/**
 * @param week    { games: [{ id }], lines: { [gameId]: number|null } }
 * @param guesses { [playerId]: { picks: { [gameId]: number } } }
 */
export function scoreWeek(week, guesses) {
  const ids = Object.keys(guesses || {});
  const tally = Object.fromEntries(
    ids.map((id) => [id, { playerId: id, games: 0, won: 0, missSum: 0, exact: 0, flips: 0 }]),
  );

  const games = (week.games || []).map((game) => {
    const line = week.lines?.[game.id];
    if (line == null) return { game, line: null, cells: [], winners: [] };

    const cells = [];
    for (const id of ids) {
      const pick = guesses[id]?.picks?.[game.id];
      if (pick == null) continue;
      const m = miss(pick, line);
      cells.push({ playerId: id, pick, miss: m, exact: m === 0, flip: isFlip(pick, line), win: false });
    }
    const best = Math.min(...cells.map((c) => c.miss));
    const winners = cells.filter((c) => same(c.miss, best));
    for (const c of cells) {
      const t = tally[c.playerId];
      t.games += 1;
      t.missSum += c.miss;
      if (c.exact) t.exact += 1;
      if (c.flip) t.flips += 1;
      if (winners.includes(c)) {
        c.win = true;
        t.won += 1 / winners.length;
      }
    }
    return { game, line, cells, winners: winners.map((c) => c.playerId) };
  });

  const players = Object.values(tally)
    .filter((t) => t.games > 0)
    .map((t) => ({ ...t, avg: t.missSum / t.games }))
    .sort((a, b) => b.won - a.won || a.avg - b.avg || a.playerId.localeCompare(b.playerId));

  const top = players[0];
  const weekWinners = top
    ? players.filter((p) => same(p.won, top.won) && same(p.avg, top.avg)).map((p) => p.playerId)
    : [];
  const bestAvg = players.length ? Math.min(...players.map((p) => p.avg)) : null;
  return { games, players, weekWinners, bestAvg };
}

/** @param entries [{ week, guesses }] for revealed weeks, any order. */
export function scoreSeason(entries) {
  const sorted = [...entries].sort((a, b) => a.week.id.localeCompare(b.week.id));
  const agg = {};
  const byWeek = [];
  let best = null;
  let worst = null;

  for (const { week, guesses } of sorted) {
    const r = scoreWeek(week, guesses);
    if (!r.players.length) continue;
    byWeek.push({ week, ...r });

    for (const p of r.players) {
      const a = (agg[p.playerId] ||= {
        playerId: p.playerId, games: 0, missSum: 0, won: 0, weeksWon: 0,
        exact: 0, flips: 0, weeksPlayed: 0, firstWeek: week,
      });
      a.games += p.games;
      a.missSum += p.missSum;
      a.won += p.won;
      a.exact += p.exact;
      a.flips += p.flips;
      a.weeksPlayed += 1;
      if (r.weekWinners.includes(p.playerId)) a.weeksWon += 1 / r.weekWinners.length;
    }

    // Best call = the latest exact hit (or the smallest miss if nobody has one yet).
    // Biggest miss = the largest miss, latest one on ties.
    for (const g of r.games) {
      for (const c of g.cells) {
        const rec = { ...c, week, game: g.game, line: g.line };
        if (c.exact) best = rec;
        else if (!best || (!best.exact && c.miss < best.miss)) best = rec;
        if (!worst || c.miss >= worst.miss) worst = rec;
      }
    }
  }

  const standings = Object.values(agg)
    .map((a) => ({ ...a, avg: a.missSum / a.games }))
    .sort((a, b) => a.avg - b.avg || b.won - a.won || a.playerId.localeCompare(b.playerId));

  return { standings, byWeek, best, worst, firstWeekId: byWeek[0]?.week.id ?? null };
}

/**
 * Who the reveal should wait for this week: anyone already guessing, anyone who played the
 * last revealed week, and anyone who joined after it. A guest who played once and hasn't been
 * back stops holding up the reveal; the regulars always count.
 *
 * @param players     { [playerId]: { joinedAt } }
 * @param guesses     this week's guesses
 * @param lastWeek    the most recent revealed week before this one (or null)
 * @param lastGuesses that week's guesses
 */
export function expectedPlayers({ players, guesses, lastWeek, lastGuesses }) {
  const picked = (g, id) => Object.keys(g?.[id]?.picks || {}).length > 0;
  const cutoff = lastWeek?.revealedAt ?? null;
  return Object.keys(players || {}).filter((id) => {
    if (picked(guesses, id) || !lastWeek || picked(lastGuesses, id)) return true;
    const joinedAt = players[id]?.joinedAt;
    return joinedAt == null || cutoff == null || joinedAt > cutoff; // still-pending timestamps count as new
  });
}

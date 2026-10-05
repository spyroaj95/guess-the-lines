// Which lines count. Like the pod, the lines are next week's DraftKings numbers (via ESPN) as of
// Sunday night, updated once more on Monday morning. A GitHub Action takes both snapshots
// (.github/workflows/lines.yml → scripts/snapshot-lines.mjs) and saves them to lines/<weekId>.json.
// The reveal scores against the newest one. Pure functions, no DOM, so they're unit tested.

export const SLOTS = ['sun', 'mon']; // oldest first
const RANK = { live: 0, sun: 1, mon: 2 };
export const SLOT_NAME = { sun: 'Sunday night', mon: 'Monday morning' };

const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

/**
 * Which snapshot a scheduled run should take right now, or null. GitHub's cron is UTC-only, so
 * each slot is scheduled twice to cover daylight saving: the run in the target hour (Sunday 11 PM,
 * Monday 8 AM Eastern) always writes; the other one only fills in if the target run never came.
 */
export function slotToTake(date, have = {}) {
  const p = Object.fromEntries(et.formatToParts(date).map((x) => [x.type, x.value]));
  const day = p.weekday;
  const hour = Number(p.hour) % 24;
  if ((day === 'Sun' && hour >= 21) || (day === 'Mon' && hour < 3)) return (day === 'Sun' && hour === 23) || !have.sun ? 'sun' : null;
  if (day === 'Mon' && hour >= 6 && hour < 12) return hour === 8 || !have.mon ? 'mon' : null;
  return null;
}

const newest = (snaps, gameId) => [...SLOTS].reverse().find((s) => snaps?.[s]?.lines?.[gameId] != null);

/**
 * The line for each game at the reveal: Monday morning's, else Sunday night's, else whatever ESPN
 * shows right now (a game that was off the board when the snapshots ran).
 * @returns { lines: {gameId: number|null}, from: {gameId: 'mon'|'sun'|'live'} }
 */
export function pickLines(games, snaps, live = {}) {
  const lines = {};
  const from = {};
  for (const g of games) {
    const slot = newest(snaps, g.id);
    if (slot) {
      lines[g.id] = snaps[slot].lines[g.id];
      from[g.id] = slot;
    } else if (live[g.id] != null) {
      lines[g.id] = live[g.id];
      from[g.id] = 'live';
    } else lines[g.id] = null;
  }
  return { lines, from };
}

/**
 * After a Sunday-night reveal, Monday morning's snapshot replaces the older lines. Lines someone
 * fixed by hand stay put. Only weeks revealed with snapshots in mind (they have lineFrom) change.
 * @returns {gameId: {line, from}} or null when nothing is newer
 */
export function newerLines(week, snaps) {
  if (!week?.revealedAt || !week.lineFrom) return null;
  const out = {};
  for (const g of week.games || []) {
    if (week.edited?.[g.id]) continue;
    const slot = newest(snaps, g.id);
    if (slot && RANK[slot] > (RANK[week.lineFrom[g.id]] ?? -1)) out[g.id] = { line: snaps[slot].lines[g.id], from: slot };
  }
  return Object.keys(out).length ? out : null;
}

// When the snapshots behind a week's lines were taken, for "Lines as of …".
export function snapTimes(snaps) {
  return Object.fromEntries(SLOTS.filter((s) => snaps?.[s]?.at).map((s) => [s, Date.parse(snaps[s].at)]));
}

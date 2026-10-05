// NFL schedule + real lines from ESPN's public scoreboard. No API key, and it sends
// `Access-Control-Allow-Origin: *`, so a static site can call it straight from the browser.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const cache = new Map();

function getJSON(url, { fresh = false } = {}) {
  if (!fresh && cache.has(url)) return cache.get(url);
  const p = fetch(fresh ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}` : url, { cache: 'no-store' }).then(
    (r) => {
      if (!r.ok) throw new Error(`ESPN responded ${r.status}`);
      return r.json();
    },
  );
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

export const weekId = (season, type, week) => `${season}-${type}-${String(week).padStart(2, '0')}`;

// Regular season (type 2) and playoffs (type 3), minus the Pro Bowl.
export async function loadCalendar() {
  const d = await getJSON(BASE);
  const season = d.season.year;
  const weeks = [];
  for (const ct of d.leagues?.[0]?.calendar || []) {
    const type = Number(ct.value);
    if (type !== 2 && type !== 3) continue;
    for (const e of ct.entries || []) {
      if (/pro bowl/i.test(e.label)) continue;
      const week = Number(e.value);
      weeks.push({
        id: weekId(season, type, week), season, type, week,
        label: e.label, short: e.alternateLabel || e.label, start: e.startDate, end: e.endDate,
      });
    }
  }
  return { season, weeks };
}

export async function loadWeek(w, opts) {
  const d = await getJSON(`${BASE}?seasontype=${w.type}&week=${w.week}&dates=${w.season}`, opts);
  return (d.events || [])
    .map(parseEvent)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
}

export function parseEvent(e) {
  const c = e.competitions[0];
  const home = c.competitors.find((t) => t.homeAway === 'home');
  const away = c.competitors.find((t) => t.homeAway === 'away');
  const team = (t) => ({
    abbr: t.team.abbreviation,
    name: t.team.shortDisplayName || t.team.name,
    color: t.team.color ? `#${t.team.color}` : null,
  });
  const odds = (c.odds || [])[0];
  const venue = c.venue?.address || {};
  return {
    id: String(e.id),
    kickoff: e.date,
    state: e.status?.type?.state || 'pre',
    home: team(home),
    away: team(away),
    venue: { city: venue.city || '', country: venue.country || '' },
    neutral: Boolean(c.neutralSite),
    note: (c.notes || []).map((n) => n.headline).find(Boolean) || '',
    tv: (c.broadcasts || []).flatMap((b) => b.names || [])[0] || '',
    line: odds ? homeLine(odds, home.team.abbreviation, away.team.abbreviation) : null,
    lineSource: odds?.provider?.name || null,
  };
}

// "CAR -1.5" with CAR away → +1.5 (home line). Falls back to ESPN's own `spread`.
export function homeLine(o, home, away) {
  const d = String(o.details || '').trim();
  if (/^(even|pk|pick)/i.test(d)) return 0;
  const m = d.match(/^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/);
  if (m) {
    const n = Math.abs(parseFloat(m[2]));
    if (m[1] === home) return n === 0 ? 0 : -n;
    if (m[1] === away) return n;
  }
  return typeof o.spread === 'number' ? o.spread : null;
}

// The pod's rhythm: guess the next week whose first game hasn't kicked off yet.
export async function targetWeek(cal, now = Date.now()) {
  const i = cal.weeks.findIndex((w) => Date.parse(w.end) > now);
  if (i === -1) return cal.weeks[cal.weeks.length - 1];
  const games = await loadWeek(cal.weeks[i]);
  const first = games.length ? Math.min(...games.map((g) => Date.parse(g.kickoff))) : Infinity;
  return first > now ? cal.weeks[i] : cal.weeks[i + 1] || cal.weeks[i];
}

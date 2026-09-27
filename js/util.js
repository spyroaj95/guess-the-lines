// Shared helpers. Every spread in this app is a HOME-team line, the same convention as
// ESPN's `spread` field: negative = home favored, positive = away favored, 0 = pick'em.

export const MINUS = '−';

export function num(n) {
  const r = Math.round(n * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// "BUF −6.5", "PK", or "—" when there is no line.
export function lineText(game, hs) {
  if (hs == null) return '—';
  if (hs === 0) return 'PK';
  return `${hs < 0 ? game.home.abbr : game.away.abbr} ${MINUS}${num(Math.abs(hs))}`;
}

// Games won can be split two or three ways on ties.
export function wins(n) {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  const halves = Math.round(r * 2) / 2;
  return Math.abs(halves - r) < 0.01 ? halves.toFixed(1) : r.toFixed(1);
}

export const avg = (n) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(1));

export function slug(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'player'
  );
}

export function randomKey(len = 20) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
export const kickoff = (iso) => dayTime.format(new Date(iso)).toUpperCase();
export const stamp = (ms) => dayTime.format(new Date(ms));

export function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
// "Oct 1 – 5" for a week's first and last kickoff.
export function dateRange(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  try {
    return monthDay.formatRange(a, b);
  } catch {
    return `${monthDay.format(a)} – ${monthDay.format(b)}`;
  }
}

export const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

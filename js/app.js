import { firebaseConfig } from './config.js';
import { LocalStore, createFirestoreStore } from './store.js';
import * as espn from './espn.js';
import { expectedPlayers, scoreSeason, scoreWeek } from './scoring.js';
import { morphInto } from './morph.js';
import { MINUS, avg, dateRange, esc, initials, kickoff, lineText, listNames, num, randomKey, slug, stamp, wins } from './util.js';

const main = document.getElementById('main');
const foot = document.getElementById('foot');
const sheetEl = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

const svg = (paths, size, width, stroke = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', 21, 1.8),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>', 21, 1.8),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 20h8"/>', 21, 1.8),
  minus: svg('<path d="M5 12h14"/>', 16, 2.5),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16, 2.4),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 18, 2.2),
  right: svg('<path d="M9 5l7 7-7 7"/>', 18, 2.2),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 12, 3.2),
  checkSm: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 11, 3.2, '#34D399'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>', 17, 2),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>', 17, 2),
  target:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="#34D399"/></svg>',
};
const MARK =
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#19202b"/><text x="32" y="40" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="26" fill="#fbbf24">−3</text><rect x="18" y="46" width="28" height="4" rx="2" fill="#34d399"/></svg>';

// ---------------------------------------------------------------- state

const S = {
  live: Boolean(firebaseConfig),
  key: null,
  store: null,
  meId: null,
  players: {},
  weeks: {}, // every week doc in the league, keyed by id
  cal: null, // ESPN calendar
  tab: 'week',
  // This week
  weekIdx: -1,
  week: undefined, // undefined = loading, null = nobody has started this week
  guesses: {},
  liveGames: null,
  myPicks: {},
  saveTimer: null,
  saving: false,
  // Results + season
  resId: null,
  resWeek: undefined,
  resGuesses: {},
  season: null,
  seasonToken: 0,
  guessCache: {}, // revealed weeks' guesses, for deciding who the reveal waits on
  justRevealed: null,
  // UI
  sheet: null,
  sheetTimer: null,
  busy: null,
  error: null,
  unsub: {},
};

const meKey = () => `gtl:me:${S.key}`;
const curWeek = () => S.cal?.weeks[S.weekIdx];
const weekGames = () => S.week?.games || S.liveGames || [];
const joined = () => Boolean(S.meId && S.players[S.meId]);
const myGuess = () => S.guesses[S.meId];
const nameOf = (id) => S.players[id]?.name || S.guesses[id]?.name || S.resGuesses[id]?.name || id;
const canEdit = () => joined() && S.week !== undefined && !S.week?.revealedAt && !myGuess()?.lockedAt;
const weekTitle = (w) => (!w ? '' : w.type === 3 ? w.short : `Week ${w.week}`);
const shortWeek = (w) => (!w ? '' : w.type === 3 ? w.short : `Wk ${w.week}`);
const inviteUrl = () => `${location.origin}${location.pathname}#k=${S.key}`;
const revealedIds = () =>
  Object.values(S.weeks)
    .filter((w) => w.revealedAt)
    .map((w) => w.id)
    .sort();
const haptic = (pattern = 8) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported (iOS) */
  }
};

function sortedPlayers() {
  return Object.keys(S.players).sort((a, b) =>
    a === S.meId ? -1 : b === S.meId ? 1 : (S.players[a].joinedAt || 0) - (S.players[b].joinedAt || 0) || a.localeCompare(b),
  );
}

// ---------------------------------------------------------------- boot

async function boot() {
  S.key = S.live ? readLeagueKey() : 'demo';
  if (!S.key) return renderLanding();
  render();
  S.store = S.live ? await createFirestoreStore(firebaseConfig, S.key) : new LocalStore(S.key);
  S.store.touchLeague();
  S.meId = localStorage.getItem(meKey());

  S.store.watchPlayers((players) => {
    S.players = players;
    if (!joined() && S.sheet?.type !== 'join') openSheet({ type: 'join' });
    render();
  });
  S.store.watchWeeks((list) => {
    S.weeks = Object.fromEntries(list.map((w) => [w.id, w]));
    if (S.tab === 'results') ensureResults();
    if (S.tab === 'season') loadSeason();
    render();
  });

  S.cal = await espn.loadCalendar();
  const target = await espn.targetWeek(S.cal);
  await openWeek(S.cal.weeks.findIndex((w) => w.id === target.id));
}

function readLeagueKey() {
  const m = location.hash.match(/k=([a-z0-9]{16,40})/i);
  if (m) {
    localStorage.setItem('gtl:league', m[1]);
    return m[1];
  }
  const saved = localStorage.getItem('gtl:league');
  if (saved) history.replaceState(null, '', `#k=${saved}`);
  return saved;
}

function useLeague(key) {
  localStorage.setItem('gtl:league', key);
  location.hash = `k=${key}`;
  location.reload();
}

// ---------------------------------------------------------------- this week

async function openWeek(idx) {
  if (!S.cal || idx < 0 || idx >= S.cal.weeks.length) return;
  await flushNow();
  const w = S.cal.weeks[idx];
  S.unsub.week?.();
  S.unsub.guesses?.();
  Object.assign(S, { weekIdx: idx, week: undefined, guesses: {}, liveGames: null, myPicks: {}, error: null });
  render();
  S.unsub.week = S.store.watchWeek(w.id, (doc) => {
    S.week = doc;
    render();
  });
  S.unsub.guesses = S.store.watchGuesses(w.id, (g) => {
    S.guesses = g;
    syncMyPicks();
    render();
  });
  try {
    const games = await espn.loadWeek(w);
    if (curWeek()?.id === w.id) S.liveGames = games;
  } catch (err) {
    console.error(err);
    if (curWeek()?.id === w.id) S.error = 'Couldn’t load the schedule from ESPN. Check your connection and try again.';
  }
  render();
}

function syncMyPicks() {
  if (S.saveTimer || S.saving) return; // don't stomp on edits that haven't saved yet
  S.myPicks = { ...(myGuess()?.picks || {}) };
}

function tapTeam(gameId, side) {
  const cur = S.myPicks[gameId];
  const mag = cur == null || cur === 0 ? 3 : Math.abs(cur);
  setPick(gameId, side === 'home' ? -mag : mag);
}

function step(gameId, delta) {
  const cur = S.myPicks[gameId];
  if (cur == null || cur === 0) return;
  const mag = Math.min(30, Math.max(0, Math.abs(cur) + delta));
  setPick(gameId, mag === 0 ? 0 : cur < 0 ? -mag : mag);
}

function setPick(gameId, value) {
  if (!canEdit()) return;
  haptic(6);
  S.myPicks = { ...S.myPicks, [gameId]: value };
  render();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushPicks, 400);
}

async function flushPicks() {
  clearTimeout(S.saveTimer);
  S.saveTimer = null;
  const w = curWeek();
  if (!w || !S.meId) return;
  const pid = S.meId;
  const picks = { ...S.myPicks };
  S.saving = true;
  try {
    await ensureWeekDoc(w);
    await S.store.savePicks(w.id, pid, picks, nameOf(pid));
  } catch (err) {
    console.error(err);
    toast('Couldn’t save your picks. Check your connection.');
  } finally {
    S.saving = false;
  }
}

const flushNow = () => (S.saveTimer ? flushPicks() : Promise.resolve());

async function ensureWeekDoc(w) {
  if (S.week?.id === w.id) return;
  const games = (S.liveGames || []).map(({ id, kickoff: k, home, away }) => ({ id, kickoff: k, home, away }));
  if (!games.length) throw new Error('No games loaded for this week yet.');
  await S.store.ensureWeek(w.id, {
    id: w.id, season: w.season, type: w.type, week: w.week, label: w.label, short: w.short, games,
  });
}

// Revealed weeks' guesses don't change, so fetch each once.
function cachedGuesses(id) {
  if (!id) return {};
  if (!(id in S.guessCache)) {
    S.guessCache[id] = {};
    S.store
      .allGuesses(id)
      .then((g) => {
        S.guessCache[id] = g;
        render();
      })
      .catch(() => delete S.guessCache[id]);
  }
  return S.guessCache[id];
}

// Who hasn't locked yet among the people this week's reveal should wait for (see
// expectedPlayers: regulars and newcomers count, a guest who stopped showing up doesn't).
function waitingOn() {
  const w = curWeek();
  if (!w) return [];
  const prevId = revealedIds().filter((id) => id < w.id).pop() || null;
  return expectedPlayers({
    players: S.players,
    guesses: S.guesses,
    lastWeek: prevId ? S.weeks[prevId] : null,
    lastGuesses: cachedGuesses(prevId),
  }).filter((id) => id !== S.meId && !S.guesses[id]?.lockedAt);
}

async function setLocked(on) {
  const w = curWeek();
  if (!w || !joined()) return;
  if (on) {
    const blank = weekGames().filter((g) => S.myPicks[g.id] == null).length;
    if (blank && !confirm(`${blank} game${blank === 1 ? ' is' : 's are'} still blank. Lock anyway?`)) return;
  }
  await flushNow();
  try {
    await ensureWeekDoc(w);
    await S.store.setLock(w.id, S.meId, on, nameOf(S.meId));
    haptic(on ? 14 : 6);
  } catch (err) {
    console.error(err);
    toast('Couldn’t reach the server. Try again.');
  }
}

async function reveal() {
  const w = curWeek();
  if (!w || !S.week || S.busy) return;
  const waiting = waitingOn().map(nameOf);
  if (
    waiting.length &&
    !confirm(`${listNames(waiting)} ${waiting.length === 1 ? 'hasn’t' : 'haven’t'} locked yet. Once the lines are out nobody else can guess this week. Reveal anyway?`)
  )
    return;
  S.busy = 'reveal';
  render();
  try {
    const fresh = await espn.loadWeek(w, { fresh: true });
    const byId = Object.fromEntries(fresh.map((g) => [g.id, g]));
    const lines = {};
    for (const g of S.week.games) lines[g.id] = byId[g.id]?.line ?? null;
    if (Object.values(lines).every((l) => l == null)) {
      toast('ESPN hasn’t posted lines for these games yet.');
      return;
    }
    const lineSource = fresh.find((g) => g.lineSource)?.lineSource || 'ESPN';
    await S.store.reveal(w.id, { lines, lineSource, lineAsOf: Date.now() });
    haptic([12, 60, 18]);
    S.justRevealed = w.id;
    setTimeout(() => S.justRevealed === w.id && (S.justRevealed = null), 4000);
    S.tab = 'results';
    openResults(w.id);
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    toast('Couldn’t reach ESPN. Try again in a minute.');
  } finally {
    S.busy = null;
    render();
  }
}

// ---------------------------------------------------------------- results + season

function ensureResults() {
  const ids = revealedIds();
  if (!ids.length || (S.resId && ids.includes(S.resId))) return;
  openResults(ids[ids.length - 1]);
}

function openResults(id) {
  if (S.resId === id && S.unsub.resWeek) return render();
  S.unsub.resWeek?.();
  S.unsub.resGuesses?.();
  Object.assign(S, { resId: id, resWeek: undefined, resGuesses: {} });
  S.unsub.resWeek = S.store.watchWeek(id, (d) => {
    S.resWeek = d;
    render();
  });
  S.unsub.resGuesses = S.store.watchGuesses(id, (g) => {
    S.resGuesses = g;
    render();
  });
  render();
}

function stepResults(dir) {
  const ids = revealedIds();
  const next = ids[ids.indexOf(S.resId) + dir];
  if (next) openResults(next);
}

async function loadSeason() {
  const token = ++S.seasonToken;
  try {
    const entries = await Promise.all(
      revealedIds().map(async (id) => ({ week: S.weeks[id], guesses: await S.store.allGuesses(id) })),
    );
    if (token !== S.seasonToken) return;
    S.season = scoreSeason(entries);
  } catch (err) {
    console.error(err);
    if (token === S.seasonToken) S.season = { error: true };
  }
  render();
}

function setTab(tab) {
  if (S.tab === tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  S.tab = tab;
  if (tab === 'results') ensureResults();
  if (tab === 'season') loadSeason();
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- players

async function join(raw, { handoff = false } = {}) {
  const name = String(raw).trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) return;
  const id = slug(name);
  const existed = Boolean(S.players[id]);
  try {
    if (!existed) {
      await S.store.addPlayer({ id, name });
      S.players = { ...S.players, [id]: S.players[id] || { name, joinedAt: Date.now() } };
    }
    await becomePlayer(id);
    if (handoff) toast(existed ? `Switched to ${nameOf(id)}.` : `${name} is in. Tap the gold chip to switch back.`);
  } catch (err) {
    console.error(err);
    toast('Couldn’t add that player. Check your connection.');
  }
}

async function becomePlayer(id) {
  await flushNow();
  S.meId = id;
  localStorage.setItem(meKey(), id);
  S.myPicks = { ...(S.guesses[id]?.picks || {}) };
  haptic(8);
  closeSheet(true);
  render();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('Link copied. Send it to the group chat.');
  } catch {
    document.getElementById('invite-link')?.select();
    toast('Select the link and copy it.');
  }
}

// ---------------------------------------------------------------- sheets + toast

function openSheet(sheet) {
  const wasOpen = Boolean(S.sheet);
  S.sheet = sheet;
  clearTimeout(S.sheetTimer);
  renderSheet(!wasOpen);
  if (wasOpen) return;
  sheetEl.hidden = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      sheetEl.classList.add('is-open');
      sheetEl.querySelector('[autofocus]')?.focus({ preventScroll: true });
    }),
  );
}

function closeSheet(force = false) {
  if (!S.sheet) return;
  if (!force && S.sheet.type === 'join' && !joined()) return;
  S.sheet = null;
  sheetEl.classList.remove('is-open');
  clearTimeout(S.sheetTimer);
  S.sheetTimer = setTimeout(() => {
    if (S.sheet) return;
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
  }, 380);
}

function renderSheet(fresh = false) {
  if (!S.sheet) return;
  const body = { join: joinSheet, add: addSheet, picker: pickerSheet }[S.sheet.type]();
  const html = `<button class="backdrop" data-act="close-sheet" aria-label="Close" tabindex="-1"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div>`;
  if (fresh || !sheetEl.firstElementChild) sheetEl.innerHTML = html;
  else morphInto(sheetEl, html);
}

function openPicker(target, gameId) {
  if (target === 'pick' && !canEdit()) return;
  const cur = target === 'line' ? S.resWeek?.lines?.[gameId] : S.myPicks[gameId];
  const side = cur == null ? null : cur < 0 ? 'home' : cur > 0 ? 'away' : 'pk';
  openSheet({ type: 'picker', target, gameId, side });
}

function applyValue(target, gameId, value) {
  if (target === 'line') {
    haptic(6);
    S.store.setLine(S.resId, gameId, value).catch(() => toast('Couldn’t save that line.'));
  } else setPick(gameId, value);
}

function pickerSide(side) {
  const { target, gameId } = S.sheet;
  if (side === 'pk') {
    applyValue(target, gameId, 0);
    return closeSheet();
  }
  const cur = target === 'line' ? S.resWeek?.lines?.[gameId] : S.myPicks[gameId];
  if (cur != null && cur !== 0) applyValue(target, gameId, side === 'home' ? -Math.abs(cur) : Math.abs(cur));
  S.sheet = { ...S.sheet, side };
  renderSheet();
}

function pickerNum(v) {
  const { target, gameId, side } = S.sheet;
  if (side !== 'away' && side !== 'home') return;
  applyValue(target, gameId, side === 'home' ? -v : v);
  closeSheet();
}

// Swipe a sheet down by its header to dismiss it.
let drag = null;
sheetEl.addEventListener('pointerdown', (e) => {
  const head = e.target.closest('.sheet-head');
  if (!head) return;
  const sheet = head.closest('.sheet');
  drag = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, sheet };
  sheet.setPointerCapture?.(e.pointerId);
  sheet.style.transition = 'none';
});
sheetEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dy = Math.max(0, e.clientY - drag.y0);
  drag.sheet.style.transform = `translateY(${drag.dy}px)`;
});
function endDrag() {
  if (!drag) return;
  const { sheet, dy, t0 } = drag;
  drag = null;
  sheet.style.transition = '';
  sheet.style.transform = '';
  const speed = dy / Math.max(1, performance.now() - t0);
  if (dy > 120 || (dy > 30 && speed > 0.5)) closeSheet();
}
sheetEl.addEventListener('pointerup', endDrag);
sheetEl.addEventListener('pointercancel', endDrag);

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add('is-on')));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-on');
    toastTimer = setTimeout(() => (toastEl.hidden = true), 320);
  }, 2800);
}

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  switch (d.act) {
    case 'team': return tapTeam(d.g, d.side);
    case 'dec': return step(d.g, -0.5);
    case 'inc': return step(d.g, 0.5);
    case 'picker': return openPicker('pick', d.g);
    case 'edit-line': return openPicker('line', d.g);
    case 'picker-side': return pickerSide(d.side);
    case 'picker-num': return pickerNum(Number(d.v));
    case 'lock': return setLocked(true);
    case 'unlock': return setLocked(false);
    case 'reveal': return reveal();
    case 'tab': return setTab(d.tab);
    case 'week-prev': return openWeek(S.weekIdx - 1);
    case 'week-next': return openWeek(S.weekIdx + 1);
    case 'res-prev': return stepResults(-1);
    case 'res-next': return stepResults(1);
    case 'open-results':
      S.tab = 'results';
      openResults(d.id);
      return window.scrollTo({ top: 0 });
    case 'me': return openSheet({ type: 'join' });
    case 'join-as': return becomePlayer(d.id);
    case 'add-player': return openSheet({ type: 'add' });
    case 'copy-link': return copyLink();
    case 'share-link':
      return navigator.share?.({ title: 'Guess the Lines', text: 'Join our Guess the Lines league', url: inviteUrl() }).catch(() => {});
    case 'close-sheet': return closeSheet();
    case 'start-league': return useLeague(randomKey());
    case 'reload': return location.reload();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  const kind = form.dataset.form;
  if (kind === 'join') join(data.get('name') || '');
  if (kind === 'add') join(data.get('name') || '', { handoff: true });
  if (kind === 'invite') {
    const m = String(data.get('link') || '').match(/k=([a-z0-9]{16,40})/i);
    if (m) useLeague(m[1]);
    else toast('That doesn’t look like an invite link.');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) closeSheet();
});
document.addEventListener('visibilitychange', () => document.hidden && flushNow());
window.addEventListener('pagehide', () => flushNow());

// The big title scrolls away; a compact bar takes its place.
let scrollQueued = false;
window.addEventListener(
  'scroll',
  () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      document.body.classList.toggle('is-scrolled', window.scrollY > 110);
    });
  },
  { passive: true },
);

// ---------------------------------------------------------------- rendering

function render() {
  if (S.live && !S.key) return;
  const view = S.tab === 'results' ? viewResults() : S.tab === 'season' ? viewSeason() : viewWeek();
  morphInto(main, (S.live ? '' : '<p class="demo"><b>DEMO MODE</b> · saved on this device only</p>') + view);
  morphInto(foot, (S.tab === 'week' ? dock() : '') + tabBar());
}

const view = (key, html) => `<div class="view" data-key="${esc(key)}">${html}</div>`;
const note = (html, extra = '') => `<div class="note">${html}${extra ? `<div>${extra}</div>` : ''}</div>`;

function top({ title, sub = '', meta = '', pager = null }) {
  const nav = pager
    ? `<div class="pager">
        <button data-act="${pager.prev}" aria-label="${pager.prevLabel}" ${pager.prevOff ? 'disabled' : ''}>${ICON.left}</button>
        <button data-act="${pager.next}" aria-label="${pager.nextLabel}" ${pager.nextOff ? 'disabled' : ''}>${ICON.right}</button>
      </div>`
    : '';
  return `<div class="minibar" aria-hidden="true"><span class="minibar-title">${esc(title)}</span><span class="minibar-meta">${esc(meta)}</span></div>
    <header class="top">
      <div class="brand">${MARK}<span class="brand-name">Guess the Lines</span></div>
      <div class="hero">
        <div><h1 class="title">${esc(title)}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}</div>
        ${nav}
      </div>
    </header>`;
}

function skeleton(rows = 5) {
  const row = '<div class="skel-row"><span class="skel skel-team"></span><span class="skel skel-team"></span><span class="skel skel-step"></span></div>';
  return `<span class="skel skel-slot"></span><div class="panel" aria-label="Loading">${row.repeat(rows)}</div>`;
}

function slotsOf(items, kickoffOf) {
  const out = [];
  for (const it of items) {
    const label = kickoff(kickoffOf(it));
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}
const slotHead = (label, n) => `<h2 class="slot"><span>${esc(label)}</span>${n > 1 ? `<span>${n} games</span>` : ''}</h2>`;

function tabBar() {
  const t = (id, label, icon) =>
    `<button class="tab${S.tab === id ? ' is-on' : ''}" data-act="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
  return `<nav class="tabs" aria-label="Sections">${t('week', 'This week', ICON.pencil)}${t('results', 'Results', ICON.flag)}${t('season', 'Season', ICON.trophy)}</nav>`;
}

function renderLanding() {
  foot.innerHTML = '';
  main.innerHTML = `
    <section class="landing">
      ${MARK}
      <h1 class="title">Guess the Lines</h1>
      <p class="lead">Guess every NFL spread before Vegas posts it. Closest guess takes the game, most games takes the week.</p>
      <button class="btn btn-primary btn-block" data-act="start-league">Start a league</button>
      <p class="fine">Got an invite from a friend? Open their link, or paste it here.</p>
      <form class="form-row" data-form="invite" autocomplete="off">
        <label class="sr" for="invite-in">Invite link</label>
        <input id="invite-in" class="field" name="link" placeholder="Paste invite link">
        <button class="btn" type="submit">Join</button>
      </form>
    </section>`;
}

// ---- This week

function viewWeek() {
  const w = curWeek();
  if (!w) return view('loading', top({ title: 'Loading', sub: 'Getting the NFL schedule…' }) + skeleton());
  const games = weekGames();
  const revealed = Boolean(S.week?.revealedAt);
  const mine = games.filter((g) => S.myPicks[g.id] != null).length;
  const sub = revealed
    ? `Lines revealed ${esc(stamp(S.week.lineAsOf || S.week.revealedAt))} · ${esc(S.week.lineSource || 'ESPN')}`
    : games.length
      ? `${esc(dateRange(games[0].kickoff, games[games.length - 1].kickoff))} · ${games.length} games`
      : '';
  const meta = revealed ? 'LINES OUT' : myGuess()?.lockedAt ? 'LOCKED' : joined() && games.length ? `${mine}/${games.length} SET` : '';
  const head = top({
    title: weekTitle(w), sub, meta,
    pager: {
      prev: 'week-prev', next: 'week-next', prevLabel: 'Previous week', nextLabel: 'Next week',
      prevOff: S.weekIdx <= 0, nextOff: S.weekIdx >= S.cal.weeks.length - 1,
    },
  });
  let body;
  if (S.error && !games.length) body = note(esc(S.error), '<button class="btn" data-act="reload">Try again</button>');
  else if (!games.length) body = S.liveGames ? note('No games this week.') : skeleton();
  else
    body = slotsOf(games, (g) => g.kickoff)
      .map(({ label, items }) => `${slotHead(label, items.length)}<div class="panel">${items.map((g) => gameRow(g, revealed)).join('')}</div>`)
      .join('');
  const hint =
    games.length && joined() && !revealed && !mine && !myGuess()?.lockedAt
      ? '<p class="hint">Tap the team you think is favored, then dial in the number. Nobody sees your lines until the reveal.</p>'
      : '';
  return view(`week-${w.id}`, head + people(games.length) + hint + body);
}

function people(total) {
  const ids = sortedPlayers();
  if (!ids.length) return '';
  const chips = ids.map((id) => {
    const g = S.guesses[id];
    const me = id === S.meId;
    const n = me ? Object.keys(S.myPicks).length : Object.keys(g?.picks || {}).length;
    const locked = Boolean(g?.lockedAt);
    const cls = `person${me ? ' is-me' : ''}${locked ? ' is-locked' : ''}`;
    const inner = `<span class="av">${locked ? ICON.check : esc(initials(nameOf(id)))}</span>${esc(nameOf(id))}${
      locked ? '<span class="sr">, locked</span>' : n && !me ? `<span class="ct">${n}/${total}</span>` : ''
    }`;
    return me
      ? `<button class="${cls}" data-act="me" aria-label="Playing as ${esc(nameOf(id))}${locked ? ', locked' : ''}. Switch player">${inner}</button>`
      : `<span class="${cls}">${inner}</span>`;
  });
  return `<div class="people">${chips.join('')}<button class="add" data-act="add-player" aria-label="Add a player">${ICON.plus}Add</button></div>`;
}

function gameRow(g, revealed) {
  const hs = S.myPicks[g.id];
  const set = hs != null;
  const pk = hs === 0;
  const fav = !set || pk ? null : hs < 0 ? 'home' : 'away';
  const favAbbr = fav ? g[fav].abbr : '';
  const ro = !canEdit();
  const matchup = `${g.away.abbr} at ${g.home.abbr}`;
  const stepOff = ro || !set || pk ? 'disabled' : '';
  // Alternate between two identical keyframes so every change re-triggers the little bump.
  const bump = set ? ((Math.round(Math.abs(hs) * 2) + (fav === 'home' ? 1 : 0)) % 2 ? 'bump-a' : 'bump-b') : '';
  const said = set ? (pk ? 'Pick’em' : `${favAbbr} minus ${num(Math.abs(hs))}`) : 'No pick yet';
  let footRow = '';
  if (revealed) {
    const line = S.week.lines?.[g.id];
    const off = set && line != null ? Math.abs(hs - line) : null;
    footRow = `<div class="row-foot"><span>Line <b>${esc(lineText(g, line))}</b></span>${
      off == null ? '' : off === 0 ? '<span class="good">Exact</span>' : `<span>${num(off)} off</span>`
    }</div>`;
  }
  return `<article class="game" data-key="g-${esc(g.id)}" aria-label="${esc(matchup)}">
      <div class="row">
        ${teamBtn(g, 'away', fav === 'away', ro)}
        <span class="at" aria-hidden="true">@</span>
        ${teamBtn(g, 'home', fav === 'home', ro)}
        <div class="stepper${ro ? ' is-ro' : ''}">
          <button class="step" data-act="dec" data-g="${esc(g.id)}" aria-label="Half a point less on ${esc(matchup)}" ${stepOff}>${ICON.minus}</button>
          <button class="val${set ? ' is-set' : ''}" data-act="picker" data-g="${esc(g.id)}" aria-label="${esc(said)}. Set the spread for ${esc(matchup)}" ${ro ? 'disabled' : ''}>${favAbbr ? `<small>${esc(favAbbr)}</small>` : ''}<b class="${bump}">${set ? (pk ? 'PK' : MINUS + num(Math.abs(hs))) : '—'}</b></button>
          <button class="step" data-act="inc" data-g="${esc(g.id)}" aria-label="Half a point more on ${esc(matchup)}" ${stepOff}>${ICON.plus}</button>
        </div>
      </div>${footRow}
    </article>`;
}

function teamBtn(g, side, on, ro) {
  const t = g[side];
  return `<button class="team${on ? ' is-fav' : ''}" data-act="team" data-g="${esc(g.id)}" data-side="${side}" aria-pressed="${on}" aria-label="${esc(t.name)} favored" ${ro ? 'disabled' : ''}><b>${esc(t.abbr)}</b><small>${esc(t.name)}</small></button>`;
}

function dock() {
  const games = weekGames();
  if (!curWeek() || !games.length || !joined()) return '';
  const set = games.filter((g) => S.myPicks[g.id] != null).length;
  const pct = Math.round((set / games.length) * 100);
  const bar = (txt, buttons, full) =>
    `<div class="dock"><span class="meter${full ? ' is-full' : ''}" style="--p:${full ? 100 : pct}%"></span><div class="dock-txt">${txt}</div>${buttons}</div>`;
  if (S.week?.revealedAt) {
    return bar('<b>Lines are out</b><small>See who was closest.</small>', '<button class="btn btn-primary" data-act="tab" data-tab="results">Results</button>', true);
  }
  if (!myGuess()?.lockedAt) {
    const left = games.length - set;
    return bar(
      `<b>${set}<span class="dim"> of ${games.length}</span></b><small>${left ? `${left} to go` : 'All set. Lock it in.'}</small>`,
      `<button class="btn btn-primary" data-act="lock" ${set ? '' : 'disabled'}>Lock my lines</button>`,
      !left,
    );
  }
  const waiting = waitingOn().map(nameOf);
  const all = !waiting.length;
  const revealBtn =
    S.busy === 'reveal'
      ? '<button class="btn btn-primary" disabled><span class="spinner" aria-hidden="true"></span>Revealing</button>'
      : `<button class="btn${all ? ' btn-primary' : ''}" data-act="reveal">Reveal</button>`;
  return bar(
    `<b>Locked in</b><small>${esc(all ? 'Everyone’s in.' : `Waiting on ${listNames(waiting)}.`)}</small>`,
    `<button class="btn btn-quiet" data-act="unlock">Unlock</button>${revealBtn}`,
    true,
  );
}

// ---- Results

function viewResults() {
  const ids = revealedIds();
  const w = S.resWeek;
  if (!ids.length && !w?.revealedAt) {
    return view(
      'results-empty',
      top({ title: 'Results', sub: 'Nothing revealed yet' }) +
        note('The lines drop once everyone locks in their picks.', '<button class="btn" data-act="tab" data-tab="week">Make your picks</button>'),
    );
  }
  const i = ids.indexOf(S.resId);
  const pager = {
    prev: 'res-prev', next: 'res-next', prevLabel: 'Earlier week', nextLabel: 'Later week',
    prevOff: i <= 0, nextOff: i === -1 || i >= ids.length - 1,
  };
  if (!w) return view(`results-${S.resId}`, top({ title: 'Results', sub: 'Loading…', pager }) + skeleton(4));

  const r = scoreWeek(w, S.resGuesses);
  const sub = `Lines as of ${esc(stamp(w.lineAsOf || w.revealedAt))} · ${esc(w.lineSource || 'ESPN')}`;
  const head = top({ title: weekTitle(w), sub, meta: 'RESULTS', pager });
  if (!r.players.length) return view(`results-${w.id}`, head + note('Nobody guessed this week.'));

  // Right after a reveal, the board fills in one game at a time, like Sal reading them out.
  const fresh = S.justRevealed === w.id;
  let n = 0;
  const anim = () => (fresh ? { cls: ' enter', style: ` style="--i:${n++}"` } : { cls: '', style: '' });

  const tiles = r.players
    .map((p) => {
      const win = r.weekWinners.includes(p.playerId);
      const best = !win && r.players.length > 1 && Math.abs(p.avg - r.bestAvg) < 1e-9;
      const a = anim();
      return `<div class="tile${win ? ' is-win' : ''}${p.playerId === S.meId ? ' is-me' : ''}${a.cls}"${a.style}>
          <div class="tile-name">${esc(nameOf(p.playerId))}</div>
          <div class="tile-num">${wins(p.won)}</div>
          <div class="tile-cap">games won</div>
          <div class="tile-cap mono">${avg(p.avg)} avg off</div>
          ${win ? '<span class="tag tag-green">Winner</span>' : best ? '<span class="tag tag-amber">Best avg</span>' : ''}
        </div>`;
    })
    .join('');
  const order = r.players.map((p) => p.playerId);
  const groups = slotsOf(r.games, (gr) => gr.game.kickoff)
    .map(({ label, items }) => `${slotHead(label, items.length)}<div class="panel">${items.map((gr) => resultRow(w, gr, order, anim())).join('')}</div>`)
    .join('');
  return view(`results-${w.id}`, `${head}<div class="board">${tiles}</div>${groups}`);
}

function resultRow(w, { game: g, line, cells }, order, a) {
  const byId = Object.fromEntries(cells.map((c) => [c.playerId, c]));
  const edited = w.edited?.[g.id];
  const cellHtml = order
    .map((id) => {
      const c = byId[id];
      const me = id === S.meId ? ' is-me' : '';
      if (!c) return `<div class="cell is-empty${me}"><div class="cell-name">${esc(nameOf(id))}</div><div class="cell-pick">—</div><div class="cell-off">no pick</div></div>`;
      const off = c.exact ? `<div class="cell-off exact">${ICON.target}Exact</div>` : `<div class="cell-off">${num(c.miss)} off</div>`;
      return `<div class="cell${c.win ? ' is-win' : ''}${me}">
          <div class="cell-name">${esc(nameOf(id))}${c.win ? ICON.checkSm : ''}</div>
          <div class="cell-pick">${esc(lineText(g, c.pick))}</div>
          ${off}${c.flip ? '<div class="flag">Wrong side</div>' : ''}
        </div>`;
    })
    .join('');
  return `<article class="result${a.cls}"${a.style} data-key="r-${esc(g.id)}">
      <div class="result-top">
        <div class="matchup">${esc(g.away.abbr)}<i>@</i>${esc(g.home.abbr)}</div>
        <button class="line${edited ? ' is-edited' : ''}" data-act="edit-line" data-g="${esc(g.id)}" aria-label="Line ${esc(lineText(g, line))}${edited ? ', edited' : ''}. Tap to fix it"><small>${edited ? 'Edited' : 'Line'}</small><b>${esc(lineText(g, line))}</b></button>
      </div>
      ${line == null ? '<p class="noline">ESPN had no line for this one. Tap the line to add it.</p>' : `<div class="cells">${cellHtml}</div>`}
    </article>`;
}

// ---- Season

function viewSeason() {
  const ids = revealedIds();
  const last = ids.length ? S.weeks[ids[ids.length - 1]] : null;
  const year = S.cal?.season || '';
  const head = top({ title: 'Season', sub: last ? `${year} · through ${esc(shortWeek(last))}` : `${year} standings`, meta: String(year) });
  if (!S.season) return view('season', head + skeleton(3));
  if (S.season.error) return view('season', head + note('Couldn’t load the season.', '<button class="btn" data-act="reload">Try again</button>'));
  const { standings, byWeek, best, worst, firstWeekId } = S.season;
  if (!standings.length) return view('season', head + note('Standings show up after the first reveal.'));

  const lead = standings[0];
  const leader = `<div class="leader">
      <div>
        <div class="eyebrow">Season leader</div>
        <div class="leader-name">${esc(nameOf(lead.playerId))}</div>
        <div class="leader-cap">Closest to Vegas on a typical game</div>
      </div>
      <div><div class="leader-num">${avg(lead.avg)}</div><div class="leader-unit">pts off / game</div></div>
    </div>`;

  const rows = standings
    .map((s, i) => {
      const since = s.firstWeek.id !== firstWeekId ? `<span class="td-since">since ${esc(shortWeek(s.firstWeek))}</span>` : '';
      return `<div class="trow${i === 0 ? ' is-lead' : ''}${s.playerId === S.meId ? ' is-me' : ''}" role="row">
        <span class="td-rank" role="cell">${i + 1}</span>
        <span class="td-name" role="cell">${esc(nameOf(s.playerId))}${since}</span>
        <span class="td td-avg" role="cell">${avg(s.avg)}</span>
        <span class="td" role="cell">${wins(s.won)}</span>
        <span class="td" role="cell">${wins(s.weeksWon)}</span>
        <span class="td" role="cell">${s.exact}</span>
        <span class="td" role="cell">${s.flips}</span>
      </div>`;
    })
    .join('');
  const table = `<div class="table" role="table" aria-label="Season standings">
      <div class="trow" role="row">
        <span class="th" role="columnheader">#</span><span class="th" role="columnheader">Player</span>
        <span class="th" role="columnheader">Avg off</span><span class="th" role="columnheader">Games</span>
        <span class="th" role="columnheader">Weeks</span><span class="th" role="columnheader">Exact</span>
        <span class="th" role="columnheader">Flips</span>
      </div>${rows}
    </div>`;
  const explain = `<p class="explain"><b>Avg off</b> is how far your guess landed from the real line on a typical game, so lower wins.
    <b>Games</b> counts the times you were closest (ties split). <b>Flips</b> are picks with the wrong favorite.</p>`;

  const weeks = [...byWeek]
    .reverse()
    .map(
      ({ week, players, weekWinners }) => `<button class="wtile" data-act="open-results" data-id="${esc(week.id)}">
        <span class="wtile-k">${esc(shortWeek(week).toUpperCase())}</span>
        <span class="wtile-who">${esc(weekWinners.map(nameOf).join(' & '))}</span>
        <span class="wtile-score">${esc(players.map((p) => wins(p.won)).join(' – '))}</span>
      </button>`,
    )
    .join('');

  const call = (rec, good) => {
    if (!rec || (!good && rec.miss === 0)) return '';
    const g = rec.game;
    const caption = good
      ? `${rec.exact ? 'Dead on' : `${num(rec.miss)} off`} · ${g.away.abbr} @ ${g.home.abbr} · ${shortWeek(rec.week)}`
      : `Line was ${lineText(g, rec.line)} · ${shortWeek(rec.week)}`;
    return `<div class="call">
        <span class="call-k ${good ? 'good' : 'bad'}">${good ? `${ICON.target}Best call` : 'Biggest miss'}</span>
        <span class="call-v">${esc(nameOf(rec.playerId))} · ${esc(lineText(g, rec.pick))}</span>
        <span class="call-c">${esc(caption)}</span>
      </div>`;
  };

  return view(
    'season',
    `${head}${leader}${table}${explain}
     <h2 class="section">By week</h2><div class="weeks">${weeks}</div>
     <h2 class="section">Highlights</h2><div class="calls">${call(best, true)}${call(worst, false)}</div>`,
  );
}

// ---- Sheets

function sheetHead(title, meta = '') {
  return `<div class="sheet-head"><div class="grabber" aria-hidden="true"></div><h2 id="sheet-title" class="sheet-title">${title}</h2>${
    meta ? `<p class="sheet-meta">${meta}</p>` : ''
  }</div>`;
}

function joinSheet() {
  const ids = Object.keys(S.players).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const grid = `<div class="name-grid">${ids
    .map((id) => `<button class="btn${id === S.meId ? ' is-me' : ''}" data-act="join-as" data-id="${esc(id)}">${esc(nameOf(id))}</button>`)
    .join('')}</div>`;
  const form = (autofocus) => `<form class="form-row" data-form="join" autocomplete="off">
      <label class="sr" for="join-name">Your name</label>
      <input id="join-name" class="field" name="name" maxlength="24" placeholder="Your name" autocapitalize="words" enterkeyhint="go" required${autofocus ? ' autofocus' : ''}>
      <button class="btn btn-primary" type="submit">Join</button>
    </form>`;
  if (joined()) {
    return `${sheetHead('Switch player')}
      <p class="sheet-sub">Tap whoever’s holding the phone.</p>
      ${grid}
      <button class="btn btn-quiet btn-block" data-act="add-player">${ICON.plus}Add a new player</button>`;
  }
  if (!ids.length) {
    return `${sheetHead('Who’s playing?')}
      <p class="sheet-sub">Add your name to start the league. This phone will remember you.</p>
      ${form(true)}`;
  }
  const names = ids.map(nameOf);
  return `${sheetHead('Join the league')}
    <p class="sheet-sub">${esc(listNames(names))} ${names.length === 1 ? 'is' : 'are'} playing. Add your name to jump in with this week’s picks.</p>
    ${form(false)}
    <p class="sheet-hint">Played before on another phone? Tap your name.</p>
    ${grid}`;
}

function addSheet() {
  const invite = S.live
    ? `<input id="invite-link" class="link-box" readonly value="${esc(inviteUrl())}" aria-label="Invite link">
       <div class="row2"><button class="btn btn-primary" data-act="copy-link">Copy link</button>${
         navigator.share ? '<button class="btn" data-act="share-link">Share</button>' : ''
       }</div>`
    : '<p class="sheet-hint">Invite links switch on once Firebase is connected (see the README). Until then, add them on this phone.</p>';
  return `${sheetHead('Add a player')}
    <section class="opt">
      <h3 class="opt-k">${ICON.link}On their phone</h3>
      <p class="sheet-sub">Send them the league link. They add their name and they’re in, starting with this week’s picks.</p>
      ${invite}
    </section>
    <section class="opt">
      <h3 class="opt-k">${ICON.phone}On this phone</h3>
      <p class="sheet-sub">Passing the phone around? Add their name, let them make their picks, then tap the gold chip to switch back.</p>
      <form class="form-row" data-form="add" autocomplete="off">
        <label class="sr" for="add-name">Their name</label>
        <input id="add-name" class="field" name="name" maxlength="24" placeholder="Their name" autocapitalize="words" enterkeyhint="done" required>
        <button class="btn" type="submit">Add</button>
      </form>
    </section>
    <p class="sheet-hint">Guests only hold up the reveal in weeks they actually play.</p>`;
}

function pickerSheet() {
  const { target, gameId, side } = S.sheet;
  const g = (target === 'line' ? S.resWeek?.games || [] : weekGames()).find((x) => x.id === gameId);
  if (!g) return `${sheetHead('Not found')}<p class="sheet-sub">That game isn’t loaded.</p>`;
  const cur = target === 'line' ? S.resWeek?.lines?.[gameId] : S.myPicks[gameId];
  const mag = cur == null || cur === 0 ? null : Math.abs(cur);
  const on = side === 'away' || side === 'home';
  const seg = (s, label) =>
    `<button class="seg-btn${side === s ? ' is-on' : ''}" data-act="picker-side" data-side="${s}" aria-pressed="${side === s}">${label}</button>`;
  const nums = Array.from({ length: 27 }, (_, i) => 1 + i / 2)
    .map(
      (v) =>
        `<button class="num${v === 3 || v === 7 ? ' is-key' : ''}${on && mag === v ? ' is-on' : ''}" data-act="picker-num" data-v="${v}" aria-label="${num(v)} points" ${on ? '' : 'disabled'}>${num(v)}</button>`,
    )
    .join('');
  return `${sheetHead(target === 'line' ? 'Fix the line' : 'Who’s favored?', `${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${esc(kickoff(g.kickoff))}`)}
    <div class="seg">${seg('away', esc(g.away.abbr))}${seg('pk', 'PK')}${seg('home', esc(g.home.abbr))}</div>
    <div class="num-grid${on ? '' : ' is-off'}">${nums}</div>
    <p class="sheet-hint">${on ? 'By how much? 3 and 7 are the key numbers. Past 14, use + on the board.' : 'Tap the favorite first, or PK for a pick’em.'}</p>
    <button class="btn btn-quiet btn-block" data-act="close-sheet">Cancel</button>`;
}

// ---------------------------------------------------------------- start

boot().catch((err) => {
  console.error(err);
  foot.innerHTML = '';
  main.innerHTML = note(
    `Something went wrong loading the app.<br><span class="mono">${esc(err.message || err)}</span>`,
    '<button class="btn" data-act="reload">Try again</button>',
  );
});

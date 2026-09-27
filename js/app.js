import { firebaseConfig } from './config.js';
import { LocalStore, createFirestoreStore } from './store.js';
import * as espn from './espn.js';
import { scoreWeek, scoreSeason } from './scoring.js';
import { MINUS, avg, esc, kickoff, lineText, listNames, num, randomKey, slug, stamp, wins } from './util.js';

const main = document.getElementById('main');
const foot = document.getElementById('foot');
const sheetEl = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

const svg = (paths, size, width, stroke = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>', 20, 1.8),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>', 20, 1.8),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 20h8"/>', 20, 1.8),
  minus: svg('<path d="M5 12h14"/>', 16, 2.5),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16, 2.5),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 18, 2.2),
  right: svg('<path d="M9 5l7 7-7 7"/>', 18, 2.2),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 13, 3, '#34D399'),
  checkSm: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 11, 3.2, '#34D399'),
  target:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="#34D399"/></svg>',
};

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
  // Results
  resId: null,
  resWeek: undefined,
  resGuesses: {},
  // Season
  season: null,
  seasonToken: 0,
  // UI
  sheet: null,
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
const badgeOf = (w) => (w ? (w.type === 3 ? w.short : `Wk ${w.week}`).toUpperCase() : '…');
const sinceOf = (w) => (w.type === 3 ? w.short : `Wk ${w.week}`);
const inviteUrl = () => `${location.origin}${location.pathname}#k=${S.key}`;
const revealedIds = () =>
  Object.values(S.weeks)
    .filter((w) => w.revealedAt)
    .map((w) => w.id)
    .sort();

// ---------------------------------------------------------------- boot


async function boot() {
  S.key = S.live ? readLeagueKey() : 'demo';
  if (!S.key) return renderLanding();
  renderMain();
  S.store = S.live ? await createFirestoreStore(firebaseConfig, S.key) : new LocalStore(S.key);
  S.store.touchLeague();
  S.meId = localStorage.getItem(meKey());

  S.store.watchPlayers((players) => {
    S.players = players;
    if (!joined() && S.sheet?.type !== 'join') openSheet({ type: 'join' });
    renderMain();
  });
  S.store.watchWeeks((list) => {
    S.weeks = Object.fromEntries(list.map((w) => [w.id, w]));
    if (S.tab === 'results') ensureResults();
    if (S.tab === 'season') loadSeason();
    renderMain();
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

function renderLanding() {
  foot.innerHTML = '';
  main.innerHTML = `
    <section class="landing">
      <h1 class="brand brand-xl">Guess the Lines</h1>
      <p class="lead">Guess every NFL spread before Vegas posts it. Closest guess takes the game.</p>
      <button class="btn btn-green btn-block" data-act="start-league">Start a league</button>
      <p class="fine">Got an invite from a friend? Open their link, or paste it here.</p>
      <form class="join-form" data-form="invite" autocomplete="off">
        <label class="sr" for="invite-in">Invite link</label>
        <input id="invite-in" class="field" name="link" placeholder="Paste invite link">
        <button class="btn btn-ghost" type="submit">Join</button>
      </form>
    </section>`;
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
  renderMain();
  S.unsub.week = S.store.watchWeek(w.id, (doc) => {
    S.week = doc;
    renderMain();
  });
  S.unsub.guesses = S.store.watchGuesses(w.id, (g) => {
    S.guesses = g;
    syncMyPicks();
    renderMain();
  });
  try {
    const games = await espn.loadWeek(w);
    if (curWeek()?.id === w.id) S.liveGames = games;
  } catch (err) {
    console.error(err);
    if (curWeek()?.id === w.id) S.error = 'Couldn’t load the schedule from ESPN. Check your connection and try again.';
  }
  renderMain();
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
  S.myPicks = { ...S.myPicks, [gameId]: value };
  renderMain();
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

// Everyone on the roster who hasn't locked. Someone who hasn't opened the app yet counts too,
// so nobody reveals the lines before a friend has had a chance to guess.
function waitingOn() {
  return Object.keys(S.players).filter((id) => id !== S.meId && !S.guesses[id]?.lockedAt);
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
  renderMain();
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
    S.tab = 'results';
    openResults(w.id);
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    toast('Couldn’t reach ESPN. Try again in a minute.');
  } finally {
    S.busy = null;
    renderMain();
  }
}

// ---------------------------------------------------------------- results + season

function ensureResults() {
  const ids = revealedIds();
  if (!ids.length || (S.resId && ids.includes(S.resId))) return;
  openResults(ids[ids.length - 1]);
}

function openResults(id) {
  if (S.resId === id && S.unsub.resWeek) return renderMain();
  S.unsub.resWeek?.();
  S.unsub.resGuesses?.();
  Object.assign(S, { resId: id, resWeek: undefined, resGuesses: {} });
  S.unsub.resWeek = S.store.watchWeek(id, (d) => {
    S.resWeek = d;
    renderMain();
  });
  S.unsub.resGuesses = S.store.watchGuesses(id, (g) => {
    S.resGuesses = g;
    renderMain();
  });
  renderMain();
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
  renderMain();
}

function setTab(tab) {
  S.tab = tab;
  if (tab === 'results') ensureResults();
  if (tab === 'season') loadSeason();
  renderMain();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- players

async function join(raw) {
  const name = String(raw).trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) return;
  const id = slug(name);
  try {
    if (!S.players[id]) {
      await S.store.addPlayer({ id, name });
      S.players = { ...S.players, [id]: S.players[id] || { name, joinedAt: Date.now() } };
    }
    await becomePlayer(id);
  } catch (err) {
    console.error(err);
    toast('Couldn’t join. Check your connection.');
  }
}

async function becomePlayer(id) {
  await flushNow();
  S.meId = id;
  localStorage.setItem(meKey(), id);
  S.myPicks = { ...(S.guesses[id]?.picks || {}) };
  closeSheet(true);
  renderMain();
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
  S.sheet = sheet;
  renderSheet();
}

function closeSheet(force = false) {
  if (!force && S.sheet?.type === 'join' && !joined()) return;
  S.sheet = null;
  renderSheet();
}

function renderSheet() {
  if (!S.sheet) {
    sheetEl.hidden = true;
    sheetEl.innerHTML = '';
    return;
  }
  const body = { join: joinSheet, invite: inviteSheet, picker: pickerSheet }[S.sheet.type]();
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<button class="backdrop" data-act="close-sheet" aria-label="Close" tabindex="-1"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div>`;
  sheetEl.querySelector('[autofocus]')?.focus();
}

function openPicker(target, gameId) {
  if (target === 'pick' && !canEdit()) return;
  const cur = target === 'line' ? S.resWeek?.lines?.[gameId] : S.myPicks[gameId];
  const side = cur == null ? null : cur < 0 ? 'home' : cur > 0 ? 'away' : 'pk';
  openSheet({ type: 'picker', target, gameId, side });
}

function applyValue(target, gameId, value) {
  if (target === 'line') S.store.setLine(S.resId, gameId, value).catch(() => toast('Couldn’t save that line.'));
  else setPick(gameId, value);
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

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2800);
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
    case 'invite': return openSheet({ type: 'invite' });
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
  if (form.dataset.form === 'join') join(data.get('name') || '');
  if (form.dataset.form === 'invite') {
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

// ---------------------------------------------------------------- rendering

function renderMain() {
  if (S.live && !S.key) return;
  // Re-rendering replaces the buttons, so put keyboard focus back where it was.
  const a = document.activeElement;
  const refocus =
    a && (main.contains(a) || foot.contains(a)) && a.dataset?.act
      ? ['act', 'g', 'side', 'tab'].map((k) => (a.dataset[k] ? `[data-${k}="${a.dataset[k]}"]` : '')).join('')
      : null;

  const view = S.tab === 'results' ? viewResults() : S.tab === 'season' ? viewSeason() : viewWeek();
  main.innerHTML =
    (S.live ? '' : '<p class="demo"><b>DEMO MODE</b> · saved on this device only. Connect Firebase to play with friends.</p>') +
    view;
  foot.innerHTML = (S.tab === 'week' ? lockBar() : '') + tabBar();

  if (refocus) document.querySelector(refocus)?.focus({ preventScroll: true });
}

function header({ badge, sub, prev, next, prevOff, nextOff }) {
  const nav = prev
    ? `<div class="wk">
        <button class="wk-nav" data-act="${prev}" aria-label="Previous week" ${prevOff ? 'disabled' : ''}>${ICON.left}</button>
        <span class="wk-badge">${esc(badge)}</span>
        <button class="wk-nav" data-act="${next}" aria-label="Next week" ${nextOff ? 'disabled' : ''}>${ICON.right}</button>
      </div>`
    : `<span class="wk-badge">${esc(badge)}</span>`;
  return `<header class="hdr">
      <div class="hdr-top"><h1 class="brand">Guess the Lines</h1>${nav}</div>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </header>`;
}

const note = (html, extra = '') => `<div class="note">${html}${extra ? `<div>${extra}</div>` : ''}</div>`;

function tabBar() {
  const t = (id, label, icon) =>
    `<button class="tab ${S.tab === id ? 'is-on' : ''}" data-act="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`;
  return `<nav class="tabs" aria-label="Sections">${t('week', 'This week', ICON.pencil)}${t('results', 'Results', ICON.flag)}${t('season', 'Season', ICON.trophy)}</nav>`;
}

// ---- This week

function viewWeek() {
  const w = curWeek();
  if (!w) return header({ badge: '…', sub: 'Loading the NFL schedule…' }) + note('Loading…');
  const games = weekGames();
  const revealed = Boolean(S.week?.revealedAt);
  const sub = revealed
    ? `Lines revealed ${esc(stamp(S.week.lineAsOf || S.week.revealedAt))} · ${esc(S.week.lineSource || 'ESPN')}`
    : `${games.length ? `${games.length} games · ` : ''}real lines stay hidden until everyone locks`;
  const head = header({
    badge: badgeOf(w), sub, prev: 'week-prev', next: 'week-next',
    prevOff: S.weekIdx <= 0, nextOff: S.weekIdx >= S.cal.weeks.length - 1,
  });
  let body;
  if (S.error && !games.length) body = note(esc(S.error), '<button class="btn btn-ghost" data-act="reload">Try again</button>');
  else if (!games.length) body = note(S.liveGames ? 'No games scheduled this week.' : 'Loading games…');
  else body = `<section class="games" aria-label="Games">${games.map((g) => gameCard(g, revealed)).join('')}</section>`;
  return head + playerStrip(games.length) + body;
}

function playerStrip(total) {
  const ids = Object.keys(S.players).sort((a, b) =>
    a === S.meId ? -1 : b === S.meId ? 1 : (S.players[a].joinedAt || 0) - (S.players[b].joinedAt || 0),
  );
  const chips = ids.map((id) => {
    const name = esc(nameOf(id).toUpperCase());
    const g = S.guesses[id];
    const n = id === S.meId ? Object.keys(S.myPicks).length : Object.keys(g?.picks || {}).length;
    if (id === S.meId)
      return `<button class="chip chip-me" data-act="me" aria-label="Playing as ${esc(nameOf(id))}. Tap to switch player">${name} <span class="mono">${g?.lockedAt ? 'LOCKED' : `${n}/${total || '–'}`}</span></button>`;
    if (g?.lockedAt) return `<span class="chip chip-locked">${ICON.check}${name}</span>`;
    return `<span class="chip">${name} <span class="mono">${n ? `${n}/${total}` : '–'}</span></span>`;
  });
  return `<div class="players">${chips.join('')}<button class="chip-add" data-act="invite" aria-label="Invite a player">${ICON.plus}</button></div>`;
}

function gameCard(g, revealed) {
  const hs = S.myPicks[g.id];
  const set = hs != null;
  const pk = hs === 0;
  const fav = !set || pk ? null : hs < 0 ? 'home' : 'away';
  const ro = !canEdit();
  let label = '';
  let cls = '';
  if (revealed) {
    const line = S.week.lines?.[g.id];
    label = line == null ? 'NO LINE' : `LINE ${lineText(g, line)}${set ? ` · ${num(Math.abs(hs - line))} OFF` : ''}`;
    cls = 'lbl-line';
  } else if (!set) label = ro ? '' : 'TAP THE FAVORITE';
  else if (pk) [label, cls] = ['PICK’EM', 'lbl-set'];
  else [label, cls] = [`${fav === 'home' ? g.home.abbr : g.away.abbr} BY ${num(Math.abs(hs))}`, 'lbl-set'];

  const matchup = `${g.away.abbr} at ${g.home.abbr}`;
  const stepOff = ro || !set || pk ? 'disabled' : '';
  return `<article class="game" aria-label="${esc(matchup)}">
      <div class="game-top"><span class="kick">${esc(kickoff(g.kickoff))}</span><span class="lbl ${cls}">${esc(label)}</span></div>
      <div class="game-row">
        ${teamBtn(g, 'away', fav === 'away', ro)}
        <span class="at" aria-hidden="true">@</span>
        ${teamBtn(g, 'home', fav === 'home', ro)}
        <div class="grow"></div>
        <div class="stepper ${ro ? 'is-ro' : ''}">
          <button class="step" data-act="dec" data-g="${g.id}" aria-label="Half a point less on ${esc(matchup)}" ${stepOff}>${ICON.minus}</button>
          <button class="val ${set ? 'is-set' : ''}" data-act="picker" data-g="${g.id}" aria-label="Set the spread for ${esc(matchup)}" ${ro ? 'disabled' : ''}>${set ? (pk ? 'PK' : MINUS + num(Math.abs(hs))) : '—'}</button>
          <button class="step" data-act="inc" data-g="${g.id}" aria-label="Half a point more on ${esc(matchup)}" ${stepOff}>${ICON.plus}</button>
        </div>
      </div>
    </article>`;
}

function teamBtn(g, side, on, ro) {
  const t = g[side];
  return `<button class="team ${on ? 'is-fav' : ''}" data-act="team" data-g="${g.id}" data-side="${side}" aria-pressed="${on}" aria-label="${esc(t.name)} favored" ${ro ? 'disabled' : ''}>
      <span class="team-abbr">${esc(t.abbr)}</span><span class="team-name">${esc(t.name)}</span>
    </button>`;
}

function lockBar() {
  const games = weekGames();
  if (!curWeek() || !games.length || !joined()) return '';
  const bar = (txt, buttons) => `<div class="lockbar"><div class="lockbar-txt">${txt}</div>${buttons}</div>`;
  if (S.week?.revealedAt) {
    return bar('<b>Lines are out</b><small>See who was closest</small>', '<button class="btn btn-green" data-act="tab" data-tab="results">See results</button>');
  }
  const set = games.filter((g) => S.myPicks[g.id] != null).length;
  if (!myGuess()?.lockedAt) {
    const left = games.length - set;
    return bar(
      `<b>${set}<span class="dim"> / ${games.length} set</span></b><small>${left ? `${left} game${left === 1 ? '' : 's'} still blank` : 'All set. Lock it in.'}</small>`,
      `<button class="btn btn-green" data-act="lock" ${set ? '' : 'disabled'}>Lock my lines</button>`,
    );
  }
  const waiting = waitingOn().map(nameOf);
  const all = !waiting.length;
  return bar(
    `<b>Locked</b><small>${esc(all ? 'Everyone’s in. Drop the lines.' : `Waiting on ${listNames(waiting)}`)}</small>`,
    `<button class="btn btn-ghost" data-act="unlock">Unlock</button>
     <button class="btn ${all ? 'btn-green' : 'btn-ghost'}" data-act="reveal" ${S.busy ? 'disabled' : ''}>${S.busy === 'reveal' ? 'Revealing…' : 'Reveal'}</button>`,
  );
}

// ---- Results

function viewResults() {
  const ids = revealedIds();
  const w = S.resWeek;
  if (!ids.length && !w?.revealedAt) {
    return (
      header({ badge: badgeOf(curWeek()) }) +
      note('No results yet. The lines drop once everyone locks in their guesses.', '<button class="btn btn-ghost" data-act="tab" data-tab="week">Make your guesses</button>')
    );
  }
  const i = ids.indexOf(S.resId);
  const head = (sub) =>
    header({ badge: w ? badgeOf(w) : '…', sub, prev: 'res-prev', next: 'res-next', prevOff: i <= 0, nextOff: i === -1 || i >= ids.length - 1 });
  if (!w) return head('Loading…') + note('Loading…');

  const r = scoreWeek(w, S.resGuesses);
  const sub = `Lines as of ${esc(stamp(w.lineAsOf || w.revealedAt))} · ${esc(w.lineSource || 'ESPN')}`;
  if (!r.players.length) return head(sub) + note('Nobody guessed this week.');

  const tiles = r.players
    .map((p) => {
      const win = r.weekWinners.includes(p.playerId);
      const bestAvg = !win && r.players.length > 1 && Math.abs(p.avg - r.bestAvg) < 1e-9;
      return `<div class="tile ${win ? 'is-win' : ''} ${p.playerId === S.meId ? 'tile-me' : ''}">
        <div class="tile-name">${esc(nameOf(p.playerId).toUpperCase())}</div>
        <div class="tile-num">${wins(p.won)}</div>
        <div class="tile-cap">games won</div>
        <div class="tile-cap mono">${avg(p.avg)} avg off</div>
        ${win ? `<span class="tag tag-green">WINS ${esc(badgeOf(w))}</span>` : bestAvg ? '<span class="tag tag-amber">BEST AVG</span>' : ''}
      </div>`;
    })
    .join('');
  const order = r.players.map((p) => p.playerId);
  return `${head(sub)}<div class="board">${tiles}</div>
    <section class="games" aria-label="Results by game">${r.games.map((gr) => resultCard(w, gr, order)).join('')}</section>`;
}

function resultCard(w, { game: g, line, cells }, order) {
  const byId = Object.fromEntries(cells.map((c) => [c.playerId, c]));
  const edited = w.edited?.[g.id];
  const cellHtml = order
    .map((id) => {
      const c = byId[id];
      const name = esc(nameOf(id).toUpperCase());
      if (!c) return `<div class="cell is-empty"><div class="cell-name">${name}</div><div class="cell-pick">—</div><div class="cell-off">no guess</div></div>`;
      const off = c.exact ? `<div class="cell-exact">${ICON.target}EXACT</div>` : `<div class="cell-off">${num(c.miss)} off</div>`;
      return `<div class="cell ${c.win ? 'is-win' : ''}">
          <div class="cell-name">${name}${c.win ? ICON.checkSm : ''}</div>
          <div class="cell-pick">${esc(lineText(g, c.pick))}</div>
          ${off}${c.flip ? '<div class="cell-flip">WRONG SIDE</div>' : ''}
        </div>`;
    })
    .join('');
  return `<article class="game">
      <div class="res-top">
        <div class="matchup">${esc(g.away.abbr)} <span>@</span> ${esc(g.home.abbr)}</div>
        <div class="line"><span class="line-lbl">${edited ? 'LINE (EDITED)' : 'LINE'}</span>
          <button class="line-pill ${edited ? 'is-edited' : ''}" data-act="edit-line" data-g="${g.id}" aria-label="Line ${esc(lineText(g, line))}. Tap to fix it">${esc(lineText(g, line))}</button>
        </div>
      </div>
      ${line == null ? '<p class="noline">ESPN had no line for this one. Tap the line to add it.</p>' : `<div class="cells">${cellHtml}</div>`}
    </article>`;
}

// ---- Season

function viewSeason() {
  const ids = revealedIds();
  const last = ids.length ? S.weeks[ids[ids.length - 1]] : null;
  const head = header({
    badge: String(S.cal?.season || new Date().getFullYear()),
    sub: last ? `Season standings · through ${esc(sinceOf(last))}` : 'Season standings',
  });
  if (!S.season) return head + note('Adding it all up…');
  if (S.season.error) return head + note('Couldn’t load the season.', '<button class="btn btn-ghost" data-act="reload">Try again</button>');
  const { standings, byWeek, best, worst, firstWeekId } = S.season;
  if (!standings.length) return head + note('No weeks revealed yet. Standings show up after the first reveal.');

  const lead = standings[0];
  const leader = `<div class="leader">
      <div>
        <div class="leader-k">SEASON LEADER</div>
        <div class="leader-name">${esc(nameOf(lead.playerId))}</div>
        <div class="leader-cap">Closest to Vegas on a typical game</div>
      </div>
      <div><div class="leader-num">${avg(lead.avg)}</div><div class="leader-unit">PTS OFF / GAME</div></div>
    </div>`;

  const rows = standings
    .map((s, i) => {
      const since = s.firstWeek.id !== firstWeekId ? `<span class="td-since">since ${esc(sinceOf(s.firstWeek))}</span>` : '';
      return `<div class="trow ${i === 0 ? 'is-lead' : ''} ${s.playerId === S.meId ? 'is-me' : ''}" role="row">
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
        <span class="th" role="columnheader">#</span><span class="th" role="columnheader">PLAYER</span>
        <span class="th" role="columnheader">AVG OFF</span><span class="th" role="columnheader">GAMES</span>
        <span class="th" role="columnheader">WEEKS</span><span class="th" role="columnheader">EXACT</span>
        <span class="th" role="columnheader">FLIPS</span>
      </div>${rows}
    </div>`;

  const explain = `<p class="explain"><b>Avg off</b>: how far your guess landed from the real line on a typical game. Lower wins.
    <b>Games</b>: times you were closest (ties split). <b>Flips</b>: picked the wrong favorite.</p>`;

  const weeks = [...byWeek]
    .reverse()
    .map(({ week, players, weekWinners }) => {
      const who = weekWinners.map((id) => nameOf(id)).join(' & ');
      const score = players.map((p) => wins(p.won)).join(' – ');
      return `<button class="wtile" data-act="open-results" data-id="${esc(week.id)}">
        <span class="wtile-k">${esc(badgeOf(week))}</span>
        <span class="wtile-who">${esc(who)}</span>
        <span class="wtile-score">${esc(score)}</span>
      </button>`;
    })
    .join('');

  const call = (rec, good) => {
    if (!rec || (!good && rec.miss === 0)) return '';
    const g = rec.game;
    const cap = good
      ? `${rec.exact ? 'Dead on' : `${num(rec.miss)} off`} · ${g.away.abbr} @ ${g.home.abbr} · ${sinceOf(rec.week)}`
      : `Line was ${lineText(g, rec.line)} · ${sinceOf(rec.week)}`;
    return `<div class="call">
        <span class="call-k ${good ? 'good' : 'bad'}">${good ? `${ICON.target}BEST CALL` : 'BIGGEST MISS'}</span>
        <span class="call-v">${esc(nameOf(rec.playerId))} · ${esc(lineText(g, rec.pick))}</span>
        <span class="call-c">${esc(cap)}</span>
      </div>`;
  };

  return `${head}${leader}${table}${explain}
    <p class="section-k">BY WEEK</p><div class="weeks">${weeks}</div>
    <div class="calls">${call(best, true)}${call(worst, false)}</div>`;
}

// ---- Sheets

function joinSheet() {
  const ids = Object.keys(S.players).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const switching = joined();
  const picker = ids.length
    ? `<p class="sheet-sub">Tap your name.</p>
       <div class="name-grid">${ids
         .map((id) => `<button class="btn btn-ghost ${id === S.meId ? 'is-me' : ''}" data-act="join-as" data-id="${esc(id)}">${esc(nameOf(id))}</button>`)
         .join('')}</div>
       <p class="sheet-sub">New here? Add your name.</p>`
    : '<p class="sheet-sub">Add your name to start guessing. This phone will remember you.</p>';
  return `<h2 id="sheet-title" class="sheet-title">${switching ? 'Switch player' : 'Who’s playing?'}</h2>
    ${picker}
    <form class="join-form" data-form="join" autocomplete="off">
      <label class="sr" for="join-name">Your name</label>
      <input id="join-name" class="field" name="name" maxlength="24" placeholder="Your name" required ${ids.length ? '' : 'autofocus'}>
      <button class="btn btn-green" type="submit">Join</button>
    </form>
    ${switching ? '<button class="btn btn-ghost btn-block" data-act="close-sheet">Cancel</button>' : ''}`;
}

function inviteSheet() {
  if (!S.live) {
    return `<h2 id="sheet-title" class="sheet-title">Invite a player</h2>
      <p class="sheet-sub">This is demo mode, so everything is saved on this device only. Once Firebase is connected (see the README), this gives you a link to send to Mike.</p>
      <p class="sheet-sub">To try a second player here, tap your name at the top and add another.</p>
      <button class="btn btn-ghost btn-block" data-act="close-sheet">Got it</button>`;
  }
  return `<h2 id="sheet-title" class="sheet-title">Invite a player</h2>
    <p class="sheet-sub">Anyone with this link can join the league and guess this week’s lines. Keep it to the group chat.</p>
    <label class="sr" for="invite-link">Invite link</label>
    <input id="invite-link" class="link-box" readonly value="${esc(inviteUrl())}">
    <div class="row2">
      <button class="btn btn-green" data-act="copy-link">Copy link</button>
      ${navigator.share ? '<button class="btn btn-ghost" data-act="share-link">Share…</button>' : ''}
    </div>
    <button class="btn btn-ghost btn-block" data-act="close-sheet">Done</button>`;
}

function pickerSheet() {
  const { target, gameId, side } = S.sheet;
  const g = (target === 'line' ? S.resWeek?.games || [] : weekGames()).find((x) => x.id === gameId);
  if (!g) return '<p class="sheet-sub">That game isn’t loaded.</p>';
  const cur = target === 'line' ? S.resWeek?.lines?.[gameId] : S.myPicks[gameId];
  const mag = cur == null || cur === 0 ? null : Math.abs(cur);
  const on = side === 'away' || side === 'home';
  const seg = (s, label) =>
    `<button class="seg-btn ${side === s ? 'is-on' : ''}" data-act="picker-side" data-side="${s}" aria-pressed="${side === s}">${label}</button>`;
  const nums = Array.from({ length: 27 }, (_, i) => 1 + i / 2)
    .map(
      (v) =>
        `<button class="num ${v === 3 || v === 7 ? 'is-key' : ''} ${on && mag === v ? 'is-on' : ''}" data-act="picker-num" data-v="${v}" aria-label="${num(v)} points" ${on ? '' : 'disabled'}>${num(v)}</button>`,
    )
    .join('');
  return `<h2 id="sheet-title" class="sheet-title">${target === 'line' ? 'Fix the line' : 'Who’s favored?'}</h2>
    <p class="sheet-sub mono">${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${esc(kickoff(g.kickoff))}</p>
    <div class="seg">${seg('away', esc(g.away.abbr))}${seg('pk', 'PK')}${seg('home', esc(g.home.abbr))}</div>
    <div class="num-grid ${on ? '' : 'is-off'}">${nums}</div>
    <p class="sheet-hint">${on ? 'By how much? 3 and 7 are the key numbers. Past 14, use + on the card.' : 'Tap the favorite first, or PK for a pick’em.'}</p>
    <button class="btn btn-ghost btn-block" data-act="close-sheet">Cancel</button>`;
}

// ---------------------------------------------------------------- start

boot().catch((err) => {
  console.error(err);
  foot.innerHTML = '';
  main.innerHTML = note(
    `Something went wrong loading the app.<br><span class="mono">${esc(err.message || err)}</span>`,
    '<button class="btn btn-ghost" data-act="reload">Try again</button>',
  );
});

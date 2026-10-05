// Two interchangeable data stores with the same API:
//   LocalStore      – demo mode; everything lives in this browser's localStorage.
//   FirestoreStore  – the real thing; shared through a free Firebase project.
//
// Layout (Firestore paths shown; LocalStore mirrors them in one JSON blob):
//   leagues/{key}                         – key is random and only exists in the invite link
//   leagues/{key}/players/{playerId}      – { name, joinedAt }
//   leagues/{key}/weeks/{weekId}          – { label, games[], lines{}, show, revealedAt, ... }
//
// A reveal is a show everyone watches together: startShow saves the lines and puts the week on
// game 1, moveShow steps it along (every phone follows), and endShow makes the results official.
//   leagues/{key}/weeks/{weekId}/guesses/{playerId} – { name, picks{}, lockedAt }

const FIREBASE_VERSION = '12.19.0';

export class LocalStore {
  constructor(key) {
    this.ns = `gtl:data:${key}`;
    this.listeners = new Set();
    window.addEventListener('storage', (e) => e.key === this.ns && this.emit());
  }
  read() {
    try {
      return JSON.parse(localStorage.getItem(this.ns)) || { players: {}, weeks: {}, guesses: {} };
    } catch {
      return { players: {}, weeks: {}, guesses: {} };
    }
  }
  write(db) {
    localStorage.setItem(this.ns, JSON.stringify(db));
    this.emit();
  }
  emit() {
    for (const fn of this.listeners) fn();
  }
  on(fn) {
    this.listeners.add(fn);
    fn();
    return () => this.listeners.delete(fn);
  }
  touchLeague() {}
  watchPlayers(cb) {
    return this.on(() => cb(this.read().players));
  }
  async addPlayer({ id, name }) {
    const db = this.read();
    db.players[id] ||= { name, joinedAt: Date.now() };
    this.write(db);
  }
  watchWeeks(cb) {
    return this.on(() => cb(Object.values(this.read().weeks)));
  }
  watchWeek(id, cb) {
    return this.on(() => cb(this.read().weeks[id] || null));
  }
  async ensureWeek(id, data) {
    const db = this.read();
    if (!db.weeks[id]) {
      db.weeks[id] = { ...data, createdAt: Date.now(), revealedAt: null, lines: null };
      this.write(db);
    }
  }
  watchGuesses(id, cb) {
    return this.on(() => cb(this.read().guesses[id] || {}));
  }
  async allGuesses(id) {
    return this.read().guesses[id] || {};
  }
  async savePicks(weekId, playerId, picks, name) {
    const db = this.read();
    const wk = (db.guesses[weekId] ||= {});
    wk[playerId] = { lockedAt: null, ...wk[playerId], name, picks, updatedAt: Date.now() };
    this.write(db);
  }
  async setLock(weekId, playerId, locked, name) {
    const db = this.read();
    const wk = (db.guesses[weekId] ||= {});
    wk[playerId] = { picks: {}, ...wk[playerId], name, lockedAt: locked ? Date.now() : null };
    this.write(db);
  }
  async setLine(id, gameId, value) {
    const db = this.read();
    const w = db.weeks[id];
    if (!w) return;
    w.lines = { ...(w.lines || {}), [gameId]: value };
    w.edited = { ...(w.edited || {}), [gameId]: true };
    this.write(db);
  }
  async startShow(id, data) {
    const db = this.read();
    const w = db.weeks[id];
    if (!w || w.revealedAt || (w.show && w.show.step !== 'done')) return;
    Object.assign(w, data, { show: { step: 'guesses', index: 0, startedAt: Date.now() } });
    this.write(db);
  }
  async moveShow(id, from, to) {
    const db = this.read();
    const s = db.weeks[id]?.show;
    if (!s || s.index !== from.index || s.step !== from.step) return false;
    db.weeks[id].show = { ...s, ...to };
    this.write(db);
    return true;
  }
  async endShow(id) {
    const db = this.read();
    const w = db.weeks[id];
    if (!w || w.revealedAt) return;
    w.revealedAt = Date.now();
    w.show = { ...(w.show || {}), step: 'done' };
    this.write(db);
  }
}

export async function createFirestoreStore(config, key) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  return new FirestoreStore(fs, fs.getFirestore(initializeApp(config)), key);
}

// Firestore Timestamps → plain millis, so the UI never has to care which store it has.
function plain(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = v && typeof v.toMillis === 'function' ? v.toMillis() : v;
  return out;
}

class FirestoreStore {
  constructor(fs, db, key) {
    Object.assign(this, { fs, db, key });
  }
  ref(...path) {
    return this.fs.doc(this.db, 'leagues', this.key, ...path);
  }
  col(...path) {
    return this.fs.collection(this.db, 'leagues', this.key, ...path);
  }
  touchLeague() {
    const { setDoc, doc, serverTimestamp } = this.fs;
    setDoc(doc(this.db, 'leagues', this.key), { touchedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }
  watchPlayers(cb) {
    return this.fs.onSnapshot(this.col('players'), (s) => {
      const o = {};
      s.forEach((d) => (o[d.id] = plain(d.data())));
      cb(o);
    });
  }
  async addPlayer({ id, name }) {
    const { runTransaction, serverTimestamp } = this.fs;
    const r = this.ref('players', id);
    await runTransaction(this.db, async (tx) => {
      if (!(await tx.get(r)).exists()) tx.set(r, { name, joinedAt: serverTimestamp() });
    });
  }
  watchWeeks(cb) {
    return this.fs.onSnapshot(this.col('weeks'), (s) => cb(s.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))));
  }
  watchWeek(id, cb) {
    return this.fs.onSnapshot(this.ref('weeks', id), (d) => cb(d.exists() ? { id: d.id, ...plain(d.data()) } : null));
  }
  async ensureWeek(id, data) {
    const { runTransaction, serverTimestamp } = this.fs;
    const r = this.ref('weeks', id);
    await runTransaction(this.db, async (tx) => {
      if (!(await tx.get(r)).exists()) tx.set(r, { ...data, createdAt: serverTimestamp(), revealedAt: null, lines: null });
    });
  }
  watchGuesses(id, cb) {
    return this.fs.onSnapshot(this.col('weeks', id, 'guesses'), (s) => {
      const o = {};
      s.forEach((d) => (o[d.id] = plain(d.data())));
      cb(o);
    });
  }
  async allGuesses(id) {
    const s = await this.fs.getDocs(this.col('weeks', id, 'guesses'));
    const o = {};
    s.forEach((d) => (o[d.id] = plain(d.data())));
    return o;
  }
  async savePicks(weekId, playerId, picks, name) {
    // Whole-map replace (mergeFields) so picks never leave stale keys behind.
    const { setDoc, serverTimestamp } = this.fs;
    await setDoc(
      this.ref('weeks', weekId, 'guesses', playerId),
      { name, picks, updatedAt: serverTimestamp() },
      { mergeFields: ['name', 'picks', 'updatedAt'] },
    );
  }
  async setLock(weekId, playerId, locked, name) {
    const { setDoc, serverTimestamp } = this.fs;
    await setDoc(
      this.ref('weeks', weekId, 'guesses', playerId),
      { name, lockedAt: locked ? serverTimestamp() : null },
      { merge: true },
    );
  }
  async setLine(id, gameId, value) {
    const { updateDoc, FieldPath } = this.fs;
    await updateDoc(this.ref('weeks', id), new FieldPath('lines', gameId), value, new FieldPath('edited', gameId), true);
  }
  // Each step is a transaction against the step it came from, so two phones tapping "Next"
  // at the same moment can't skip a game.
  async startShow(id, data) {
    const { runTransaction } = this.fs;
    const r = this.ref('weeks', id);
    await runTransaction(this.db, async (tx) => {
      const w = (await tx.get(r)).data();
      if (!w || w.revealedAt || (w.show && w.show.step !== 'done')) return;
      tx.update(r, { ...data, show: { step: 'guesses', index: 0, startedAt: Date.now() } });
    });
  }
  async moveShow(id, from, to) {
    const { runTransaction } = this.fs;
    const r = this.ref('weeks', id);
    return runTransaction(this.db, async (tx) => {
      const s = (await tx.get(r)).data()?.show;
      if (!s || s.index !== from.index || s.step !== from.step) return false;
      tx.update(r, { show: { ...s, ...to } });
      return true;
    });
  }
  async endShow(id) {
    const { runTransaction, serverTimestamp } = this.fs;
    const r = this.ref('weeks', id);
    await runTransaction(this.db, async (tx) => {
      const w = (await tx.get(r)).data();
      if (!w || w.revealedAt) return;
      tx.update(r, { revealedAt: serverTimestamp(), show: { ...(w.show || {}), step: 'done' } });
    });
  }
}

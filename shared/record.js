// Win/loss records, kept in this browser (localStorage), one per game, plus when Penopi last saw me.
// streak: Penopi's wins in a row, hstreak: mine.

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const EMPTY = { games: 0, penopi: 0, human: 0, draws: 0, streak: 0, hstreak: 0 }; // plus last: time of the last save

// legacy: a record kept by an older page on this same site (LOA 튀르크's "turk-record"), taken over once.
export function loadRecord(gameId, legacy) {
  const key = `penopi.${gameId}.record`;
  let saved = store.get(key, null);
  if (!saved && legacy) {
    const old = store.get(legacy, null);
    if (old && old.games) saved = { ...old, penopi: old.turk || 0 };
  }
  const rec = Object.assign({}, EMPTY, saved || {});
  delete rec.turk;
  return {
    rec,
    save() { rec.last = Date.now(); store.set(key, rec); },
    reset() { Object.assign(rec, EMPTY); rec.last = Date.now(); store.set(key, rec); },
    // result: 'human' | 'penopi' | 'draw'. Returns my win streak that Penopi just broke (0 if none).
    add(result) {
      rec.games++;
      let broke = 0;
      if (result === 'human') { rec.human++; rec.hstreak++; rec.streak = 0; }
      else if (result === 'penopi') { broke = rec.hstreak; rec.penopi++; rec.streak++; rec.hstreak = 0; }
      else { rec.draws++; rec.streak = rec.hstreak = 0; }
      rec.last = Date.now();
      store.set(key, rec);
      return broke;
    },
  };
}

// Days since the last visit to any page of the site (0 on the first visit), and mark this one.
export function visit() {
  const last = store.get('penopi.lastVisit', 0);
  store.set('penopi.lastVisit', Date.now());
  return { first: !last, days: last ? Math.floor((Date.now() - last) / 86400000) : 0 };
}

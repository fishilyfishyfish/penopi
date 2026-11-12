// International draughts engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the game so far ([{from, to, caps}], matched against the legal moves) plus how long to think.
importScripts('engine.js');
const E = DraughtsEngine({ ttBits: 20 });
onmessage = (e) => {
  const { id, moves, time, depth } = e.data;
  try {
    E.setStart();
    for (const m of moves) if (!E.play(m)) throw new Error('잘못된 수순');
    postMessage({ id, result: E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

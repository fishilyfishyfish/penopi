// Oware engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the game so far (pits played) plus how long to think; the answer is the engine's info.
importScripts('engine.js');
const E = OwareEngine({ ttBits: 20 });
onmessage = (e) => {
  const { id, moves, time, depth } = e.data;
  try {
    E.setStart();
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

// Breakthrough engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the game so far plus how long to think; the answer is the engine's info object.
importScripts('engine.js');
const E = BreakthroughEngine({ ttBits: 20 });
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

// Hnefatafl engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the board size and the game so far plus how long to think; the answer is the engine's info object.
importScripts('engine.js', '../shared/slip.js');
const engines = {};
onmessage = (e) => {
  const { id, size, moves, time, depth, slip } = e.data;
  try {
    const E = engines[size] || (engines[size] = HnefataflEngine({ ttBits: 20, size }));
    const replay = () => {
      E.setStart(size);
      for (const m of moves) E.play(m);
    };
    replay();
    postMessage({ id, result: slip ? slipThink(E, replay, { time, depth }, slip) : E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

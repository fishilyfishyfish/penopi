// Janggi engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is both sides' 상차림 and the game so far (engine move ints) plus how long to think; the answer is the engine's info.
importScripts('engine.js');
const E = JanggiEngine({ ttBits: 20 });
onmessage = (e) => {
  const { id, arr, moves, time, depth } = e.data;
  try {
    E.setup(arr[0], arr[1]);
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

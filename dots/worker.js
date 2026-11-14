// Dots and Boxes engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the board size, the lines drawn so far and how long to think; the answer is the engine's info.
importScripts('engine.js');
let E = null, size = 0;
onmessage = (e) => {
  const { id, size: n, moves, time, depth } = e.data;
  try {
    if (!E || n !== size) { E = DotsEngine({ rows: n, cols: n, ttBits: 20 }); size = n; }
    E.setStart();
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

// 육각잇기 engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the board size and the game so far (cells, −2 = swap) plus how long to think; the answer is the engine's info.
importScripts('engine.js');
let E = null;
onmessage = (e) => {
  const { id, size, moves, time } = e.data;
  try {
    if (!E) E = HexEngine({ size });
    E.setup(size);
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

// Tic-tac-toe inside tic-tac-toe engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the game so far (cells) and how long to think; the answer is the engine's info object.
importScripts('engine.js', '../shared/slip.js');
const E = Ttt9Engine({ ttBits: 20 });
onmessage = (e) => {
  const { id, moves, time, depth, slip } = e.data;
  try {
    const replay = () => {
      E.setStart();
      for (const m of moves) E.play(m);
    };
    replay();
    postMessage({ id, result: slip ? slipThink(E, replay, { time, depth }, slip) : E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

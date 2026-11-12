// Gomoku engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the rule set, the game so far (squares) and how long to think; the answer is the engine's info.
importScripts('engine.js');
const E = GomokuEngine({ ttBits: 20 });
onmessage = (e) => {
  const { id, moves, rule, time, depth } = e.data;
  try {
    E.setRule(rule); E.setStart();
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

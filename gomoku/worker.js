// Gomoku engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the rule set, the game so far (squares) and how long to think; the answer is the engine's info.
importScripts('engine.js', '../shared/slip.js');
const E = GomokuEngine({ ttBits: 20 });
onmessage = (e) => {
  const { id, moves, rule, time, depth, slip } = e.data;
  try {
    const replay = () => {
      E.setRule(rule); E.setStart();
      for (const m of moves) E.play(m);
    };
    replay();
    postMessage({ id, result: slip ? slipThink(E, replay, { time, depth }, slip) : E.think({ time, depth }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

// Nine Men's Morris engine (engine.js) in a background worker (shared/engine.js protocol).
// A request is the variant (nine, six, twelve), the game so far (move ints) plus how long to think; the answer is the engine's info.
importScripts('engine.js', '../shared/slip.js');
const engines = {};
onmessage = (e) => {
  const { id, variant, moves, time, depth, slip } = e.data;
  try {
    const v = variant || 'nine', E = engines[v] || (engines[v] = MorrisEngine({ ttBits: 20, variant: v }));
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

// LOA engine in a background worker (shared/engine.js protocol). engine.js is LOA 튀르크's file, unchanged:
// LoaEngine + the self-play tuned weights. A request is the game so far plus how long to think;
// the answer is the engine's info object ({move, score, depth, nodes, ...}).
importScripts('engine.js');
const E = LoaEngine({ ttBits: 20 });
E.setWeights(TUNED_WEIGHTS);
onmessage = (e) => {
  const { id, moves, time, depth } = e.data;
  try {
    E.setStart();
    for (const m of moves) E.play(m);
    postMessage({ id, result: E.think({ time, depth, keepHistory: true }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

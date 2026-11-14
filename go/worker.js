// Go engine (engine.js) in a background worker (shared/engine.js protocol). The worker keeps one engine and its
// search tree; a request is the game so far (points, −1 = pass) and how long to think.
importScripts('engine.js');
const E = GoEngine({ nodes: 300000 });
let played = [];
onmessage = (e) => {
  const { id, moves, time } = e.data;
  try {
    // replay only what's new when the game continues (keeps the tree), else from the start
    const same = played.length <= moves.length && played.every((m, i) => m === moves[i]);
    if (!same) { E.setStart(); played = []; }
    for (let i = played.length; i < moves.length; i++) E.play(moves[i]);
    played = moves.slice();
    postMessage({ id, result: E.think({ time }) });
  } catch (err) {
    postMessage({ id, error: String((err && err.stack) || err) });
  }
};

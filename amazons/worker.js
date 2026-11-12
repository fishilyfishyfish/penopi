// Amazons engine (amazons-hippolyta's Rust engine, WASM) in a background worker, shared/engine.js protocol.
// Stateless from the page's point of view: every request carries the game so far as a flat
// [from, to, arrow, ...] list, so any worker can answer any request (the page runs several for a
// root-parallel search, the way amazons-hippolyta's own page does).
//   {type: 'state', history}                         → {state}
//   {type: 'search', history, ms, seed, jitter}      → {info, state}   MCTS for ms milliseconds
import init, { Game } from './pkg/amazons_engine.js';

let game = null;
const ready = init().then(() => { game = new Game(Math.floor(Math.random() * 2 ** 32)); });

function snapshot() {
  return {
    cells: Array.from(game.cells()), // 100, index row*10+col (row 0 = rank 1): 0 empty, 1 white, 2 black, 3 arrow
    side: game.side_to_move(),       // 0 white, 1 black
    legal: Array.from(game.legal_moves()),
    over: game.is_over(),
    winner: game.winner(),           // -1 running, 0 white won, 1 black won
  };
}

// Runs MCTS for ms milliseconds (amazons-hippolyta web/worker.js, same loop)
function search(ms, seed, jitter) {
  game.search_start_seeded(seed, jitter);
  const start = performance.now();
  for (;;) {
    game.search_run(32);
    if (performance.now() - start >= ms) break;
  }
  const info = JSON.parse(game.search_info(64));
  info.ms = Math.round(performance.now() - start);
  return info;
}

self.onmessage = async (e) => {
  const { id, type, history = [], ms, seed = 0, jitter = 0 } = e.data;
  try {
    await ready;
    if (!game.load_history(new Uint8Array(history))) throw new Error('잘못된 수순');
    const out = {};
    if (type === 'search') out.info = search(ms, seed, jitter);
    out.state = snapshot();
    self.postMessage({ id, result: out });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};

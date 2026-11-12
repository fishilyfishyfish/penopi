// Backgammon engine (backgammon-palamedes's Rust engine, WASM, neural net weights included) in a worker.
// The engine is stateless: a request names an engine function and its arguments ({fn, args}), as in
// backgammon-palamedes's web/engine-worker.js; this file only speaks shared/engine.js's protocol.
import init, * as engine from './pkg/palamedes.js';

const ready = init();
// functions that return JSON text: parsed here
const JSON_FNS = new Set(['turn_state_json', 'result_json', 'rank_moves_json', 'analyze_move_json', 'cube_decision_json', 'ai_move_json', 'ai_cube_json', 'bots_json']);

self.onmessage = async (e) => {
  const { id, fn, args = [] } = e.data;
  try {
    await ready;
    if (typeof engine[fn] !== 'function' || fn === 'default') throw new Error(`unknown engine function: ${fn}`);
    let result = engine[fn](...args.map((a) => (Array.isArray(a) ? Uint8Array.from(a) : a)));
    if (JSON_FNS.has(fn)) result = JSON.parse(result);
    else if (ArrayBuffer.isView(result)) result = Array.from(result);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};

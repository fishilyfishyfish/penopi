// Engine vs engine for hnefatafl/engine.js, to see how even the two sides are and to tune the weights (W) and the 봐주기 plans.
//   node tools/arena-hnefatafl.mjs size=7 att=nodes:200000 def=nodes:200000 games=24 [open=2] [seed=7] [threads=4]
// A player: nodes:N or ms:T, then optional ",w={json}" (engine weights, see W in engine.js) and ",ease=1|2" (the 봐주기 plan of
// shared/ease.js: depth cap + slips). e.g. att='nodes:200000,w={"guard":60}' def='ms:2500,ease=1'.
// Every game starts from `open` random moves (the same openings for every run with the same seed). Prints the attackers' wins,
// the defenders' wins and draws, and the attackers' score with a 95% interval.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..');
const { HnefataflEngine } = require(path.join(root, 'hnefatafl', 'engine.js'));
const { slipThink } = require(path.join(root, 'shared', 'slip.js'));

function parsePlayer(spec) {
  const out = { cfg: {}, weights: null, ease: 0 };
  // split on commas that are not inside the JSON
  const parts = []; let depth = 0, cur = '';
  for (const ch of spec) { if (ch === '{') depth++; if (ch === '}') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  for (const p of parts) {
    if (p.startsWith('w=')) { out.weights = JSON.parse(p.slice(2)); continue; }
    const i = p.search(/[:=]/), k = p.slice(0, i), v = Number(p.slice(i + 1));
    if (k === 'nodes') out.cfg.nodes = v;
    else if (k === 'ms') out.cfg.time = v;
    else if (k === 'ease') out.ease = v;
    else if (k === 'depth') out.cfg.depth = v;
    else if (k === 'slip') out.slip = v;
    else if (k === 'margin') out.margin = v;
    else if (k === 'shallow') out.shallow = v;
  }
  return out;
}
// the 봐주기 plans straight from shared/ease.js (an ES module with no page dependencies)
async function easePlans() {
  const mod = await import(path.join(root, 'shared', 'ease.js'));
  return mod.PLANS.hnefatafl;
}

function playGame(size, att, def, opening, plans, rnd) {
  const R = HnefataflEngine({ ttBits: 8, size });
  const players = {};
  for (const [side, spec] of [[1, att], [2, def]]) {
    const E = HnefataflEngine({ ttBits: 18, size, weights: spec.weights || undefined });
    players[side] = { E, spec };
  }
  const moves = opening.slice();
  R.setStart(size); for (const m of moves) R.play(m);
  while (R.status() !== 'over') {
    const { E, spec } = players[R.stm];
    const replay = () => { E.setStart(size); for (const m of moves) E.play(m); };
    replay();
    let info;
    if (spec.ease) {
      const p = plans[spec.ease - 1];
      const cfg = { time: Math.min(spec.cfg.time || 2500, p.ms), depth: p.depth };
      info = p.slip && rnd() < p.slip.p ? slipThink(E, replay, cfg, { margin: p.slip.margin }) : E.think(cfg);
    } else {
      const cfg = Object.assign({}, spec.cfg);
      if (spec.shallow && cfg.depth > 1 && rnd() < spec.shallow) cfg.depth--; // now and then one move less deep
      info = spec.slip && rnd() < spec.slip ? slipThink(E, replay, cfg, { margin: spec.margin || 150 }) : E.think(cfg);
    }
    moves.push(info.move); R.play(info.move);
  }
  return { result: R.result(), plies: R.plies };
}

if (isMainThread) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
  const size = Number(args.size || 7), games = Number(args.games || 24), open = Number(args.open ?? 2), threads = Number(args.threads || 4);
  let seed = Number(args.seed || 7);
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
  const openings = [];
  for (let g = 0; g < games; g++) {
    const R = HnefataflEngine({ ttBits: 8, size }); const o = [];
    R.setStart(size);
    for (let k = 0; k < open && R.status() !== 'over'; k++) { const l = R.legalMoves(); const m = l[rnd(l.length)]; o.push(m); R.play(m); }
    openings.push(o);
  }
  const att = args.att || 'nodes:100000', def = args.def || att;
  const t0 = Date.now(); let next = 0, done = 0; const tally = { 1: 0, 2: 0, 3: 0 }; let plies = 0;
  await new Promise((resolve) => {
    for (let t = 0; t < Math.min(threads, games); t++) {
      const w = new Worker(here, { workerData: { size, att, def } });
      const feed = () => { if (next < games) w.postMessage({ i: next, opening: openings[next++] }); else w.terminate(); };
      w.on('message', (r) => { tally[r.result]++; plies += r.plies; if (++done === games) resolve(); feed(); });
      feed();
    }
  });
  const n = games, sc = (tally[1] + tally[3] / 2) / n, se = Math.sqrt(Math.max(sc * (1 - sc), 0.01) / n);
  console.log(`${size}×${size} att=${att} def=${def}: attackers ${tally[1]}, defenders ${tally[2]}, draws ${tally[3]} / ${n}` +
    ` → attackers ${(100 * sc).toFixed(0)}% ±${(196 * se).toFixed(0)}, ${(plies / n).toFixed(0)} plies avg (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
} else {
  const { size, att, def } = workerData;
  const plans = await easePlans();
  let s = 12345 + Math.floor(Math.random() * 1e6);
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return (s >>> 8) / (1 << 23); };
  const A = parsePlayer(att), D = parsePlayer(def);
  parentPort.on('message', ({ opening }) => parentPort.postMessage(playGame(size, A, D, opening, plans, rnd)));
}

// Engine vs engine for shogi/engine.js: node tools/arena-shogi.mjs <A> <B> [pairs = 10] [threads = 4] [seed = 7]
// A player: "nodes:N" or "ms:T", then ",key=value" search switches (engine W), ",params=x.json" (evaluation parameters),
// ",file=path" (another engine file). Each pair: the same 4 random opening moves, colours swapped. Prints A's score
// (draws count half).
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(here), '..');
const require = createRequire(import.meta.url);
const { ShogiEngine } = require(path.join(root, 'shogi', 'engine.js'));
if (isMainThread) {
  const [specA, specB, pairsArg, threadsArg, seedArg] = process.argv.slice(2);
  const pairs = Number(pairsArg || 10), threads = Number(threadsArg || 4);
  let seed = Number(seedArg || 7);
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const jobs = [];
  for (let i = 0; i < pairs; i++) {
    const R = ShogiEngine({ ttBits: 4 }), opening = [];
    for (let k = 0; k < 4; k++) { const l = R.legalMoves().filter((m) => m !== R.DECLARE); const m = l[rnd(l.length)]; opening.push(m); R.play(m); }
    jobs.push({ opening });
  }
  let score = 0, n = 0, draws = 0, next = 0, live = 0;
  const t0 = Date.now();
  const start = () => {
    if (next >= jobs.length) {
      if (!live) {
        const p = score / n, se = Math.sqrt(p * (1 - p) / n), elo = (q) => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
        console.log(`${specA} vs ${specB}: ${score}/${n} (${(100 * p).toFixed(1)}% ± ${(196 * se).toFixed(1)}), Elo ${elo(p).toFixed(0)} [${elo(p - 1.96 * se).toFixed(0)}, ${elo(p + 1.96 * se).toFixed(0)}], ${draws} draws, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      }
      return;
    }
    const job = jobs[next++]; live++;
    const wk = new Worker(here, { workerData: { specA, specB, job } });
    wk.on('message', (m) => { score += m.score; n += 2; draws += m.draws; });
    wk.on('exit', () => { live--; start(); });
  };
  for (let t = 0; t < threads; t++) start();
} else {
  const { specA, specB, job } = workerData;
  function player(spec) {
    const [head, ...kv] = spec.split(',');
    const [kind, val] = head.split(':');
    const weights = {};
    let Engine = ShogiEngine, params;
    for (const p of kv) {
      const [k, v] = p.split('=');
      if (k === 'file') Engine = require(path.resolve(v)).ShogiEngine;
      else if (k === 'params') params = JSON.parse(fs.readFileSync(v, 'utf8'));
      else weights[k] = Number(v);
    }
    const E = Engine({ ttBits: 18, weights, params });
    const cfg = kind === 'ms' ? { time: Number(val) } : { nodes: Number(val), soft: 1 };
    return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think(cfg).move; };
  }
  let draws = 0;
  function game(sente, gote) { // 1 if 선수 wins, 0 if 후수, 0.5 draw
    const R = ShogiEngine({ ttBits: 4 }), moves = job.opening.slice();
    for (const m of moves) R.play(m);
    for (let k = 0; k < 500; k++) {
      const st = R.status();
      if (st) { if (R.loser < 0) { draws++; return 0.5; } return R.loser === 0 ? 0 : 1; }
      const m = (R.side === 0 ? sente : gote)(moves);
      if (m === R.DECLARE) return R.side === 0 ? 1 : 0;
      moves.push(m); R.play(m);
    }
    draws++; return 0.5;
  }
  const a = player(specA), b = player(specB);
  let score = game(a, b);
  const a2 = player(specA), b2 = player(specB);
  score += 1 - game(b2, a2);
  parentPort.postMessage({ score, draws });
}

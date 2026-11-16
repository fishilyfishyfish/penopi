// Engine vs engine for yukgak/engine.js (육각잇기): node tools/arena-yukgak.mjs <A> <B> [pairs = 10] [size = 9] [threads = 4] [seed = 7]
// A player: "p:N" (playouts) or "ms:T", then ",key=value" engine options (expand, raveK, uct). Each pair starts from the
// same random first stone (no swap) and swaps colours. Prints A's score (no draws).
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(here), '..');
const require = createRequire(import.meta.url);
if (isMainThread) {
  const [A, B, pairsArg, sizeArg, threadsArg, seedArg] = process.argv.slice(2);
  const pairs = Number(pairsArg || 10), size = Number(sizeArg || 9), threads = Number(threadsArg || 4);
  let seed = Number(seedArg || 7);
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const jobs = Array.from({ length: pairs }, (_, i) => ({ first: rnd(size * size), seed: i + 1 }));
  let score = 0, n = 0, next = 0, live = 0;
  const t0 = Date.now();
  const start = () => {
    if (next >= jobs.length) {
      if (!live) {
        const p = score / n, se = Math.sqrt(p * (1 - p) / n), elo = (q) => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
        console.log(`${A} vs ${B} (${size}): ${score}/${n} (${(100 * p).toFixed(1)}% ± ${(196 * se).toFixed(1)}), Elo ${elo(p).toFixed(0)}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      }
      return;
    }
    const job = jobs[next++]; live++;
    const wk = new Worker(here, { workerData: { A, B, size, job } });
    wk.on('message', (m) => { score += m; n += 2; });
    wk.on('exit', () => { live--; start(); });
  };
  for (let t = 0; t < threads; t++) start();
} else {
  const { HexEngine } = require(path.join(root, 'yukgak', 'engine.js'));
  const { A, B, size, job } = workerData;
  const player = (spec, k) => {
    const [head, ...kv] = spec.split(',');
    const [kind, val] = head.split(':');
    const o = { size, seed: job.seed * 7 + k };
    for (const x of kv) { const [a, b] = x.split('='); o[a] = Number(b); }
    const E = HexEngine(o);
    const cfg = kind === 'ms' ? { time: Number(val) } : { playouts: Number(val) };
    return (moves) => { E.setup(size); for (const m of moves) E.play(m); let r = E.think(cfg).move; if (r < 0) { const l = E.legal().filter((x) => x >= 0); r = l[0]; } return r; };
  };
  const game = (black, white) => {
    const R = HexEngine({ size }), moves = [job.first];
    R.play(job.first);
    while (!R.winner()) { const m = (R.toMove === 1 ? black : white)(moves); moves.push(m); R.play(m); }
    return R.winner();
  };
  let s = game(player(A, 1), player(B, 2)) === 1 ? 1 : 0;
  s += game(player(B, 3), player(A, 4)) === 2 ? 1 : 0;
  parentPort.postMessage(s);
}

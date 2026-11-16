// Self-play games for tuning shogi/engine.js's evaluation (tools/shogi-tune.mjs):
//   node tools/shogi-selfplay.mjs <games> <out file> [nodes per move = 4000] [threads = 4] [seed = 1] [params.json]
// Each game starts with 4–7 random moves, then the engine plays both sides. Every quiet position (not in check, static
// evaluation = quiescence score) is written as "FEN<TAB>result", result from 선수's view: 1, 0.5 (draw) or 0.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(here), '..');
if (isMainThread) {
  const [gamesArg, out, nodesArg, threadsArg, seedArg, paramsFile] = process.argv.slice(2);
  const games = Number(gamesArg), threads = Number(threadsArg || 4), seed0 = Number(seedArg || 1);
  const params = paramsFile ? JSON.parse(fs.readFileSync(paramsFile, 'utf8')) : null;
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let done = 0, positions = 0, w = 0, l = 0, d = 0;
  const t0 = Date.now();
  for (let t = 0; t < threads; t++) {
    const n = Math.floor(games / threads) + (t < games % threads ? 1 : 0);
    const wk = new Worker(here, { workerData: { n, nodes: Number(nodesArg || 4000), seed: seed0 * 1000 + t, params } });
    wk.on('message', (msg) => {
      stream.write(msg.lines);
      positions += msg.count; done++;
      if (msg.result === 1) w++; else if (msg.result === 0) l++; else d++;
      if (done % 50 === 0 || done === games) console.log(`${done}/${games} games, ${positions} positions, 선수 ${w} 후수 ${l} draws ${d}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    });
  }
} else {
  const { ShogiEngine } = createRequire(import.meta.url)(path.join(root, 'shogi', 'engine.js'));
  let seed = workerData.seed;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const E = ShogiEngine({ ttBits: 18, params: workerData.params || undefined }), R = ShogiEngine({ ttBits: 4 }), Q = ShogiEngine({ ttBits: 4, params: workerData.params || undefined });
  for (let g = 0; g < workerData.n; g++) {
    R.setStart();
    const moves = [];
    for (let i = 0, k = 4 + rnd(4); i < k; i++) { const l = R.legalMoves().filter((m) => m !== R.DECLARE); if (!l.length) break; const m = l[rnd(l.length)]; R.play(m); moves.push(m); }
    if (R.status()) { g--; continue; }
    E.setFen(R.fen());
    if (Math.abs(E.think({ nodes: workerData.nodes, soft: 1 }).score) > 500) { g--; continue; }
    const fens = [];
    let result = 0.5, streak = 0;
    for (let ply = 0; ply < 500; ply++) {
      const st = R.status();
      if (st) { result = R.loser < 0 ? 0.5 : R.loser === 0 ? 0 : 1; break; }
      E.setFen(R.fen());
      const info = E.think({ nodes: workerData.nodes, soft: 1 });
      if (info.move === E.DECLARE) { result = R.side === 0 ? 1 : 0; break; }
      const sente = R.side === 0 ? info.score : -info.score;
      if (Math.abs(sente) >= 2000) { if (++streak >= 6) { result = sente > 0 ? 1 : 0; break; } } else streak = 0;
      if (!R.inCheck() && Math.abs(sente) < 1500) {
        Q.setFen(R.fen());
        if (Q.qscore() === Q.evaluate()) fens.push(R.fen());
      }
      R.play(info.move);
    }
    const keep = fens.filter((_, i) => i % 3 === g % 3);
    parentPort.postMessage({ lines: keep.map((f) => `${f}\t${result}\n`).join(''), count: keep.length, result });
  }
}

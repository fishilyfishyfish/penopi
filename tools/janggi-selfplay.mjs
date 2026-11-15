// Self-play games for tuning janggi/engine.js's evaluation (tools/janggi-tune.mjs):
//   node tools/janggi-selfplay.mjs <games> <out file> [nodes per move = 5000] [threads = 4] [seed = 1]
// Each game starts from random 상차림 and 2–6 random moves, then the engine plays both sides. Every quiet
// position (not in check, static evaluation = quiescence score) is written as "FEN<TAB>result", result from
// 초's view: 1 or 0 (janggi has no draws: counting decides).
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(here), '..');
if (isMainThread) {
  const [gamesArg, out, nodesArg, threadsArg, seedArg] = process.argv.slice(2);
  const games = Number(gamesArg), threads = Number(threadsArg || 4), seed0 = Number(seedArg || 1);
  const stream = fs.createWriteStream(out, { flags: 'a' });
  let done = 0, positions = 0, w = 0, l = 0, counted = 0;
  const t0 = Date.now();
  for (let t = 0; t < threads; t++) {
    const n = Math.floor(games / threads) + (t < games % threads ? 1 : 0);
    const wk = new Worker(here, { workerData: { n, nodes: Number(nodesArg || 5000), seed: seed0 * 1000 + t } });
    wk.on('message', (msg) => {
      stream.write(msg.lines);
      positions += msg.count; done++;
      if (msg.result === 1) w++; else l++;
      if (msg.counted) counted++;
      if (done % 50 === 0 || done === games) console.log(`${done}/${games} games, ${positions} positions, 초 ${w} 한 ${l} (${counted} counted), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    });
  }
} else {
  const { JanggiEngine } = createRequire(import.meta.url)(path.join(root, 'janggi', 'engine.js'));
  let seed = workerData.seed;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const E = JanggiEngine({ ttBits: 18 }), R = JanggiEngine({ ttBits: 4 }), Q = JanggiEngine({ ttBits: 4 });
  for (let g = 0; g < workerData.n; g++) {
    const arr = [rnd(4), rnd(4)], moves = [];
    R.setup(...arr);
    for (let i = 0, k = 2 + rnd(5); i < k; i++) { const l = R.legalMoves().filter((m) => m !== R.PASS); const m = l[rnd(l.length)]; R.play(m); moves.push(m); }
    if (R.status()) { g--; continue; }
    const fens = [];
    let result = -1, counted = false, streak = 0;
    for (let ply = 0; ply < 260; ply++) {
      const st = R.status();
      if (st === 'mate') { result = R.side === R.CHO ? 0 : 1; break; }
      if (st) { result = R.countWinner() === R.CHO ? 1 : 0; counted = true; break; }
      E.setup(...arr); for (const m of moves) E.play(m);
      const info = E.think({ nodes: workerData.nodes, soft: 1 });
      const cho = R.side === R.CHO ? info.score : -info.score;
      if (Math.abs(cho) >= 1500) { if (++streak >= 6) { result = cho > 0 ? 1 : 0; break; } } else streak = 0;
      if (!R.inCheck() && !R.facing() && Math.abs(cho) < 1500) {
        Q.setFen(R.fen());
        if (Q.qscore() === Q.evaluate()) fens.push(R.fen());
      }
      R.play(info.move); moves.push(info.move);
    }
    if (result < 0) result = R.countWinner() === R.CHO ? 1 : 0;
    const keep = fens.filter((_, i) => i % 3 === g % 3);
    parentPort.postMessage({ lines: keep.map((f) => `${f}\t${result}\n`).join(''), count: keep.length, result, counted });
  }
}

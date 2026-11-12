// Self-play games for tuning chess/engine.js's evaluation (tools/chess-tune.mjs):
//   node tools/chess-selfplay.mjs <games> <out file> [nodes per move = 5000] [threads = 4] [seed = 1]
// Each game starts from a random prefix of a book line plus a few random moves, then the engine plays both
// sides. Every quiet position (not in check, static evaluation = quiescence score) after the opening is
// written as "FEN<TAB>result", result from White's view: 1, 0.5 or 0.
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
  let done = 0, positions = 0, w = 0, d = 0, l = 0;
  const t0 = Date.now();
  for (let t = 0; t < threads; t++) {
    const n = Math.floor(games / threads) + (t < games % threads ? 1 : 0);
    const wk = new Worker(here, { workerData: { n, nodes: Number(nodesArg || 5000), seed: seed0 * 1000 + t } });
    wk.on('message', (msg) => {
      stream.write(msg.lines);
      positions += msg.count; done++;
      if (msg.result === 1) w++; else if (msg.result === 0) l++; else d++;
      if (done % 50 === 0 || done === games) console.log(`${done}/${games} games, ${positions} positions, +${w} =${d} -${l}, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    });
  }
} else {
  const { ChessEngine } = createRequire(import.meta.url)(path.join(root, 'chess', 'engine.js'));
  const { BOOK } = await import(path.join(root, 'chess', 'book.js'));
  let seed = workerData.seed;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  const E = ChessEngine({ ttBits: 18 }), R = ChessEngine({ ttBits: 8 });
  for (let g = 0; g < workerData.n; g++) {
    R.setStart();
    const line = BOOK[rnd(BOOK.length)].split(' '), pre = rnd(Math.min(line.length, 12));
    let ok = true;
    for (let i = 0; i < pre && ok; i++) { const m = R.legalMoves().find((x) => R.san(x) === line[i]); if (m === undefined) ok = false; else R.play(m); }
    for (let i = 0, k = 2 + rnd(5); i < k; i++) { const l = R.legalMoves(); if (!l.length) break; R.play(l[rnd(l.length)]); }
    if (R.status()) { g--; continue; }
    E.setFen(R.fen());
    const start = E.think({ nodes: workerData.nodes, soft: 1 });
    if (Math.abs(start.score) > 400) { g--; continue; }
    const fens = [];
    let result = 0.5, winStreak = 0, drawStreak = 0;
    for (let ply = 0; ply < 300; ply++) {
      const st = R.status();
      if (st === 'mate') { result = R.side === 0 ? 0 : 1; break; }
      if (st) { result = 0.5; break; }
      E.setFen(R.fen());
      const info = E.think({ nodes: workerData.nodes, soft: 1 });
      const white = R.side === 0 ? info.score : -info.score;
      // adjudicate: a clear win for 6 plies, or a dead level game for 20 plies late on
      if (Math.abs(white) >= 1000) { if (++winStreak >= 6) { result = white > 0 ? 1 : 0; break; } } else winStreak = 0;
      if (ply >= 80 && Math.abs(white) <= 15) { if (++drawStreak >= 20) { result = 0.5; break; } } else drawStreak = 0;
      if (!R.inCheck() && Math.abs(white) < 2000) {
        const ev = E.evaluate();
        if (E.qscore() === ev) fens.push(R.fen());
      }
      R.play(info.move);
    }
    // a few positions per game (neighbouring positions are nearly the same)
    const keep = fens.filter((_, i) => i % 3 === g % 3);
    parentPort.postMessage({ lines: keep.map((f) => `${f}\t${result}\n`).join(''), count: keep.length, result });
  }
}

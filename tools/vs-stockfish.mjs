// Measures chess/engine.js against Stockfish limited to a given Elo (measurement only: Stockfish is not part
// of the site). Needs a stockfish binary (e.g. apt install stockfish).
//   node tools/vs-stockfish.mjs <stockfish Elo> [pairs = 5] [our ms per move = 2500] [stockfish ms = 500] [seed]
// Each pair starts from the same 2 random plies and swaps colours. Prints our score.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ChessEngine } = require(path.join(root, 'chess', 'engine.js'));
const [eloArg, pairsArg, msArg, sfArg, seedArg] = process.argv.slice(2);
const ELO = Number(eloArg), PAIRS = Number(pairsArg || 5), MS = Number(msArg || 2500), SFMS = Number(sfArg || 500);
let seed = Number(seedArg || ELO);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const SF = ['/usr/games/stockfish', '/usr/bin/stockfish', 'stockfish'].find((p) => p === 'stockfish' || fs.existsSync(p));

function uci() {
  const p = spawn(SF);
  let buf = '', waiters = [];
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      waiters = waiters.filter((w) => !w(line));
    }
  });
  const send = (s) => p.stdin.write(s + '\n');
  const until = (pred) => new Promise((res) => waiters.push((l) => (pred(l) ? (res(l), true) : false)));
  return { send, until, quit: () => { send('quit'); p.kill(); } };
}

async function game(sf, ourWhite, opening) {
  const E = ChessEngine({ ttBits: 20 }), R = ChessEngine({ ttBits: 8 });
  const moves = [];
  const play = (m) => { moves.push(R.uci(m)); R.play(m); E.play(m); };
  for (const k of opening) play(R.legalMoves()[k]);
  sf.send('ucinewgame'); sf.send('isready'); await sf.until((l) => l === 'readyok');
  for (let ply = 0; ply < 400; ply++) {
    const st = R.status();
    if (st === 'mate') return (R.side === 0) === ourWhite ? 0 : 1;
    if (st) return 0.5;
    if ((R.side === 0) === ourWhite) {
      const info = E.think({ time: MS });
      play(info.move);
    } else {
      sf.send(`position startpos moves ${moves.join(' ')}`);
      sf.send(`go movetime ${SFMS}`);
      const line = await sf.until((l) => l.startsWith('bestmove'));
      const u = line.split(' ')[1];
      const m = R.legalMoves().find((x) => R.uci(x) === u);
      if (m === undefined) throw new Error(`stockfish move ${u} not legal here: ${R.fen()}`);
      play(m);
    }
  }
  return 0.5;
}

const sf = uci();
sf.send('uci'); await sf.until((l) => l === 'uciok');
sf.send('setoption name Threads value 1');
sf.send('setoption name UCI_LimitStrength value true');
sf.send(`setoption name UCI_Elo value ${ELO}`);
let score = 0, n = 0;
const t0 = Date.now();
for (let i = 0; i < PAIRS; i++) {
  const R = ChessEngine({ ttBits: 8 }), opening = [];
  for (let k = 0; k < 2; k++) { const l = R.legalMoves(), j = rnd(l.length); opening.push(j); R.play(l[j]); }
  score += await game(sf, true, opening); n++;
  score += await game(sf, false, opening); n++;
}
sf.quit();
const p = score / n, elo = p <= 0 || p >= 1 ? NaN : -400 * Math.log10(1 / p - 1);
console.log(`vs Stockfish UCI_Elo ${ELO}: ${score}/${n} = ${(100 * p).toFixed(0)}%${Number.isNaN(elo) ? '' : `, ≈ ${Math.round(ELO + elo)} on that scale`} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);

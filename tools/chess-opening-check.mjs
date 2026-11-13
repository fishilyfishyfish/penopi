// Grades chess/engine.js's opening moves with Stockfish (measurement only: Stockfish is not part of the site).
//   node tools/chess-opening-check.mjs [games = 10] [our ms per move = 2500] [opponent Elo = 1600] [seed = 1] [plies = 30]
// Penopi's side plays as on the site (book while the game follows one of its lines, then the engine); the other
// side is Stockfish limited to the given Elo, so the openings look like a club player's. Each of Penopi's moves
// in the first plies is scored by full-strength Stockfish (depth 16): loss = best move's score − the played move's.
// Prints the moves that lost 60 centipawns or more with the position, and a summary.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ChessEngine } = require(path.join(root, 'chess', 'engine.js'));
const { BOOK } = await import(path.join(root, 'chess', 'book.js'));
const [gamesArg, msArg, eloArg, seedArg, pliesArg] = process.argv.slice(2);
const GAMES = Number(gamesArg || 10), MS = Number(msArg || 2500), ELO = Number(eloArg || 1600), PLIES = Number(pliesArg || 30);
let seed = Number(seedArg || 1);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const SF = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => fs.existsSync(p)) || 'stockfish';

function uci(opts) {
  const p = spawn(SF);
  let buf = '';
  const queue = [], waiting = [];
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (waiting.length) waiting.shift()(line); else queue.push(line);
    }
  });
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => waiting.push(res)));
  const send = (s) => p.stdin.write(s + '\n');
  const until = async (pred) => { for (;;) { const l = await next(); if (pred(l)) return l; } };
  send('uci');
  for (const [k, v] of Object.entries(opts)) send(`setoption name ${k} value ${v}`);
  return { send, until, quit: () => { send('quit'); p.kill(); } };
}
// score of the side to move, centipawns (mate = ±10000)
async function evalPos(sf, moves) {
  sf.send(`position startpos moves ${moves.join(' ')}`);
  sf.send('go depth 16');
  let sc = 0;
  for (;;) {
    const l = await sf.until((x) => x.startsWith('info') && x.includes(' score ') || x.startsWith('bestmove'));
    if (l.startsWith('bestmove')) return sc;
    const m = l.match(/score (cp|mate) (-?\d+)/);
    if (m) sc = m[1] === 'cp' ? Number(m[2]) : (Number(m[2]) > 0 ? 10000 : -10000);
  }
}

// the site's book: position (FEN without counters) → SAN moves
const R0 = ChessEngine({ ttBits: 8 }), book = new Map();
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
for (const line of BOOK) {
  R0.setStart();
  for (const san of line.split(' ')) {
    const m = R0.legalMoves().find((x) => R0.san(x) === san);
    const k = posKey(R0.fen());
    if (!book.has(k)) book.set(k, new Set());
    book.get(k).add(m);
    R0.play(m);
  }
}

const judge = uci({ Threads: 1, Hash: 64 });
const opp = uci({ Threads: 1, UCI_LimitStrength: 'true', UCI_Elo: ELO });
const losses = [], bad = [];
let bookMoves = 0;
for (let g = 0; g < GAMES; g++) {
  const E = ChessEngine({ ttBits: 20 }), R = ChessEngine({ ttBits: 8 });
  const ourWhite = g % 2 === 0, moves = [];
  let inBook = true;
  opp.send('ucinewgame');
  for (let ply = 0; ply < PLIES && !R.status(); ply++) {
    let m, src = 'engine';
    if ((R.side === 0) === ourWhite) {
      const set = inBook ? book.get(posKey(R.fen())) : null;
      if (set && set.size) { const l = [...set]; m = l[rnd(l.length)]; src = 'book'; bookMoves++; }
      else { inBook = false; m = E.think({ time: MS }).move; }
      const before = await evalPos(judge, moves);
      const san = R.san(m), fen = R.fen();
      const after = -(await evalPos(judge, moves.concat(R.uci(m))));
      const loss = Math.max(0, Math.min(before, 2000) - Math.min(after, 2000));
      if (src === 'engine') losses.push(loss);
      if (loss >= 60) bad.push(`${src} ${Math.ceil((ply + 1) / 2)}${R.side === 0 ? '.' : '...'}${san} loses ${loss} (${before} → ${after})  ${fen}`);
    } else {
      opp.send(`position startpos moves ${moves.join(' ')}`);
      opp.send('go movetime 100');
      const u = (await opp.until((l) => l.startsWith('bestmove'))).split(' ')[1];
      m = R.legalMoves().find((x) => R.uci(x) === u);
    }
    moves.push(R.uci(m)); R.play(m); E.play(m);
  }
}
judge.quit(); opp.quit();
losses.sort((a, b) => a - b);
const avg = losses.reduce((a, b) => a + b, 0) / Math.max(1, losses.length);
console.log(bad.join('\n'));
console.log(`${GAMES} games, ${bookMoves} book moves, ${losses.length} engine moves in the first ${PLIES} plies: average loss ${avg.toFixed(1)} cp, median ${losses[losses.length >> 1]}, ≥60 cp ${losses.filter((x) => x >= 60).length}, ≥150 cp ${losses.filter((x) => x >= 150).length}`);

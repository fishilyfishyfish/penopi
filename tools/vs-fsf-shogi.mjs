// Measures shogi/engine.js against Fairy-Stockfish (measurement only: it is not part of the site).
//   node tools/vs-fsf-shogi.mjs <fsf binary> [games = 10] [our ms = 2500] [fsf ms = 500] [skill = 20] [seed = 1] [random opening plies = 4]
// Colours alternate; each pair starts from the same random opening. Judged by our rules (shogi/engine.js status:
// mate, declaration, repetition, perpetual check; 600 plies is a draw). Draws count half.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ShogiEngine } = require(path.join(root, 'shogi', 'engine.js'));
const [bin, gamesArg, msArg, fmsArg, skillArg, seedArg, openArg] = process.argv.slice(2);
const GAMES = Number(gamesArg || 10), MS = Number(msArg || 2500), FMS = Number(fmsArg || 500), SKILL = Number(skillArg ?? 20), OPEN = Number(openArg ?? 4);
let seed = Number(seedArg || 1);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

function uciEngine() {
  const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const queue = [];
  let waiting = null;
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { queue.push(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    if (waiting) waiting();
  });
  const send = (s) => p.stdin.write(s + '\n');
  const until = async (re) => {
    for (;;) {
      while (queue.length) { const l = queue.shift(); if (re.test(l)) return l; }
      await new Promise((r) => { waiting = r; });
      waiting = null;
    }
  };
  return { send, until, quit: () => { send('quit'); setTimeout(() => p.kill(), 200); } };
}
const F = uciEngine();
F.send('uci'); await F.until(/^uciok/);
F.send('setoption name UCI_Variant value shogi');
F.send(`setoption name Skill Level value ${SKILL}`);
F.send('isready'); await F.until(/^readyok/);

let score = 0;
const t0 = Date.now(), openings = [];
for (let g = 0; g < GAMES; g++) {
  const E = ShogiEngine({ ttBits: 20 }), J = ShogiEngine({ ttBits: 4 });
  if (g % 2 === 0) { // a new random opening for each pair
    J.setStart(); const op = [];
    for (let i = 0; i < OPEN; i++) { const l = J.legalMoves().filter((m) => m !== J.DECLARE); const m = l[rnd(l.length)]; J.play(m); op.push(J.uci(m)); }
    openings.push(op);
  }
  const op = openings[openings.length - 1];
  E.setStart(); J.setStart();
  const ucis = [];
  for (const u of op) { const m = E.legalMoves().find((x) => E.uci(x) === u); E.play(m); J.setStart(); ucis.push(u); }
  J.setStart(); for (const u of ucis) J.play(J.legalMoves().find((x) => J.uci(x) === u));
  const weSente = g % 2 === 0;
  F.send('ucinewgame');
  let st = '';
  for (let k = 0; k < 600 && !(st = J.status()); k++) {
    let m;
    if ((J.side === 0) === weSente) {
      m = E.think({ time: MS }).move;
      if (!J.legalMoves().includes(m)) { console.log('  our move not legal?', J.uci(m)); break; }
    } else {
      F.send(`position startpos moves ${ucis.join(' ')}`.trim());
      F.send(`go movetime ${FMS}`);
      const bm = (await F.until(/^bestmove/)).split(/\s+/)[1];
      m = J.legalMoves().find((x) => J.uci(x) === bm);
      if (m === undefined) { console.log(`  fsf move ${bm} not legal here (${J.fen()}), our rules say so; counting it as our win`); st = 'fsfillegal'; break; }
    }
    ucis.push(J.uci(m)); E.play(m); J.play(m);
  }
  let r;
  if (st === 'fsfillegal') r = 1;
  else if (J.loser >= 0) r = (J.loser === 0) === weSente ? 0 : 1;
  else r = 0.5;
  score += r;
  console.log(`game ${g + 1}: we ${weSente ? '선수' : '후수'}, ${st || 'unfinished'} after ${J.plies} plies → ${r === 1 ? 'win' : r === 0 ? 'loss' : 'draw'}`);
}
F.quit();
console.log(`vs Fairy-Stockfish (skill ${SKILL}, ${FMS} ms): ${score}/${GAMES} (${((Date.now() - t0) / 60000).toFixed(1)} min, us ${MS} ms)`);

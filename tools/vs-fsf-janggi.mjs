// Measures janggi/engine.js against Fairy-Stockfish (measurement only: it is not part of the site).
//   node tools/vs-fsf-janggi.mjs <fsf binary> [games = 10] [our ms = 2500] [fsf ms = 500] [skill = 20] [seed = 1]
// Colours alternate, each 상차림 at random (the same for both colours of a pair). The game is judged by our rules
// (janggi/engine.js status: mate, or counting).
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JanggiEngine } = require(path.join(root, 'janggi', 'engine.js'));
const [bin, gamesArg, msArg, fmsArg, skillArg, seedArg] = process.argv.slice(2);
const GAMES = Number(gamesArg || 10), MS = Number(msArg || 2500), FMS = Number(fmsArg || 500), SKILL = Number(skillArg ?? 20);
let seed = Number(seedArg || 1);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

function uciEngine() {
  const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const lines = [], waiters = [];
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); lines.push(l); }
    while (waiters.length && lines.length) {
      const w = waiters[0];
      const k = lines.findIndex(w.test);
      if (k < 0) { lines.length = 0; break; }
      const l = lines[k]; lines.splice(0, k + 1); waiters.shift(); w.res(l);
    }
  });
  const send = (s) => p.stdin.write(s + '\n');
  const until = (re) => new Promise((res) => { const test = (l) => re.test(l); const k = lines.findIndex(test); if (k >= 0) { const l = lines[k]; lines.splice(0, k + 1); res(l); } else waiters.push({ test, res }); });
  return { send, until, quit: () => { send('quit'); setTimeout(() => p.kill(), 200); } };
}

const F = uciEngine();
F.send('uci'); await F.until(/^uciok/);
F.send('setoption name UCI_Variant value janggi');
F.send(`setoption name Skill Level value ${SKILL}`);
F.send('isready'); await F.until(/^readyok/);

let wins = 0, counted = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const E = JanggiEngine({ ttBits: 20 }), J = JanggiEngine({ ttBits: 4 });
  if (g % 2 === 0) { E.arr = [rnd(4), rnd(4)]; globalThis.lastArr = E.arr; } else E.arr = globalThis.lastArr;
  E.setup(...E.arr); J.setup(...E.arr);
  const startFen = E.fen(), ucis = [];
  const weCho = g % 2 === 0;
  F.send('ucinewgame');
  for (let k = 0; k < 220 && !J.status(); k++) {
    let m;
    if ((J.side === J.CHO) === weCho) m = E.think({ time: MS }).move;
    else {
      F.send(`position fen ${startFen}${ucis.length ? ' moves ' + ucis.join(' ') : ''}`);
      F.send(`go movetime ${FMS}`);
      const bm = (await F.until(/^bestmove/)).split(/\s+/)[1];
      m = J.legalMoves().find((x) => J.uci(x) === bm);
      if (m === undefined) { console.log(`  fsf move ${bm} not legal here (${J.fen()}); stopping the game`); break; }
    }
    ucis.push(J.uci(m));
    E.play(m); J.play(m);
  }
  const st = J.status(), winner = st === 'mate' ? J.side ^ 8 : st ? J.countWinner() : -1;
  const won = winner === (weCho ? J.CHO : J.HAN);
  if (won) wins++;
  if (st.startsWith('count')) counted++;
  console.log(`game ${g + 1}: we ${weCho ? '초' : '한'}, ${st || 'unfinished'} after ${J.plies} plies, points 초 ${J.points(J.CHO)} 한 ${J.points(J.HAN)} → ${won ? 'win' : 'loss'}`);
}
F.quit();
console.log(`vs Fairy-Stockfish (skill ${SKILL}, ${FMS} ms): ${wins}/${GAMES}, ${counted} by counting (${((Date.now() - t0) / 60000).toFixed(1)} min, us ${MS} ms)`);

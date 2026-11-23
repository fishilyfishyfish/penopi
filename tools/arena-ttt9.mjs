// Engine vs engine for ttt9/engine.js: node tools/arena-ttt9.mjs <A> <B> [pairs=20] [seed=7]
// A player: nodes:N (fixed nodes), ms:T (time), random. Each pair starts from the same 2 random opening moves and swaps sides.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Ttt9Engine } = require(path.join(root, 'ttt9', 'engine.js'));
const [specA, specB, pairsArg, seedArg] = process.argv.slice(2);
const pairs = Number(pairsArg || 20);
let seed = Number(seedArg || 7);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

function player(spec) {
  const [kind, val] = spec.split(':');
  const E = Ttt9Engine({ ttBits: 18 });
  if (kind === 'random') return (moves) => { E.setStart(); for (const m of moves) E.play(m); const l = E.legalMoves(); return l[rnd(l.length)]; };
  const cfg = kind === 'ms' ? { time: Number(val) } : { nodes: Number(val) };
  return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think(cfg).move; };
}
function game(first, second, opening) { // winner 1 (first mover) / 2 / 0 draw
  const R = Ttt9Engine({ ttBits: 8 });
  const moves = opening.slice();
  R.setStart(); for (const m of moves) R.play(m);
  while (R.status() !== 'over') {
    const m = (R.stm === 1 ? first : second)(moves);
    moves.push(m); R.play(m);
  }
  return R.result === 1 || R.result === 2 ? R.result : 0;
}
let score = 0, n = 0, draws = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const R = Ttt9Engine({ ttBits: 8 }), opening = [];
  R.setStart();
  for (let k = 0; k < 2; k++) { const l = R.legalMoves(); const m = l[rnd(l.length)]; opening.push(m); R.play(m); }
  const w1 = game(player(specA), player(specB), opening); score += w1 === 1 ? 1 : w1 === 0 ? 0.5 : 0; if (!w1) draws++;
  const w2 = game(player(specB), player(specA), opening); score += w2 === 2 ? 1 : w2 === 0 ? 0.5 : 0; if (!w2) draws++;
  n += 2;
}
const p = score / n, se = Math.sqrt(p * (1 - p) / n);
const elo = (q) => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
console.log(`${specA} vs ${specB}: ${score}/${n} = ${(100 * p).toFixed(0)}% ±${(196 * se).toFixed(0)}, Elo ${elo(p).toFixed(0)}, draws ${draws} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

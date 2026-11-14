// Engine vs engine for reversi/engine.js: node tools/arena-reversi.mjs <A> <B> [pairs=10]
// A player is "nodes:N" (search budget) optionally with ",key=value" weight overrides, e.g. nodes:50000,mob=0.
// Each pair starts from the same 2 random opening moves and swaps sides. Prints A's score.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ReversiEngine } = require(path.join(root, 'reversi', 'engine.js'));
const [specA, specB, pairsArg, seedArg] = process.argv.slice(2);
const pairs = Number(pairsArg || 10);
let seed = Number(seedArg || 7);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

function player(spec) {
  const [head, ...kv] = spec.split(',');
  const nodes = Number(head.split(':')[1]);
  const weights = {};
  for (const p of kv) { const [k, v] = p.split('='); weights[k] = Number(v); }
  const E = ReversiEngine({ ttBits: 18, weights });
  return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think({ nodes }).move; };
}
function game(first, second, opening) { // returns the winner 0 (black) / 1, or −1 for a draw
  const R = ReversiEngine({ ttBits: 8 });
  const moves = opening.slice();
  R.setStart(); for (const m of moves) R.play(m);
  while (R.status() !== 'over') {
    const m = (R.stm === 1 ? first : second)(moves);
    moves.push(m); R.play(m);
  }
  const b = R.count(1), w = R.count(2);
  return b > w ? 0 : w > b ? 1 : -1;
}
let score = 0, n = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const R = ReversiEngine({ ttBits: 8 }), opening = [];
  R.setStart();
  for (let k = 0; k < 4; k++) { const l = R.legalMoves(); const m = l[rnd(l.length)]; opening.push(m); R.play(m); }
  const w1 = game(player(specA), player(specB), opening); score += w1 === 0 ? 1 : w1 === -1 ? 0.5 : 0;
  const w2 = game(player(specB), player(specA), opening); score += w2 === 1 ? 1 : w2 === -1 ? 0.5 : 0;
  n += 2;
}
const p = score / n, se = Math.sqrt(p * (1 - p) / n);
const elo = (q) => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
console.log(`${specA} vs ${specB}: ${score}/${n} = ${(100 * p).toFixed(0)}% ±${(196 * se).toFixed(0)}, Elo ${elo(p).toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

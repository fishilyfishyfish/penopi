// Engine vs engine for dots/engine.js: node tools/arena-dots.mjs <A> <B> [pairs=10] [seed=7] [size=4]
// A player is "nodes:N" optionally with ",key=value" weight overrides. Each pair starts from the same 4 random safe
// lines and swaps who moves first. Prints A's score.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DotsEngine } = require(path.join(root, 'dots', 'engine.js'));
const [specA, specB, pairsArg, seedArg, sizeArg] = process.argv.slice(2);
const pairs = Number(pairsArg || 10), N = Number(sizeArg || 4);
let seed = Number(seedArg || 7);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
function player(spec) {
  const [head, ...kv] = spec.split(',');
  const nodes = Number(head.split(':')[1]), weights = {};
  for (const p of kv) { const [k, v] = p.split('='); weights[k] = Number(v); }
  const E = DotsEngine({ rows: N, cols: N, ttBits: 18, weights });
  return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think({ nodes }).move; };
}
function game(first, second, opening) { // 0 first player won, 1 second, −1 draw
  const R = DotsEngine({ rows: N, cols: N, ttBits: 8 }), moves = opening.slice();
  for (const m of moves) R.play(m);
  while (R.status() !== 'over') { const m = (R.stm === 1 ? first : second)(moves); moves.push(m); R.play(m); }
  return R.score(1) > R.score(2) ? 0 : R.score(2) > R.score(1) ? 1 : -1;
}
let score = 0, n = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const R = DotsEngine({ rows: N, cols: N, ttBits: 8 }), opening = [];
  for (let k = 0; k < 4; k++) { const s = R.legalMoves().filter((l) => R.safe(l)); const m = s[rnd(s.length)]; opening.push(m); R.play(m); }
  const w1 = game(player(specA), player(specB), opening); score += w1 === 0 ? 1 : w1 === -1 ? 0.5 : 0;
  const w2 = game(player(specB), player(specA), opening); score += w2 === 1 ? 1 : w2 === -1 ? 0.5 : 0;
  n += 2;
}
const p = score / n, se = Math.sqrt(p * (1 - p) / n);
console.log(`${specA} vs ${specB}: ${score}/${n} = ${(100 * p).toFixed(0)}% ±${(196 * se).toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

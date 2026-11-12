// Engine vs engine for draughts/engine.js: node tools/arena-draughts.mjs <A> <B> [pairs=10]
// A player is "nodes:N" (search budget) optionally with ",key=value" weight overrides, e.g. nodes:20000,king=250.
// Each pair starts from the same 2 random opening moves and swaps colours. Prints A's score.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DraughtsEngine } = require(path.join(root, 'draughts', 'engine.js'));
const [specA, specB, pairsArg] = process.argv.slice(2);
const pairs = Number(pairsArg || 10);
let seed = 7;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

function player(spec) {
  const [head, ...kv] = spec.split(',');
  const nodes = Number(head.split(':')[1]);
  const weights = {};
  for (const p of kv) { const [k, v] = p.split('='); weights[k] = Number(v); }
  const E = DraughtsEngine({ ttBits: 18, weights });
  return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think({ nodes, soft: 1 }).move; };
}
function game(white, black, opening) {
  const R = DraughtsEngine({ ttBits: 8 });
  const moves = opening.slice();
  R.setStart(); for (const m of moves) R.play(m);
  for (let k = 0; k < 400; k++) {
    const side = R.stm;
    const m = (side === 1 ? white : black)(moves);
    moves.push(m); R.play(m);
    const st = R.status();
    if (st === 'win') return side;
    if (st) return 0;
  }
  return 0;
}
let score = 0, n = 0;
const t0 = Date.now();
for (let i = 0; i < pairs; i++) {
  const R = DraughtsEngine({ ttBits: 8 }), opening = [];
  R.setStart();
  for (let k = 0; k < 2; k++) { const l = R.legalMoves(); const m = l[rnd(l.length)]; opening.push(m); R.play(m); }
  const a = player(specA), b = player(specB);
  const w1 = game(a, b, opening); score += w1 === 1 ? 1 : w1 === 0 ? 0.5 : 0;
  const a2 = player(specA), b2 = player(specB);
  const w2 = game(b2, a2, opening); score += w2 === 2 ? 1 : w2 === 0 ? 0.5 : 0;
  n += 2;
}
const p = score / n, se = Math.sqrt(p * (1 - p) / n);
const elo = (q) => (q <= 0 ? -Infinity : q >= 1 ? Infinity : -400 * Math.log10(1 / q - 1));
console.log(`${specA} vs ${specB}: ${score}/${n} = ${(100 * p).toFixed(0)}% ±${(196 * se).toFixed(0)}, Elo ${elo(p).toFixed(0)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

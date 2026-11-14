// Engine vs engine for go/engine.js: node tools/arena-go.mjs <A> <B> [games=10] [seed=1]
// A player is "playouts:N" (or "ms:T") with ",key=value" engine options (patterns=0, raveK=…, uct=…) or ",file=path" for
// another engine file. Colours alternate; the first two moves are random; the result is counted by a referee engine.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GoEngine } = require(path.join(root, 'go', 'engine.js'));
const [specA, specB, gamesArg, seedArg] = process.argv.slice(2);
const GAMES = Number(gamesArg || 10);
let seed = Number(seedArg || 1);
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
function player(spec) {
  const [head, ...kv] = spec.split(',');
  const [kind, val] = head.split(':'), o = {};
  let Eng = GoEngine;
  for (const p of kv) { const [k, v] = p.split('='); if (k === 'file') Eng = require(path.resolve(v)).GoEngine; else o[k] = Number(v); }
  const E = Eng(o), cfg = kind === 'ms' ? { time: Number(val) } : { playouts: Number(val) };
  return { E, move: () => { const i = E.think(cfg); return i.resign ? 'resign' : i.move; } };
}
let score = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const a = player(specA), b = player(specB), ref = GoEngine();
  const aBlack = g % 2 === 0;
  let result = null;
  for (let k = 0; k < 2; k++) { const l = ref.legalMoves().filter((m) => m >= 0); const m = l[rnd(l.length)]; a.E.play(m); b.E.play(m); ref.play(m); }
  for (let k = 0; k < 220 && ref.status() !== 'over'; k++) {
    const mover = (ref.stm === 1) === aBlack ? a : b;
    const m = mover.move();
    if (m === 'resign') { result = mover === a ? 'B' : 'A'; break; }
    a.E.play(m); b.E.play(m); ref.play(m);
  }
  if (!result) { const est = ref.estimate(300); const blackWon = est.margin > 0; result = blackWon === aBlack ? 'A' : 'B'; }
  if (result === 'A') score++;
}
console.log(`${specA} vs ${specB}: ${score}/${GAMES} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

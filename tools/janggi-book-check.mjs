// Scores janggi/book.js with Fairy-Stockfish (measurement only: it is not part of the site) and, with --write,
// drops book moves that lose more than `loss` centipawns against Fairy-Stockfish's best move (a position keeps at
// least its best-scoring book move).
//   node tools/janggi-book-check.mjs <fsf binary> [depth = 14] [loss = 80] [--write]
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JanggiEngine } = createRequire(import.meta.url)(path.join(root, 'janggi', 'engine.js'));
const { BOOK } = await import(path.join(root, 'janggi', 'book.js'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [bin, depthArg, lossArg] = args, WRITE = process.argv.includes('--write');
const DEPTH = Number(depthArg || 14), LOSS = Number(lossArg || 80);

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
// score (centipawns, side to move) of the position, optionally only this move
async function score(fen, move) {
  send(`position fen ${fen}`);
  send(`go depth ${DEPTH}${move ? ' searchmoves ' + move : ''}`);
  let last = null;
  for (;;) {
    while (!queue.length) { await new Promise((r) => { waiting = r; }); waiting = null; }
    const l = queue.shift();
    if (l.startsWith('info') && / score /.test(l)) last = l;
    if (l.startsWith('bestmove')) break;
  }
  const m = / score (cp|mate) (-?\d+)/.exec(last || '');
  if (!m) return 0;
  return m[1] === 'cp' ? Number(m[2]) : Math.sign(Number(m[2])) * 30000;
}
send('uci');
send('setoption name UCI_Variant value janggi');
send('setoption name Threads value 4');
send('isready');
for (;;) { while (!queue.length) { await new Promise((r) => { waiting = r; }); waiting = null; } if (queue.shift() === 'readyok') break; }

const E = JanggiEngine({ ttBits: 4 });
const out = {};
let moves = 0, dropped = 0, worst = 0;
const t0 = Date.now();
const keys = Object.keys(BOOK);
for (const [i, k] of keys.entries()) {
  const fen = k + ' - - 0 1';
  E.setFen(fen);
  const best = await score(fen, null), scored = [];
  for (const u of BOOK[k]) {
    if (!E.legalMoves().some((x) => E.uci(x) === u)) throw new Error(`illegal book move ${u} in ${k}`);
    scored.push({ u, s: await score(fen, u) });
    moves++;
  }
  scored.sort((a, b) => b.s - a.s);
  const keep = scored.filter((x, j) => j === 0 || best - x.s <= LOSS);
  for (const x of scored) { const l = best - x.s; if (l > worst) worst = l; if (l > LOSS) console.log(`  ${k}: ${x.u} loses ${l} cp${keep.includes(x) ? ' (kept: the best book move here)' : ''}`); }
  dropped += scored.length - keep.length;
  out[k] = keep.map((x) => x.u);
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${keys.length} positions, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
send('quit');
console.log(`${keys.length} positions, ${moves} book moves scored at depth ${DEPTH}: ${dropped} lose more than ${LOSS} cp (worst ${worst})`);
if (WRITE) {
  const file = path.join(root, 'janggi', 'book.js'), src = fs.readFileSync(file, 'utf8');
  const head = src.slice(0, src.indexOf('export const BOOK'));
  const body = Object.entries(out).map(([k, ms]) => `  '${k}': ${JSON.stringify(ms)},`).join('\n');
  fs.writeFileSync(file, `${head.trimEnd()}\n// Checked with tools/janggi-book-check.mjs (Fairy-Stockfish depth ${DEPTH}, moves losing more than ${LOSS} cp dropped).\nexport const BOOK = {\n${body}\n};\n`);
  console.log('janggi/book.js updated');
}

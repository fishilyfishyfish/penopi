// Checks chess/book.js with Stockfish (measurement only): every book move Penopi may choose is scored against
// Stockfish's best move in that position; moves that lose 50 centipawns or more are printed.
//   node tools/chess-book-check.mjs [depth = 14] [shard i/n, e.g. 0/4]
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ChessEngine } = require(path.join(root, 'chess', 'engine.js'));
const { BOOK, parseLine } = await import(path.join(root, 'chess', 'book.js'));
const [depthArg, shardArg] = process.argv.slice(2);
const DEPTH = Number(depthArg || 14);
const [si, sn] = (shardArg || '0/1').split('/').map(Number);
const SF = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => fs.existsSync(p)) || 'stockfish';

const p = spawn(SF);
let buf = '';
const queue = [], waiting = [];
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (waiting.length) waiting.shift()(line); else queue.push(line); }
});
const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => waiting.push(res)));
const send = (s) => p.stdin.write(s + '\n');
async function evalFen(fen) { // side to move, centipawns
  send(`position fen ${fen}`); send(`go depth ${DEPTH}`);
  let sc = 0;
  for (;;) {
    const l = await next();
    if (l.startsWith('bestmove')) return sc;
    const m = l.match(/ score (cp|mate) (-?\d+)/);
    if (m) sc = m[1] === 'cp' ? Number(m[2]) : (Number(m[2]) > 0 ? 10000 : -10000);
  }
}
send('uci'); send('setoption name Hash value 64');

// every (position, choosable move) once
const E = ChessEngine({ ttBits: 8 }), todo = new Map();
for (const line of BOOK) {
  const { only, sans } = parseLine(line);
  E.setStart();
  for (const san of sans) {
    const m = E.legalMoves().find((x) => E.san(x).replace(/[+#]/g, '') === san.replace(/[+#]/g, ''));
    const side = E.side === 0 ? 'w' : 'b';
    if (!only || only === side) { const k = E.fen() + '|' + san; if (!todo.has(k)) todo.set(k, { fen: E.fen(), san, uci: E.uci(m), line }); }
    E.play(m);
  }
}
const items = [...todo.values()].filter((_, i) => i % sn === si);
let bad = 0;
for (const it of items) {
  const best = await evalFen(it.fen);
  E.setFen(it.fen);
  const m = E.legalMoves().find((x) => E.uci(x) === it.uci);
  E.play(m);
  const after = -(await evalFen(E.fen()));
  const loss = Math.min(best, 2000) - Math.min(after, 2000);
  if (loss >= 50) { bad++; console.log(`${it.san} loses ${loss} (${best} → ${after})  ${it.fen}  [${it.line}]`); }
}
send('quit'); p.kill();
console.log(`${items.length} book moves checked, ${bad} lose 50 cp or more`);

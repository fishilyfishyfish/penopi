// Tactics test for chess/engine.js: solve EPD positions ("bm" = best move(s), "am" = move(s) to avoid).
//   node tools/wac.mjs <file.epd> [ms per position = 2500] [shard i/n, e.g. 0/4]
// The usual file is the 300 "Win at Chess" positions (wacnew.epd, e.g. from the Arasan engine's tests folder);
// it isn't kept in this repo. Prints the score and the failed positions.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ChessEngine } = require(path.join(root, 'chess', 'engine.js'));
const [file, msArg, shardArg] = process.argv.slice(2);
const ms = Number(msArg || 2500);
const [si, sn] = (shardArg || '0/1').split('/').map(Number);
const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const E = ChessEngine({ ttBits: 20 });
let ok = 0, n = 0;
const fails = [];
lines.forEach((line, i) => {
  if (i % sn !== si) return;
  const m = line.match(/^(\S+ \S+ \S+ \S+)\s+(.*)$/);
  const fen = m[1] + ' 0 1', ops = m[2];
  const id = (ops.match(/id "([^"]+)"/) || [])[1] || `#${i + 1}`;
  const bm = (ops.match(/bm ([^;]+);/) || [])[1], am = (ops.match(/am ([^;]+);/) || [])[1];
  E.setFen(fen); E.ttClear();
  const info = E.think({ time: ms });
  const got = E.san(info.move).replace(/[+#]/g, '');
  const norm = (s) => s.split(/\s+/).map((x) => x.replace(/[+#!?]/g, ''));
  const good = bm ? norm(bm).includes(got) : !norm(am).includes(got);
  n++;
  if (good) ok++; else fails.push(`${id} got ${got} want ${bm ? bm : 'not ' + am} (depth ${info.depth})`);
});
console.log(JSON.stringify({ ok, n, fails }));

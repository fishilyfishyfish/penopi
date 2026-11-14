// Measures go/engine.js against GNU Go (measurement only: GNU Go is not part of the site; apt install gnugo).
//   node tools/vs-gnugo.mjs [games = 4] [our ms per move = 2500] [gnugo level = 10] [seed = 1]
// Colours alternate. The result is GNU Go's final_score (area scoring, komi 7.5) once both pass or after 200 moves.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GoEngine } = require(path.join(root, 'go', 'engine.js'));
const [gamesArg, msArg, levelArg] = process.argv.slice(2);
const GAMES = Number(gamesArg || 4), MS = Number(msArg || 2500), LEVEL = Number(levelArg || 10);
const GG = ['/usr/games/gnugo', '/usr/bin/gnugo'].find((p) => fs.existsSync(p)) || 'gnugo';
const COLS = 'ABCDEFGHJ';
const toGtp = (s) => (s < 0 ? 'pass' : COLS[s % 9] + (9 - Math.floor(s / 9)));
const fromGtp = (v) => (/pass/i.test(v) ? -1 : (9 - Number(v.slice(1))) * 9 + COLS.indexOf(v[0].toUpperCase()));

function gtp() {
  const p = spawn(GG, ['--mode', 'gtp', '--level', String(LEVEL), '--chinese-rules', '--komi', '7.5']);
  let buf = '';
  const waiting = [];
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const r = buf.slice(0, i).trim(); buf = buf.slice(i + 2); const w = waiting.shift(); if (w) w(r.replace(/^[=?]\s*/, '')); }
  });
  const ask = (cmd) => new Promise((res) => { waiting.push(res); p.stdin.write(cmd + '\n'); });
  return { ask, quit: () => { p.stdin.write('quit\n'); p.kill(); } };
}

let wins = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const gg = gtp(), E = GoEngine();
  await gg.ask('boardsize 9'); await gg.ask('clear_board'); await gg.ask('komi 7.5');
  const weBlack = g % 2 === 0;
  let passes = 0, k_last = 0;
  for (let k = 0; k < 200 && passes < 2; k++) {
    k_last = k;
    const ours = (E.stm === 1) === weBlack;
    let m;
    if (ours) { const info = E.think({ time: MS }); if (info.resign) { passes = 4; break; } m = info.move; await gg.ask(`play ${E.stm === 1 ? 'b' : 'w'} ${toGtp(m)}`); }
    else {
      const v = await gg.ask(`genmove ${E.stm === 1 ? 'b' : 'w'}`);
      if (/resign/i.test(v)) { passes = 3; break; }
      m = fromGtp(v);
    }
    passes = m < 0 ? passes + 1 : 0;
    E.play(m);
  }
  if (passes === 4) console.log('  we resigned after', k_last, 'moves');
  const fs2 = passes === 3 ? (weBlack ? 'B+R' : 'W+R') : passes === 4 ? (weBlack ? 'W+R' : 'B+R') : await gg.ask('final_score');
  const blackWon = /^B/.test(fs2), won = blackWon === weBlack;
  if (won) wins++;
  console.log(`game ${g + 1}: we ${weBlack ? 'Black' : 'White'}, ${fs2} → ${won ? 'win' : 'loss'}`);
  gg.quit();
}
console.log(`vs GNU Go level ${LEVEL}: ${wins}/${GAMES} (${((Date.now() - t0) / 60000).toFixed(1)} min, ${MS} ms per move)`);

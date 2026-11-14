// Tests for reversi/engine.js (run in CI): node tools/test-reversi.mjs
//  1. perft against the published counts (passes included) and every position of random games against a naive
//     implementation (legal moves, flips, passes, the end and the count);
//  2. small endings: the engine's exact result agrees with a plain exhaustive search;
//  3. search: beats a random and a greedy player.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ReversiEngine } = require(path.join(root, 'reversi', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 41;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- 1. perft and the naive implementation ----------
{
  const E = ReversiEngine({ ttBits: 10 });
  const want = [1, 4, 12, 56, 244, 1396, 8200, 55092, 390216];
  for (let d = 1; d < want.length; d++) { E.setStart(); check(E.perft(d) === want[d], `perft(${d}) = ${E.perft(d)}, want ${want[d]}`); }
  console.log(`perft 1..${want.length - 1} match the published counts`);
}
// naive: an 8×8 array of rows, walk each direction step by step
const N = {
  start() { const b = Array.from({ length: 8 }, () => Array(8).fill(0)); b[3][3] = 1; b[3][4] = 2; b[4][3] = 2; b[4][4] = 1; return { b, side: 1 }; },
  flips(st, r, c) {
    if (st.b[r][c]) return [];
    const me = st.side, op = 3 - me, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const line = [];
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && st.b[rr][cc] === op) { line.push([rr, cc]); rr += dr; cc += dc; }
      if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && st.b[rr][cc] === me) out.push(...line);
    }
    return out;
  },
  moves(st) { const out = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (N.flips(st, r, c).length) out.push(r * 8 + c); return out; },
  play(st, s) {
    const b = st.b.map((row) => row.slice()), n = { b, side: 3 - st.side };
    if (s < 0) return n;
    const r = s >> 3, c = s & 7;
    for (const [rr, cc] of N.flips(st, r, c)) b[rr][cc] = st.side;
    b[r][c] = st.side;
    return n;
  },
  over(st) { return !N.moves(st).length && !N.moves({ b: st.b, side: 3 - st.side }).length; },
  count(st, c) { let n = 0; for (const row of st.b) for (const v of row) if (v === c) n++; return n; },
};
{
  const E = ReversiEngine({ ttBits: 10 });
  let positions = 0, passes = 0, ends = 0;
  for (let g = 0; g < 150; g++) {
    E.setStart();
    let st = N.start();
    for (let k = 0; k < 130; k++) {
      positions++;
      const over = N.over(st);
      if (over !== (E.status() === 'over')) { check(false, `game ${g} ply ${k}: end differs`); break; }
      if (over) {
        ends++;
        check(E.count(1) === N.count(st, 1) && E.count(2) === N.count(st, 2), `game ${g}: count ${E.count(1)}:${E.count(2)}`);
        break;
      }
      let nm = N.moves(st);
      if (!nm.length) nm = [-1];
      const em = E.legalMoves();
      if (em.join() !== nm.join()) { check(false, `game ${g} ply ${k}: moves ${em} vs ${nm}`); break; }
      const m = em[rnd(em.length)];
      if (m < 0) passes++;
      else {
        const f = E.flipsOf(m).sort((a, b) => a - b).join(), nf = N.flips(st, m >> 3, m & 7).map(([r, c]) => r * 8 + c).sort((a, b) => a - b).join();
        check(f === nf, `game ${g} ply ${k}: flips of ${m}`);
      }
      E.play(m); st = N.play(st, m);
      const cells = Array.from(E.cells()).join(), nc = st.b.flat().join();
      if (cells !== nc) { check(false, `game ${g} ply ${k}: board differs`); break; }
    }
  }
  check(passes > 5 && ends > 100, `random games should include passes (${passes}) and ends (${ends})`);
  console.log(`random games: ${positions} positions match the naive implementation (${passes} passes, ${ends} ends)`);
}

// ---------- 2. small endings vs an exhaustive search ----------
function solve(st, passed) { // best final disc difference for the side to move
  const ms = N.moves(st);
  if (!ms.length) {
    if (passed) return N.count(st, st.side) - N.count(st, 3 - st.side);
    return -solve(N.play(st, -1), true);
  }
  let best = -99;
  for (const m of ms) best = Math.max(best, -solve(N.play(st, m), false));
  return best;
}
{
  let tried = 0, agree = 0;
  for (let t = 0; t < 40; t++) {
    // play a random game until 9 squares are left
    const E = ReversiEngine({ ttBits: 16 });
    let st = N.start();
    while (60 - (N.count(st, 1) + N.count(st, 2) - 4) > 9 && !N.over(st)) {
      let ms = N.moves(st);
      if (!ms.length) ms = [-1];
      const m = ms[rnd(ms.length)];
      st = N.play(st, m); E.play(m);
    }
    if (N.over(st)) continue;
    tried++;
    const want = solve(st, false), info = E.think({ depth: 64 });
    if (info.exact && info.final === want) agree++;
    else check(false, `ending ${t}: exhaustive ${want}, engine exact=${info.exact} final=${info.final}`);
  }
  console.log(`endings: the engine's exact result agrees with the exhaustive search in ${agree} of ${tried}`);
}

// ---------- 3. search ----------
{
  const E = ReversiEngine({ ttBits: 16 });
  const greedy = (R) => { let best = -1, bm = R.PASS; for (const m of R.legalMoves()) { const n = m < 0 ? 0 : R.flipsOf(m).length; if (n > best) { best = n; bm = m; } } return bm; };
  for (const opp of ['random', 'greedy']) {
    let wins = 0;
    for (let g = 0; g < 6; g++) {
      const A = ReversiEngine({ ttBits: 16 }), R = ReversiEngine({ ttBits: 8 });
      const engBlack = g % 2 === 0;
      while (R.status() !== 'over') {
        const mine = (R.stm === 1) === engBlack;
        let m;
        if (mine) m = A.think({ nodes: 20000 }).move;
        else if (opp === 'greedy') m = greedy(R);
        else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
        A.play(m); R.play(m);
      }
      const me = engBlack ? 1 : 2;
      if (R.count(me) > R.count(3 - me)) wins++;
    }
    check(wins === 6, `engine won ${wins} of 6 against ${opp}`);
    console.log(`search: ${wins}/6 against ${opp}`);
  }
  const S = ReversiEngine({ ttBits: 20 });
  const t = S.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${t.depth}, ${t.nodes} nodes, ${S.NAME(t.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

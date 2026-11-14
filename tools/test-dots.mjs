// Tests for dots/engine.js (run in CI): node tools/test-dots.mjs
//  1. every position of random games against a naive implementation (boxes claimed, who moves next, the score);
//  2. exact results (with the search's claiming / double-dealing reduction) against a plain full search over
//     every line, on small boards from random positions;
//  3. search: beats a random player and a greedy one (claims what it can, avoids giving boxes away).
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DotsEngine } = require(path.join(root, 'dots', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 29;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- naive: lines as dot pairs in a set, boxes found by checking their four sides ----------
function naive(R, C) {
  const lines = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) lines.push(`${r},${c}-${r},${c + 1}`);
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) lines.push(`${r},${c}-${r + 1},${c}`);
  return { R, C, lines, drawn: new Set(), owner: {}, side: 1, score: [0, 0, 0] };
}
const boxDone = (st, r, c) => [`${r},${c}-${r},${c + 1}`, `${r + 1},${c}-${r + 1},${c + 1}`, `${r},${c}-${r + 1},${c}`, `${r},${c + 1}-${r + 1},${c + 1}`].every((k) => st.drawn.has(k));
function naivePlay(st, i) {
  const n = { ...st, drawn: new Set(st.drawn), owner: { ...st.owner }, score: st.score.slice() };
  n.drawn.add(st.lines[i]);
  let g = 0;
  for (let r = 0; r < st.R; r++) for (let c = 0; c < st.C; c++) if (!n.owner[`${r},${c}`] && boxDone(n, r, c)) { n.owner[`${r},${c}`] = st.side; g++; }
  n.score[st.side] += g;
  if (!g) n.side = 3 - st.side;
  return n;
}
// plain full search: best final margin of the boxes still free, for the side to move
function naiveSolve(st, memo = new Map()) {
  const free = st.lines.map((_, i) => i).filter((i) => !st.drawn.has(st.lines[i]));
  if (!free.length) return 0;
  const key = st.side + ':' + free.join(',');
  if (memo.has(key)) return memo.get(key);
  let best = -99;
  for (const i of free) {
    const n = naivePlay(st, i), g = n.score[st.side] - st.score[st.side];
    const v = n.side === st.side ? g + naiveSolve(n, memo) : -naiveSolve(n, memo);
    if (v > best) best = v;
  }
  memo.set(key, best);
  return best;
}

{
  let positions = 0, claims = 0;
  for (const [R, C] of [[2, 2], [3, 3], [4, 4], [3, 5]]) {
    for (let g = 0; g < 40; g++) {
      const E = DotsEngine({ rows: R, cols: C, ttBits: 8 });
      let st = naive(R, C);
      for (let k = 0; k < E.E; k++) {
        positions++;
        const l = E.legalMoves()[rnd(E.legalMoves().length)];
        const before = E.score(1) + E.score(2);
        E.play(l); st = naivePlay(st, l);
        if (E.score(1) + E.score(2) > before) claims++;
        if (E.stm !== st.side || E.score(1) !== st.score[1] || E.score(2) !== st.score[2]) { check(false, `${R}x${C} game ${g} move ${k}: engine side ${E.stm} ${E.score(1)}:${E.score(2)}, naive ${st.side} ${st.score[1]}:${st.score[2]}`); break; }
      }
      check(E.status() === 'over', 'game over after every line');
    }
  }
  console.log(`random games: ${positions} positions match the naive implementation (${claims} claiming moves)`);
}

{
  let tried = 0, agree = 0;
  for (const [R, C, pre] of [[2, 2, 0], [2, 2, 3], [2, 3, 6], [3, 2, 6], [3, 3, 12], [3, 3, 14], [2, 4, 9]]) {
    for (let t = 0; t < 8; t++) {
      const E = DotsEngine({ rows: R, cols: C, ttBits: 16 });
      let st = naive(R, C);
      for (let k = 0; k < pre; k++) { const ls = E.legalMoves(); const l = ls[rnd(ls.length)]; E.play(l); st = naivePlay(st, l); }
      if (E.status()) continue;
      tried++;
      const want = naiveSolve(st), info = E.think({ depth: 100 });
      if (info.exact && info.final === want) agree++;
      else check(false, `${R}x${C} after ${pre} lines: full search ${want}, engine exact=${info.exact} final=${info.final}`);
    }
  }
  console.log(`exact results agree with the full search in ${agree} of ${tried} positions`);
  check(agree > 30, 'enough exact positions');
}

{
  const greedy = (E) => { // claim if possible, else a safe line, else anything
    const ls = E.legalMoves();
    const c = ls.filter((l) => E.claims(l)); if (c.length) return c[rnd(c.length)];
    const s = ls.filter((l) => E.safe(l)); if (s.length) return s[rnd(s.length)];
    return ls[rnd(ls.length)];
  };
  for (const opp of ['random', 'greedy']) {
    let wins = 0;
    for (let g = 0; g < 6; g++) {
      const A = DotsEngine({ rows: 4, cols: 4, ttBits: 18 }), Rf = DotsEngine({ rows: 4, cols: 4, ttBits: 8 });
      const engFirst = g % 2 === 0;
      while (Rf.status() !== 'over') {
        const mine = (Rf.stm === 1) === engFirst;
        let m;
        if (mine) m = A.think({ nodes: 150000 }).move;
        else if (opp === 'greedy') m = greedy(Rf);
        else { const ls = Rf.legalMoves(); m = ls[rnd(ls.length)]; }
        A.play(m); Rf.play(m);
      }
      const me = engFirst ? 1 : 2;
      if (Rf.score(me) > Rf.score(3 - me)) wins++;
    }
    check(wins === 6, `engine won ${wins} of 6 against ${opp}`);
    console.log(`search (4×4): ${wins}/6 against ${opp}`);
  }
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

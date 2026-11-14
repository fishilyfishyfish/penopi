// Tests for go/engine.js (run in CI): node tools/test-go.mjs
//  1. every position of random games against a naive implementation (legal moves with superko, the board after each
//     move, captures) and the area score against a plain count;
//  2. dead-stone finding on a hand-made finished position;
//  3. search: beats a random player; captures a string in atari.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GoEngine } = require(path.join(root, 'go', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 17;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const N = 9;

// ---------- naive: a 2D array, groups by flood fill, superko by comparing whole boards ----------
const nb = (r, c) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && a < N && b >= 0 && b < N);
function group(b, r, c) {
  const col = b[r][c], seen = new Set([r * N + c]), stack = [[r, c]], libs = new Set();
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [a, bb] of nb(x, y)) {
      if (b[a][bb] === 0) libs.add(a * N + bb);
      else if (b[a][bb] === col && !seen.has(a * N + bb)) { seen.add(a * N + bb); stack.push([a, bb]); }
    }
  }
  return { stones: [...seen], libs: libs.size };
}
function naivePlay(b, s, col) { // returns {board, caps} or null if illegal (ignoring superko)
  const r = Math.floor(s / N), c = s % N;
  if (b[r][c]) return null;
  const n = b.map((row) => row.slice());
  n[r][c] = col;
  let caps = 0;
  for (const [a, bb] of nb(r, c)) {
    if (n[a][bb] === 3 - col) { const g = group(n, a, bb); if (!g.libs) { for (const t of g.stones) n[Math.floor(t / N)][t % N] = 0; caps += g.stones.length; } }
  }
  if (!group(n, r, c).libs) return null; // suicide
  return { board: n, caps };
}
const key = (b) => b.map((r) => r.join('')).join('/');
function naiveArea(b) {
  let black = 0, white = 0;
  const seen = new Set();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (b[r][c] === 1) black++; else if (b[r][c] === 2) white++;
    else if (!seen.has(r * N + c)) {
      const reg = [[r, c]], touch = new Set();
      seen.add(r * N + c);
      for (let i = 0; i < reg.length; i++) for (const [a, bb] of nb(...reg[i])) {
        if (b[a][bb] === 0 && !seen.has(a * N + bb)) { seen.add(a * N + bb); reg.push([a, bb]); } else if (b[a][bb]) touch.add(b[a][bb]);
      }
      if (touch.size === 1) { if (touch.has(1)) black += reg.length; else white += reg.length; }
    }
  }
  return black - white - 7.5;
}
{
  let positions = 0, captures = 0, superko = 0;
  for (let g = 0; g < 60; g++) {
    const E = GoEngine();
    let b = Array.from({ length: N }, () => Array(N).fill(0)), col = 1;
    const hist = new Set([key(b)]);
    for (let k = 0; k < 160; k++) {
      positions++;
      const legal = [];
      for (let s = 0; s < N * N; s++) { const r = naivePlay(b, s, col); if (r) { if (hist.has(key(r.board))) superko++; else legal.push(s); } }
      const el = E.legalMoves().filter((m) => m >= 0);
      if (el.join() !== legal.join()) { check(false, `game ${g} move ${k}: legal ${el.length} vs naive ${legal.length}`); break; }
      if (!legal.length) break;
      const s = legal[rnd(legal.length)], r = naivePlay(b, s, col);
      const cap = E.play(s);
      captures += r.caps;
      check(cap === r.caps, `game ${g} move ${k}: captured ${cap} vs ${r.caps}`);
      b = r.board; col = 3 - col; hist.add(key(b));
      const cells = Array.from(E.cells()).join(''), nk = b.flat().join('');
      if (cells !== nk) { check(false, `game ${g} move ${k}: board differs`); break; }
    }
    check(Math.abs(E.area() - naiveArea(b)) < 1e-9, `game ${g}: area ${E.area()} vs ${naiveArea(b)}`);
  }
  check(captures > 200 && superko > 0, `random games should include captures (${captures}) and superko refusals (${superko})`);
  console.log(`random games: ${positions} positions match the naive implementation (${captures} stones captured, ${superko} superko refusals)`);
}

// ---------- 2. dead stones ----------
{
  // Black owns the left five columns, White the right four; a lone White stone in Black's area is surrounded on three
  // sides (one liberty left): dead
  const E = GoEngine();
  const at = (r, c) => r * N + c;
  const black = [], white = [];
  for (let r = 0; r < N; r++) { black.push(at(r, 4)); white.push(at(r, 5)); }
  black.push(at(1, 1), at(3, 1), at(2, 0));
  white.push(at(2, 1));
  for (let i = 0; i < Math.max(black.length, white.length); i++) { E.play(i < black.length ? black[i] : -1); E.play(i < white.length ? white[i] : -1); }
  const est = E.estimate(300);
  check(est.dead.length === 1 && est.dead[0] === at(2, 1), `the lone White stone is dead: ${est.dead}`);
  // Black: 45 points (cols 0-4), White 36 (cols 5-8) → 45 − 36 − 7.5 = 1.5
  check(Math.abs(est.margin - 1.5) < 1e-9, `margin with the dead stone removed: ${est.margin}`);
  console.log(`dead stones: found ${est.dead.length} (the intruder), margin ${est.margin}`);
}

// ---------- 3. search ----------
{
  // White's last move left two Black stones in the centre in atari: Black runs out at (4,3)
  const E = GoEngine();
  const at = (r, c) => r * N + c;
  for (const m of [at(4, 4), at(3, 4), at(4, 5), at(3, 5), at(8, 0), at(5, 4), at(8, 1), at(5, 5), at(8, 2), at(4, 6)]) E.play(m);
  const info = E.think({ playouts: 4000 });
  check(info.move === at(4, 3), `saves the stones in atari: ${info.move}`);
  let wins = 0;
  for (let g = 0; g < 4; g++) {
    const A = GoEngine(), Rr = GoEngine();
    const engBlack = g % 2 === 0;
    for (let k = 0; k < 250 && Rr.status() !== 'over'; k++) {
      const mine = (Rr.stm === 1) === engBlack;
      let m;
      if (mine) m = A.think({ playouts: 1500 }).move;
      else { const l = Rr.legalMoves().filter((x) => x >= 0); m = l.length && k < 200 ? l[rnd(l.length)] : -1; }
      A.play(m); Rr.play(m);
    }
    const est = Rr.estimate(100), blackWon = est.margin > 0;
    if (blackWon === engBlack) wins++;
  }
  check(wins === 4, `engine won ${wins} of 4 against random`);
  console.log(`search: saves stones in atari; ${wins}/4 against random`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

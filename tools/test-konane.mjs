// Tests for konane/engine.js (run in CI): node tools/test-konane.mjs
//  1. every position of random games against a naive implementation (the two opening removals, the jumps, the end);
//  2. small endings: the engine's exact result agrees with a plain exhaustive search;
//  3. search: beats a random player, as black and as white, and a known opening count.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { KonaneEngine } = require(path.join(root, 'konane', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 91;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

// ---------- naive implementation: an 8×8 array of rows, walk each direction square by square ----------
class Naive {
  constructor() {
    this.b = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? 1 : 2)));
    this.stm = 1; this.plies = 0; this.hole = null;
  }
  clone() { const n = new Naive(); n.b = this.b.map((r) => r.slice()); n.stm = this.stm; n.plies = this.plies; n.hole = this.hole; return n; }
  moves() { // [from square, to square] pairs, squares row*8+col
    const out = [];
    if (this.plies === 0) return [[0, 0], [7, 7], [3, 3], [4, 4]].map(([r, c]) => [r * 8 + c, r * 8 + c]);
    if (this.plies === 1) {
      const [hr, hc] = this.hole;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = hr + dr, c = hc + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8 && this.b[r][c] === 2) out.push([r * 8 + c, r * 8 + c]);
      }
      return out;
    }
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (this.b[r][c] !== this.stm) continue;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let rr = r, cc = c;
        for (;;) {
          const mr = rr + dr, mc = cc + dc, lr = rr + 2 * dr, lc = cc + 2 * dc;
          if (lr < 0 || lr > 7 || lc < 0 || lc > 7) break;
          if (this.b[mr][mc] !== 3 - this.stm || this.b[lr][lc] !== 0) break;
          out.push([r * 8 + c, lr * 8 + lc]);
          rr = lr; cc = lc;
        }
      }
    }
    return out;
  }
  play([f, t]) {
    const fr = f >> 3, fc = f & 7, tr = t >> 3, tc = t & 7;
    if (f === t) { this.b[fr][fc] = 0; this.hole = [fr, fc]; }
    else {
      const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
      this.b[fr][fc] = 0;
      const steps = (Math.abs(tr - fr) + Math.abs(tc - fc)) / 2;
      for (let k = 0; k < steps; k++) this.b[fr + dr * (2 * k + 1)][fc + dc * (2 * k + 1)] = 0;
      this.b[tr][tc] = this.stm;
    }
    this.stm = 3 - this.stm; this.plies++;
  }
  over() { return this.plies >= 2 && this.moves().length === 0; }
}
const enc = ([f, t]) => f | (t << 6);
const same = (E, N) => {
  const a = E.legalMoves().sort((x, y) => x - y), b = N.moves().map(enc).sort((x, y) => x - y);
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

// ---------- 1. random games against the naive implementation ----------
{
  const E = KonaneEngine({ ttBits: 10 });
  let positions = 0, jumpsOf3 = 0, ends = 0;
  for (let g = 0; g < 200; g++) {
    E.setStart(); const N = new Naive();
    for (;;) {
      positions++;
      check(same(E, N), `game ${g}, ply ${N.plies}: the move sets differ`);
      const boardOk = E.board.every((v, s) => v === N.b[s >> 3][s & 7]);
      check(boardOk, `game ${g}, ply ${N.plies}: the boards differ`);
      check((E.status() === 'over') === N.over(), `game ${g}, ply ${N.plies}: the end differs`);
      if (N.over()) { ends++; check(E.loser() === N.stm, `game ${g}: the loser differs`); break; }
      const ms = N.moves(), m = ms[rnd(ms.length)];
      if (Math.abs(m[0] - m[1]) > 15) jumpsOf3++; // a double or longer jump
      E.play(enc(m)); N.play(m);
    }
  }
  console.log(`${positions} positions of 200 random games agree with the naive implementation (${ends} ends, ${jumpsOf3} multi-jumps)`);
  check(jumpsOf3 > 50, 'too few multi-jumps were tried');
  // undo returns the same board and hash
  for (let g = 0; g < 20; g++) {
    E.setStart(); const before = [Array.from(E.board), E.hash.slice()]; const played = [];
    while (E.status() !== 'over' && played.length < 40) { const l = E.legalMoves(); const m = l[rnd(l.length)]; played.push(m); E.play(m); }
    while (played.length) E.undo(played.pop());
    check(E.board.every((v, s) => v === before[0][s]) && E.hash[0] === before[1][0] && E.hash[1] === before[1][1], `undo game ${g}: board or hash differs`);
  }
  console.log('undo restores the board and the hash');
  // known counts: 4 opening removals, then 2 or 4 white replies
  E.setStart(); check(E.perft(1) === 4, `perft(1) = ${E.perft(1)}`);
  E.setStart(); check(E.perft(2) === 2 + 2 + 4 + 4, `perft(2) = ${E.perft(2)}`);
}

// ---------- 2. small endings: the engine's exact answer against an exhaustive search ----------
{
  const solve = (N) => { // +1 if the side to move wins, −1 if it loses
    const ms = N.moves();
    if (ms.length === 0) return -1;
    for (const m of ms) { const c = N.clone(); c.play(m); if (solve(c) === -1) return 1; }
    return -1;
  };
  let tested = 0, decided = 0;
  const E = KonaneEngine({ ttBits: 16 });
  for (let tries = 0; tries < 400 && tested < 40; tries++) {
    // play random moves until few pieces remain, then solve
    const N = new Naive(); E.setStart();
    while (!N.over()) {
      const left = N.b.flat().filter(Boolean).length;
      if (left <= 10 && N.plies >= 2) break;
      const ms = N.moves(), m = ms[rnd(ms.length)];
      N.play(m); E.play(enc(m));
    }
    if (N.over()) continue;
    tested++;
    const want = solve(N), got = E.think({ depth: 40, time: 4000, clearTT: true });
    if (Math.abs(got.score) >= E.WIN_BOUND) decided++;
    check(Math.abs(got.score) >= E.WIN_BOUND, `ending ${tested}: not decided (score ${got.score})`);
    check((got.score > 0 ? 1 : -1) === want, `ending ${tested}: engine says ${got.score > 0 ? 'win' : 'loss'}, exhaustive search says ${want > 0 ? 'win' : 'loss'}`);
  }
  console.log(`${tested} endings (≤ 10 pieces): the engine's result matches the exhaustive search (${decided} decided)`);
}

// ---------- 3. search ----------
{
  let wins = 0;
  for (let g = 0; g < 8; g++) {
    const A = KonaneEngine({ ttBits: 16 }), R = KonaneEngine({ ttBits: 8 });
    const engBlack = g % 2 === 0;
    while (R.status() !== 'over') {
      const mine = (R.stm === 1) === engBlack;
      let m;
      if (mine) m = A.think({ nodes: 20000 }).move;
      else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
      A.play(m); R.play(m);
    }
    if ((R.loser() === 1) !== engBlack) wins++;
  }
  check(wins === 8, `engine won ${wins} of 8 against a random player`);
  console.log(`search: ${wins}/8 against random`);
  const S = KonaneEngine({ ttBits: 20 });
  S.play(S.legalMoves()[2]); S.play(S.legalMoves()[0]);
  const t = S.think({ time: 1000 });
  console.log(`after the opening, 1 s: depth ${t.depth}, ${t.nodes} nodes, ${S.moveStr(t.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

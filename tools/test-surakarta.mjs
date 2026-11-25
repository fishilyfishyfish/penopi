// Tests for surakarta/engine.js (run in CI): node tools/test-surakarta.mjs
//  1. every position of random games against a naive implementation that walks the loops geometrically
//     (steps, captures along the two circuits, the end, the 40-ply rule);
//  2. hand positions: a capture that goes round a corner, one through its own start, blocked by a friend, the draw rule;
//  3. search: finds a winning capture, beats a random player as black and as white.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SurakartaEngine } = require(path.join(root, 'surakarta', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 63;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

// ---------- naive implementation: walk the loops square by square, turning at the corner arcs by geometry ----------
// leaving the board at an edge, the arc leads onto the line that curls round that corner
function arcFrom(r, c, dr, dc) { // returns [r, c, dr, dc] entering the board again
  if (dc === 1) return r <= 2 ? [0, 5 - r, 1, 0] : [5, r, -1, 0];       // off the right edge
  if (dc === -1) return r <= 2 ? [0, r, 1, 0] : [5, 5 - r, -1, 0];      // off the left edge
  if (dr === 1) return c <= 2 ? [5 - c, 0, 0, 1] : [c, 5, 0, -1];       // off the bottom
  return c <= 2 ? [c, 0, 0, 1] : [5 - c, 5, 0, -1];                     // off the top
}
class Naive {
  constructor() {
    this.b = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, () => (r < 2 ? 1 : r > 3 ? 2 : 0)));
    this.stm = 1; this.quiet = 0;
  }
  clone() { const n = new Naive(); n.b = this.b.map((r) => r.slice()); n.stm = this.stm; n.quiet = this.quiet; return n; }
  count(p) { return this.b.flat().filter((v) => v === p).length; }
  captures(r0, c0) {
    const out = new Set();
    for (const [dr0, dc0] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // only the 2nd..5th lines are on a loop
      if ((dr0 === 0 && (r0 < 1 || r0 > 4)) || (dc0 === 0 && (c0 < 1 || c0 > 4))) continue;
      let r = r0, c = c0, dr = dr0, dc = dc0;
      for (let step = 0; step < 24; step++) {
        r += dr; c += dc;
        if (r < 0 || r > 5 || c < 0 || c > 5) { [r, c, dr, dc] = arcFrom(r - dr, c - dc, dr, dc); }
        if (r === r0 && c === c0) continue;
        const v = this.b[r][c];
        if (!v) continue;
        if (v !== this.stm) out.add(r * 6 + c);
        break;
      }
    }
    return [...out];
  }
  moves() {
    const out = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      if (this.b[r][c] !== this.stm) continue;
      for (const q of this.captures(r, c)) out.push([r * 6 + c, q, 1]);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < 6 && cc >= 0 && cc < 6 && !this.b[rr][cc]) out.push([r * 6 + c, rr * 6 + cc, 0]);
      }
    }
    return out;
  }
  play([f, t, cap]) {
    this.b[Math.floor(t / 6)][t % 6] = this.stm;
    this.b[Math.floor(f / 6)][f % 6] = 0;
    this.quiet = cap ? 0 : this.quiet + 1;
    this.stm = 3 - this.stm;
  }
  result() {
    if (this.count(2) === 0) return 1;
    if (this.count(1) === 0) return 2;
    if (this.moves().length === 0) return 3 - this.stm;
    if (this.quiet >= 40) { const a = this.count(1), b = this.count(2); return a > b ? 1 : b > a ? 2 : 3; }
    return 0;
  }
}
const enc = ([f, t, cap]) => f | (t << 6) | (cap ? 4096 : 0);

// ---------- 1. random games against the naive implementation ----------
{
  const E = SurakartaEngine({ ttBits: 10 });
  let positions = 0, caps = 0, ends = 0, draws = 0;
  for (let g = 0; g < 160; g++) {
    E.setStart(); const N = new Naive();
    for (let ply = 0; ply < 400; ply++) {
      positions++;
      const a = E.legalMoves().sort((x, y) => x - y), b = N.moves().map(enc).sort((x, y) => x - y);
      check(a.length === b.length && a.every((v, i) => v === b[i]), `game ${g}, ply ${ply}: the move sets differ (${a.length} vs ${b.length})`);
      check(E.board.every((v, s) => v === N.b[Math.floor(s / 6)][s % 6]), `game ${g}, ply ${ply}: the boards differ`);
      const rn = N.result();
      check(E.result() === rn, `game ${g}, ply ${ply}: the result differs (${E.result()} vs ${rn})`);
      if (rn) { ends++; if (rn === 3) draws++; break; }
      // prefer captures a bit so the games change character
      const ms = N.moves(), cm = ms.filter((m) => m[2]);
      const m = cm.length && rnd(3) ? cm[rnd(cm.length)] : ms[rnd(ms.length)];
      if (m[2]) caps++;
      E.play(enc(m)); N.play(m);
    }
  }
  console.log(`${positions} positions of 160 random games agree with the naive implementation (${caps} captures, ${ends} ends, ${draws} draws)`);
  check(caps > 300, 'too few captures were tried');
  for (let g = 0; g < 20; g++) {
    E.setStart(); const before = [Array.from(E.board), E.hash.slice(), E.quiet]; const played = [];
    while (E.result() === 0 && played.length < 60) { const l = E.legalMoves(); const m = l[rnd(l.length)]; played.push(m); E.play(m); }
    while (played.length) E.undo(played.pop());
    check(E.board.every((v, s) => v === before[0][s]) && E.hash[0] === before[1][0] && E.hash[1] === before[1][1] && E.quiet === before[2], `undo game ${g}`);
  }
  console.log('undo restores the board, the hash and the quiet count');
}

// ---------- 2. hand positions ----------
{
  const E = SurakartaEngine({ ttBits: 10 });
  const put = (cells, side, quiet) => { const b = new Int8Array(36); for (const [r, c, v] of cells) b[r * 6 + c] = v; E.setPosition(b, side, quiet || 0); };
  const caps = () => E.legalMoves().filter((m) => m & 4096).map((m) => [m & 63, (m >> 6) & 63]);
  // a black piece on row 1 sees a white piece at the other end of row 1
  put([[1, 0, 1], [1, 5, 2]], 1);
  check(caps().some(([f, t]) => f === 6 && t === 11), 'a straight capture along row 1 is missing');
  // blocked by a friend in between (and one on the way round the other direction: column 1's top)
  put([[1, 0, 1], [1, 2, 1], [0, 1, 1], [1, 5, 2]], 1);
  check(!caps().some(([f, t]) => f === 6 && t === 11), 'a friend should block the capture');
  // round the top-right corner: row 1 to the right, then down column 4 (small loop)
  put([[1, 0, 1], [4, 4, 2]], 1);
  check(caps().some(([f, t]) => f === 6 && t === 28), 'a capture round a corner (row 1 → column 4) is missing');
  // through its own start: the piece goes all the way round the small loop and captures a piece behind it
  put([[1, 1, 1], [1, 3, 2], [3, 1, 2]], 1);
  const c1 = caps();
  check(c1.some(([f, t]) => f === 7 && t === 9), 'capture along row 1 is missing');
  check(c1.some(([f, t]) => f === 7 && t === 19), 'capture down column 1 is missing');
  // the line along the edge is on no loop
  put([[0, 0, 1], [0, 5, 2]], 1);
  check(caps().length === 0, 'the edge row is not on a loop');
  // a side without pieces has lost; 40 quiet plies end the game by piece count
  put([[2, 2, 1]], 2);
  check(E.result() === 1 && E.status() === 'over', 'no white pieces: black has won');
  put([[0, 0, 1], [0, 1, 1], [5, 5, 2]], 1, 40);
  check(E.result() === 1, '40 quiet plies: more pieces win');
  put([[0, 0, 1], [5, 5, 2]], 1, 40);
  check(E.result() === 3, '40 quiet plies with equal pieces: a draw');
  console.log('hand positions agree with the rules');
}

// ---------- 3. search ----------
{
  const E = SurakartaEngine({ ttBits: 12 });
  const b = new Int8Array(36); b[7] = 1; b[9] = 2; E.setPosition(b, 1, 0);
  const t = E.think({ time: 500 });
  check(t.move === (7 | (9 << 6) | 4096) && t.score >= E.WIN_BOUND, `the engine should take the last piece and win (move ${t.move}, score ${t.score})`);
  let wins = 0;
  for (let g = 0; g < 8; g++) {
    const A = SurakartaEngine({ ttBits: 16 }), R = SurakartaEngine({ ttBits: 8 });
    const engBlack = g % 2 === 0;
    for (let ply = 0; ply < 300 && R.result() === 0; ply++) {
      const mine = (R.stm === 1) === engBlack;
      let m;
      if (mine) m = A.think({ nodes: 20000 }).move;
      else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
      A.play(m); R.play(m);
    }
    const res = R.result(), me = engBlack ? 1 : 2;
    if (res === me) wins++;
  }
  check(wins === 8, `engine won ${wins} of 8 against a random player`);
  console.log(`search: ${wins}/8 against random`);
  const S = SurakartaEngine({ ttBits: 20 });
  const r = S.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${r.depth}, ${r.nodes} nodes, ${S.moveStr(r.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

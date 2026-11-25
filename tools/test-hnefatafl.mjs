// Tests for hnefatafl/engine.js (run in CI): node tools/test-hnefatafl.mjs
//  1. every position of random games (7×7 and 11×11) against a naive implementation (moves, captures, the king's capture,
//     the corner win, no moves, repetition);
//  2. hand positions: custodial capture, the throne and corners as hostile squares, passing the throne, the king taken
//     by four, a king run to a corner;
//  3. search: sees a king escape and takes the king; beats a random player as attackers and as defenders.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { HnefataflEngine } = require(path.join(root, 'hnefatafl', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 29;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

// ---------- naive implementation (a different shape of code: rows of arrays, small helper functions) ----------
class Naive {
  constructor(n) {
    this.n = n; this.stm = 1; this.plies = 0; this.keys = [];
    const L = n === 7
      ? { att: [[0, 3], [1, 3], [5, 3], [6, 3], [3, 0], [3, 1], [3, 5], [3, 6]], def: [[2, 3], [4, 3], [3, 2], [3, 4]] }
      : { att: [[0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 5], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [9, 5], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [5, 1], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [5, 9]],
        def: [[3, 5], [4, 4], [4, 5], [4, 6], [5, 3], [5, 4], [5, 6], [5, 7], [6, 4], [6, 5], [6, 6], [7, 5]] };
    this.b = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const [r, c] of L.att) this.b[r][c] = 1;
    for (const [r, c] of L.def) this.b[r][c] = 2;
    const m = (n - 1) / 2; this.b[m][m] = 3;
    this.keys.push(this.key());
  }
  key() { return this.stm + ':' + this.b.map((r) => r.join('')).join('/'); }
  clone() { const c = Object.create(Naive.prototype); Object.assign(c, this); c.b = this.b.map((r) => r.slice()); c.keys = this.keys.slice(); return c; }
  mid() { return (this.n - 1) / 2; }
  corner(r, c) { const e = this.n - 1; return (r === 0 || r === e) && (c === 0 || c === e); }
  throne(r, c) { return r === this.mid() && c === this.mid(); }
  side(p) { return p === 1 ? 1 : p === 2 || p === 3 ? 2 : 0; }
  moves() {
    const out = [];
    for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) {
      const p = this.b[r][c];
      if (this.side(p) !== this.stm) continue;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < this.n && cc >= 0 && cc < this.n && this.b[rr][cc] === 0) {
          const special = this.corner(rr, cc) || this.throne(rr, cc);
          if (!special || p === 3) out.push([r * this.n + c, rr * this.n + cc]);
          else if (this.corner(rr, cc)) break;
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }
  // is the square (r, c) hostile to a piece of side `who` that is being closed in against it?
  hostile(r, c, who) {
    if (this.corner(r, c)) return true;
    if (this.throne(r, c)) return who === 1 || this.b[r][c] === 0;
    return false;
  }
  play([f, t]) {
    const n = this.n, fr = Math.floor(f / n), fc = f % n, tr = Math.floor(t / n), tc = t % n, p = this.b[fr][fc], me = this.stm;
    this.b[fr][fc] = 0; this.b[tr][tc] = p;
    const gone = [];
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = tr + dr, c = tc + dc;
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      const e = this.b[r][c];
      if (!e || this.side(e) === me) continue;
      const r2 = r + dr, c2 = c + dc;
      if (e === 3) {
        if (this.kingTaken(r, c, r2, c2)) gone.push([r, c]);
        continue;
      }
      if (r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) continue;
      const q = this.b[r2][c2];
      if ((q && this.side(q) === me) || this.hostile(r2, c2, e === 1 ? 1 : 2) && (this.corner(r2, c2) || e === 1 || q === 0)) gone.push([r, c]);
    }
    for (const [r, c] of gone) this.b[r][c] = 0;
    this.stm = 3 - me; this.plies++;
    this.keys.push(this.key());
  }
  kingTaken(r, c, r2, c2) {
    const n = this.n;
    if (n === 11 || this.throne(r, c)) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) return false;
        const v = this.b[rr][cc];
        if (v === 1) continue;
        if (this.throne(rr, cc) && v === 0) continue;
        return false;
      }
      return true;
    }
    if (r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) return false;
    const q = this.b[r2][c2];
    return q === 1 || this.corner(r2, c2) || (this.throne(r2, c2) && q === 0);
  }
  kingAt() { for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) if (this.b[r][c] === 3) return [r, c]; return null; }
  result() {
    const k = this.kingAt();
    if (!k) return 1;
    if (this.corner(k[0], k[1])) return 2;
    if (this.moves().length === 0) return 3 - this.stm;
    const last = this.keys[this.keys.length - 1];
    let seen = 0;
    for (let i = this.keys.length - 1, j = 0; i >= 0 && j < 60; i -= 2, j++) if (this.keys[i] === last) seen++;
    if (seen >= 3 || this.plies >= 300) return 3;
    return 0;
  }
}
const enc = (n) => ([f, t]) => f | (t << 7);

// ---------- 1. random games against the naive implementation ----------
for (const size of [7, 11]) {
  const E = HnefataflEngine({ ttBits: 10, size });
  let positions = 0, caps = 0, ends = [0, 0, 0, 0];
  const games = size === 7 ? 120 : 40;
  for (let g = 0; g < games; g++) {
    E.setStart(size); const N = new Naive(size);
    for (let ply = 0; ply < 320; ply++) {
      positions++;
      const a = E.legalMoves().sort((x, y) => x - y), b = N.moves().map(enc(size)).sort((x, y) => x - y);
      check(a.length === b.length && a.every((v, i) => v === b[i]), `${size}: game ${g}, ply ${ply}: the move sets differ (${a.length} vs ${b.length})`);
      check(Array.from(E.board).slice(0, size * size).every((v, s) => v === N.b[Math.floor(s / size)][s % size]), `${size}: game ${g}, ply ${ply}: the boards differ`);
      const rn = N.result();
      check(E.result() === rn, `${size}: game ${g}, ply ${ply}: the result differs (${E.result()} vs ${rn})`);
      if (rn) { ends[rn]++; break; }
      const ms = N.moves();
      // steer the games: the king runs more often, so corner wins and captures of the king turn up
      const kingMoves = ms.filter(([f]) => N.b[Math.floor(f / size)][f % size] === 3);
      const m = kingMoves.length && rnd(4) === 0 ? kingMoves[rnd(kingMoves.length)] : ms[rnd(ms.length)];
      const before = N.b.flat().filter(Boolean).length;
      E.play(enc(size)(m)); N.play(m);
      if (N.b.flat().filter(Boolean).length < before) caps++;
    }
  }
  console.log(`${size}×${size}: ${positions} positions of ${games} random games agree with the naive implementation (${caps} captures; attackers won ${ends[1]}, defenders ${ends[2]}, drawn ${ends[3]})`);
  check(caps > 100, `${size}: too few captures were tried`);
  for (let g = 0; g < 15; g++) {
    E.setStart(size); const before = [Array.from(E.board), E.hash.slice(), E.kingSq]; const played = [];
    while (E.result() === 0 && played.length < 80) { const l = E.legalMoves(); const m = l[rnd(l.length)]; played.push(m); E.play(m); }
    while (played.length) E.undo(played.pop());
    check(E.board.every((v, s) => v === before[0][s]) && E.hash[0] === before[1][0] && E.hash[1] === before[1][1] && E.kingSq === before[2], `${size}: undo game ${g}`);
  }
}
console.log('undo restores the board, the hash and the king');

// ---------- 2. hand positions ----------
{
  const E = HnefataflEngine({ ttBits: 10, size: 11 });
  const put = (cells, side, size) => { E.setSize(size || 11); const b = new Int8Array(121); for (const [r, c, v] of cells) b[r * E.size + c] = v; E.setPosition(b, side, 0); };
  const sq = (r, c) => r * E.size + c;
  const mv = (r1, c1, r2, c2) => sq(r1, c1) | (sq(r2, c2) << 7);
  // an attacker closes in on a defender between two attackers
  put([[3, 3, 2], [3, 2, 1], [3, 7, 1], [8, 8, 3]], 1);
  E.play(mv(3, 7, 3, 4));
  check(E.board[sq(3, 3)] === 0, 'a defender between two attackers should be taken');
  // walking in between two enemies is safe
  put([[3, 3, 1], [3, 5, 1], [8, 8, 3], [6, 4, 2]], 2);
  E.play(mv(6, 4, 3, 4));
  check(E.board[sq(3, 4)] === 2, 'a piece that walks between two enemies is safe');
  // a corner is hostile: an attacker against the corner is taken by one defender
  put([[0, 1, 1], [5, 5, 3], [2, 5, 2]], 2);
  E.play(mv(2, 5, 0, 5)); // not next to the corner: nothing taken
  check(E.board[sq(0, 1)] === 1, 'no capture without the corner');
  put([[0, 1, 1], [0, 3, 2], [5, 5, 3]], 2);
  E.play(mv(0, 3, 0, 2)); // the attacker on b-file next to the corner (0,0): taken against the corner? (0,2) is the far side of (0,1) from (0,0)
  check(E.board[sq(0, 1)] === 0, 'an attacker next to a corner is taken against it');
  // the empty throne is hostile to the attackers, even a defender's piece beside it
  put([[5, 4, 1], [5, 7, 2], [0, 0, 0], [9, 9, 3]], 2);
  E.play(mv(5, 7, 5, 6));
  check(E.board[sq(5, 4)] === 1, 'a piece two away from the throne is not closed in');
  put([[5, 4, 1], [5, 3, 2], [9, 9, 3]], 2); // throne (5,5) empty: attacker at (5,4) between defender (5,3) and the throne
  E.play(mv(5, 3, 4, 3)); E.undo(mv(5, 3, 4, 3));
  put([[5, 4, 1], [4, 3, 2], [9, 9, 3]], 2);
  E.play(mv(4, 3, 5, 3));
  check(E.board[sq(5, 4)] === 0, 'an attacker between a defender and the throne is taken');
  // passing the empty throne is allowed for ordinary pieces, stopping on it is not
  put([[5, 2, 1], [9, 9, 3]], 1);
  const ms = E.legalMoves();
  check(ms.includes(mv(5, 2, 5, 6)) && !ms.includes(mv(5, 2, 5, 5)), 'pass the throne, never stop on it');
  // the king taken by four attackers, three and the throne, and not by two (11×11)
  put([[4, 3, 1], [6, 3, 1], [5, 2, 1], [2, 4, 1], [5, 3, 3]], 1);
  E.play(mv(2, 4, 5, 4));
  check(E.kingSq === -1 && E.result() === 1, 'the king should be taken by four attackers');
  put([[4, 3, 1], [6, 3, 1], [2, 4, 1], [5, 3, 3]], 1);
  E.play(mv(2, 4, 5, 4));
  check(E.kingSq === sq(5, 3), 'three attackers are not enough away from the throne');
  // 7×7: two attackers take the king away from the throne
  put([[2, 2, 1], [5, 4, 1], [2, 3, 3]], 1, 7);
  E.play(mv(5, 4, 2, 4));
  check(E.kingSq === -1, '7×7: two attackers take the king away from the throne');
  put([[3, 2, 1], [6, 4, 1], [3, 3, 3]], 1, 7);
  E.play(mv(6, 4, 3, 4));
  check(E.kingSq === sq(3, 3), '7×7: the king on the throne needs four attackers');
  // a king run to a corner wins
  put([[0, 5, 0], [3, 10, 3], [5, 5, 2]], 2);
  check(E.kingEscapes() === 2, 'the king on the right edge sees both corners (0,10) and (10,10)');
  E.play(mv(3, 10, 0, 10));
  check(E.result() === 2, 'the king on a corner: the defenders won');
  console.log('hand positions agree with the rules');
}

// ---------- 3. search ----------
{
  const E = HnefataflEngine({ ttBits: 14, size: 11 });
  const b = new Int8Array(121); b[3 * 11 + 10] = 3; b[5 * 11 + 5] = 2; b[9 * 11 + 1] = 1;
  E.setPosition(b, 2, 0);
  const t = E.think({ time: 500 });
  check(t.score >= E.WIN_BOUND && (t.move >> 7 & 127) === 0 + 10, `the king should run for the corner (move ${E.moveStr(t.move)}, score ${t.score})`);
  // two corner runs at once cannot be stopped
  const c = new Int8Array(121); c[0 * 11 + 5] = 3; c[5 * 11 + 5] = 0; c[10 * 11 + 3] = 1; c[3 * 11 + 3] = 1;
  E.setPosition(c, 1, 0);
  const t2 = E.think({ time: 800 });
  check(t2.score <= -E.WIN_BOUND, `attackers cannot stop a king on an open edge (score ${t2.score})`);
  for (const size of [7, 11]) for (const engSide of [1, 2]) {
    let wins = 0, played = 0;
    const games = size === 7 ? 4 : 2;
    for (let g = 0; g < games; g++) {
      const A = HnefataflEngine({ ttBits: 16, size }), R = HnefataflEngine({ ttBits: 8, size });
      A.setStart(size); R.setStart(size);
      while (R.result() === 0) {
        let m;
        if (R.stm === engSide) m = A.think({ nodes: size === 7 ? 30000 : 15000 }).move;
        else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
        A.play(m); R.play(m);
      }
      played++;
      if (R.result() === engSide) wins++;
    }
    check(wins === played, `${size}×${size}: engine as ${engSide === 1 ? 'attackers' : 'defenders'} won ${wins} of ${played} against random`);
    console.log(`search ${size}×${size}: ${wins}/${played} as ${engSide === 1 ? 'attackers' : 'defenders'} against random`);
  }
  const S = HnefataflEngine({ ttBits: 20, size: 11 });
  const r = S.think({ time: 1000 });
  console.log(`11×11 start position, 1 s: depth ${r.depth}, ${r.nodes} nodes, ${S.moveStr(r.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

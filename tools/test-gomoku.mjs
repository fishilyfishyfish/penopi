// Tests for gomoku/engine.js (run in CI): node tools/test-gomoku.mjs
//  1. win detection under each rule against a naive line counter, over random games;
//  2. hand-made positions: overline, double three, double four, a "three" that can't become a straight four,
//     and that a five beats a forbidden shape;
//  3. search: takes a five, blocks a four, finds a win by continuous fours (VCF), beats a random player.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GomokuEngine } = require(path.join(root, 'gomoku', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 31;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const N = 15, sq = (r, c) => r * N + c;

// ---------- 1. win detection vs a naive counter ----------
function naiveWin(board, s, color, rule) {
  const r0 = Math.floor(s / N), c0 = s % N;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (let k = 1; ; k++) { const r = r0 + k * dr, c = c0 + k * dc; if (r < 0 || r >= N || c < 0 || c >= N || board[r * N + c] !== color) break; n++; }
    for (let k = 1; ; k++) { const r = r0 - k * dr, c = c0 - k * dc; if (r < 0 || r >= N || c < 0 || c >= N || board[r * N + c] !== color) break; n++; }
    if (rule === 'renju' && color === 1 ? n === 5 : n >= 5) return true;
  }
  return false;
}
{
  let positions = 0;
  for (const rule of ['free', 'ban33', 'renju']) {
    const E = GomokuEngine({ rule, ttBits: 10 });
    for (let g = 0; g < 20; g++) {
      E.setStart();
      for (let k = 0; k < 225; k++) {
        const legal = E.legalMoves();
        if (!legal.length) break;
        // play near the last stones so fives actually happen
        const close = E.count ? legal.filter((s) => { const l = E.last; return Math.abs(Math.floor(s / N) - Math.floor(l / N)) <= 2 && Math.abs((s % N) - (l % N)) <= 2; }) : legal;
        const pool = close.length ? close : legal;
        const s = pool[rnd(pool.length)], color = E.stm;
        E.play(s);
        positions++;
        const want = naiveWin(E.board, s, color, rule) ? 'win' : E.count === 225 ? 'draw' : '';
        if (E.status() !== want) { check(false, `${rule} game ${g} move ${k}: status ${E.status()}, naive ${want}`); break; }
        if (want) break;
      }
    }
  }
  console.log(`win detection: ${positions} positions match a naive counter`);
}

// ---------- 2. rules by hand ----------
{
  const E = GomokuEngine({ ttBits: 10 });
  const test = (rule, blacks, whites, move, want, what) => {
    E.setRule(rule); E.setPosition(blacks, whites, 1);
    const got = E.forbidden(move);
    check(got === want, `${rule}: ${what} — forbidden ${got}, want ${want}`);
  };
  // double three: open twos crossing at H8
  const b33 = [sq(7, 5), sq(7, 6), sq(5, 7), sq(6, 7)];
  test('free', b33, [], sq(7, 7), false, 'double three');
  test('ban33', b33, [], sq(7, 7), true, 'double three');
  test('renju', b33, [], sq(7, 7), true, 'double three');
  // a three blocked at one end is not open: no double three
  test('ban33', b33, [sq(7, 4)], sq(7, 7), false, 'one of the threes is blocked');
  // double four: two lines of three crossing
  const b44 = [sq(7, 4), sq(7, 5), sq(7, 6), sq(4, 7), sq(5, 7), sq(6, 7)];
  test('ban33', b44, [sq(7, 3), sq(3, 7)], sq(7, 7), false, 'double four (not banned under ban33)');
  test('renju', b44, [sq(7, 3), sq(3, 7)], sq(7, 7), true, 'double four');
  // double four on one line: X X X _ X _ X X X style (B . B B _ B B . B) → 4-4 in a single line
  test('renju', [sq(7, 2), sq(7, 4), sq(7, 5), sq(7, 7), sq(7, 8), sq(7, 10)], [], sq(7, 6), false, 'line making a five? (control)');
  test('renju', [sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 9), sq(7, 10), sq(7, 11)], [], sq(7, 7), true, 'two fours on one line');
  // overline
  const b6 = [sq(7, 1), sq(7, 2), sq(7, 3), sq(7, 5), sq(7, 6)];
  test('renju', b6, [], sq(7, 4), true, 'overline');
  test('free', b6, [], sq(7, 4), false, 'overline (free: a win)');
  E.setRule('free'); E.setPosition(b6, [], 1); E.play(sq(7, 4)); check(E.status() === 'win', 'free: overline wins');
  E.setRule('renju'); E.setPosition(b6, [sq(0, 0)], 2); E.play(sq(14, 14)); // white elsewhere
  // a five beats a double three: the move makes five and also two threes
  test('renju', [sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6), sq(5, 7), sq(6, 7), sq(8, 8), sq(9, 9)], [], sq(7, 7), false, 'five with a double three');
  console.log('rules by hand: double three, blocked three, double four (two lines and one line), overline, five first');
}

// ---------- 3. search ----------
{
  const E = GomokuEngine({ ttBits: 18 });
  E.setRule('free');
  E.setPosition([sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6)], [sq(0, 0), sq(0, 2), sq(0, 4)], 1);
  let info = E.think({ depth: 4 });
  check(info.move === sq(7, 2) || info.move === sq(7, 7), `takes the five: ${E.sqName(info.move)}`);
  E.setPosition([sq(0, 0), sq(14, 14), sq(0, 14)], [sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6)], 1); // black must block one end (or lose)
  E.setPosition([sq(0, 0), sq(14, 14), sq(0, 14)], [sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6), sq(7, 7)].slice(0, 4).concat([sq(7, 2)]), 1);
  // white XXXX with one end blocked by white? build: white 3..6, white 2 blocked? keep it simple: white four open on 7, blocked on 2 by black
  E.setPosition([sq(7, 2), sq(0, 0), sq(14, 14)], [sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6)], 1);
  info = E.think({ depth: 4 });
  check(info.move === sq(7, 7), `blocks the four: ${E.sqName(info.move)}`);
  // VCF: black makes a four that forces a block, then a double four
  E.setPosition([sq(7, 4), sq(7, 5), sq(7, 6), sq(5, 8), sq(6, 8), sq(8, 8)], [sq(7, 3), sq(4, 8), sq(0, 0), sq(0, 14), sq(14, 0), sq(14, 14)], 1);
  check(E.vcf(8), 'finds the win by continuous fours');
  info = E.think({ time: 1500 });
  check(info.score >= E.WIN_BOUND, `search sees the forced win (score ${info.score}, ${E.sqName(info.move)})`);
  // strength: beats a random player (placing near the stones) under every rule
  let wins = 0, games = 0;
  for (const rule of ['free', 'ban33', 'renju']) for (let g = 0; g < 2; g++) {
    const A = GomokuEngine({ rule, ttBits: 16 }), R = GomokuEngine({ rule, ttBits: 8 });
    const engBlack = g === 0;
    let result = '';
    for (let k = 0; k < 225 && !result; k++) {
      const mine = (R.stm === 1) === engBlack;
      let m;
      if (mine) m = A.think({ nodes: 3000 }).move;
      else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
      A.play(m); R.play(m);
      const st = R.status();
      if (st === 'win') result = mine ? 'engine' : 'random';
      else if (st) result = 'draw';
    }
    games++; if (result === 'engine') wins++;
  }
  check(wins === games, `engine won ${wins} of ${games} against random`);
  console.log(`search: five, block, VCF; ${wins}/${games} against random`);
  const S = GomokuEngine({ rule: 'free', ttBits: 20 });
  S.setPosition([sq(7, 7), sq(8, 8)], [sq(7, 8)], 2);
  const t = S.think({ time: 1000 });
  console.log(`a 3-stone position, 1 s: depth ${t.depth}, ${t.nodes} nodes, ${S.sqName(t.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

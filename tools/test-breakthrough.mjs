// Tests for breakthrough/engine.js (run in CI): node tools/test-breakthrough.mjs
//  1. move generation against a separate, naive implementation (2D array, step by step): the starting
//     position's perft, and the move set of every position of 30 random games;
//  2. the search's forcing shortcuts (runner = win, must capture a runner) against a plain minimax solver:
//     in random endgames, every forced win/loss the solver finds within 5 plies the engine finds too;
//  3. strength: the engine beats a random player and a one-move greedy player every game.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { BreakthroughEngine } = require(path.join(root, 'breakthrough', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 2026;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- the naive implementation ----------
const naive = {
  moves(b, side) { // b: 8x8 [row][col]
    const out = [], dr = side === 1 ? 1 : -1;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (b[r][c] !== side) continue;
      const nr = r + dr;
      if (nr < 0 || nr > 7) continue;
      for (const dc of [-1, 0, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc > 7) continue;
        const t = b[nr][nc];
        if (dc === 0 ? t === 0 : t !== side) out.push(`${r * 8 + c}-${nr * 8 + nc}${t ? 'x' : ''}`);
      }
    }
    return out.sort();
  },
  grid(arr) { const b = []; for (let r = 0; r < 8; r++) b.push(Array.from(arr.slice(r * 8, r * 8 + 8))); return b; },
  play(b, side, mv) { const [f, t] = mv.replace('x', '').split('-').map(Number); b[t >> 3][t & 7] = side; b[f >> 3][f & 7] = 0; },
  over(b, mover, mv) { // mover won?
    const t = Number(mv.replace('x', '').split('-')[1]);
    if ((t >> 3) === (mover === 1 ? 7 : 0)) return true;
    let opp = 0; for (const row of b) for (const v of row) if (v === 3 - mover) opp++;
    return opp === 0 || naive.moves(b, 3 - mover).length === 0;
  },
  perft(b, side, d) {
    const ms = naive.moves(b, side);
    if (d === 1) return ms.length;
    let n = 0;
    for (const m of ms) {
      const c = b.map((r) => r.slice());
      naive.play(c, side, m);
      const t = Number(m.replace('x', '').split('-')[1]);
      let opp = 0; for (const row of c) for (const v of row) if (v === 3 - side) opp++;
      if ((t >> 3) === (side === 1 ? 7 : 0) || opp === 0) continue;
      n += naive.perft(c, 3 - side, d - 1);
    }
    return n;
  },
  // +1 side to move wins within d plies, −1 loses within d, 0 unknown
  solve(b, side, d) {
    if (d <= 0) return 0;
    const ms = naive.moves(b, side);
    if (!ms.length) return -1;
    let best = -1;
    for (const m of ms) {
      const c = b.map((r) => r.slice());
      naive.play(c, side, m);
      if (naive.over(c, side, m)) return 1;
      const v = -naive.solve(c, 3 - side, d - 1);
      if (v === 1) return 1;
      if (v > best) best = v;
    }
    return best;
  },
};
const engineMoves = (E) => E.legalMoves().map((m) => `${m & 63}-${(m >> 6) & 63}${m & 4096 ? 'x' : ''}`).sort();

// ---------- 1. move generation ----------
{
  const E = BreakthroughEngine({ ttBits: 12 });
  const start = naive.grid(E.startArray());
  for (let d = 1; d <= 3; d++) {
    E.setStart();
    const a = E.perft(d), b = naive.perft(start, 1, d);
    check(a === b, `perft(${d}) engine ${a} naive ${b}`);
    console.log(`perft(${d}) = ${a}`);
  }
  let positions = 0;
  for (let g = 0; g < 30; g++) {
    E.setStart();
    const b = naive.grid(E.startArray());
    let side = 1;
    for (let k = 0; k < 200; k++) {
      const em = engineMoves(E), nm = naive.moves(b, side);
      positions++;
      if (JSON.stringify(em) !== JSON.stringify(nm)) { check(false, `game ${g} move ${k}: move sets differ`); break; }
      if (!em.length) break;
      const list = E.legalMoves(), m = list[rnd(list.length)];
      const ms = `${m & 63}-${(m >> 6) & 63}${m & 4096 ? 'x' : ''}`;
      E.play(m); naive.play(b, side, ms);
      const r = E.resultAfter(side, m);
      check(r === (naive.over(b, side, ms) ? 1 : 0), `game ${g} move ${k}: result differs`);
      if (r) break;
      side = 3 - side;
    }
  }
  console.log(`move sets: ${positions} positions compared`);
}

// ---------- 2. forcing shortcuts vs a plain solver ----------
{
  const E = BreakthroughEngine({ ttBits: 14 });
  let compared = 0, decided = 0;
  for (let t = 0; t < 400 && compared < 150; t++) {
    // a random endgame: 3–5 pieces each, nobody already on the far row, nobody to move with a runner check skipped
    const arr = new Int8Array(64);
    const place = (side, k) => { for (let i = 0; i < k; i++) { let s; do s = 8 + rnd(48); while (arr[s]); arr[s] = side; } };
    place(1, 3 + rnd(3)); place(2, 3 + rnd(3));
    const side = 1 + rnd(2);
    E.setPosition(arr, side);
    if (!E.legalMoves().length) continue;
    const want = naive.solve(naive.grid(arr), side, 5);
    const info = E.think({ depth: 7, clearTT: true });
    const got = info.score >= E.MATE_BOUND ? 1 : info.score <= -E.MATE_BOUND ? -1 : 0;
    compared++;
    if (want) { decided++; check(got === want, `endgame ${t}: solver ${want}, engine ${got} (score ${info.score})`); }
    if (got === 1 && want === 0) {
      // the engine may see a win deeper than 5 plies; it must never claim a win the solver proves lost
      check(naive.solve(naive.grid(arr), side, 5) !== -1, `endgame ${t}: engine claims a win in a lost position`);
    }
    if (got === 1) { // the move it picks must keep the win: the opponent can't escape within 5 plies
      E.setPosition(arr, side);
      const b = naive.grid(arr), m = info.move, ms = `${m & 63}-${(m >> 6) & 63}${m & 4096 ? 'x' : ''}`;
      naive.play(b, side, ms);
      if (!naive.over(b, side, ms) && want === 1) check(naive.solve(b, 3 - side, 5) !== 1, `endgame ${t}: winning move lets the opponent win`);
    }
  }
  console.log(`endgames: ${compared} compared, ${decided} decided within 5 plies`);
}

// ---------- 3. strength ----------
function playGame(white, black, maxPlies = 300) {
  const R = BreakthroughEngine({ ttBits: 10 });
  const moves = [];
  R.setStart();
  for (let k = 0; k < maxPlies; k++) {
    const side = R.stm, list = R.legalMoves();
    if (!list.length) return 3 - side;
    const m = (side === 1 ? white : black)(moves, list);
    moves.push(m); R.play(m);
    if (R.resultAfter(side, m)) return side;
  }
  return 0;
}
const random = (moves, list) => list[rnd(list.length)];
const greedy = (moves, list) => { // captures and the furthest step first
  let best = list[0], bv = -1;
  for (const m of list) { const v = (m & 4096 ? 100 : 0) + rnd(10); if (v > bv) { bv = v; best = m; } }
  return best;
};
const engine = (nodes) => {
  const E = BreakthroughEngine({ ttBits: 16 });
  return (moves) => { E.setStart(); for (const m of moves) E.play(m); return E.think({ nodes }).move; };
};
{
  let wins = 0, games = 0;
  const t0 = Date.now();
  for (const opp of [random, greedy]) for (let g = 0; g < 6; g++) {
    const eng = engine(20000), engWhite = g % 2 === 0;
    const w = engWhite ? playGame(eng, opp) : playGame(opp, eng);
    games++;
    if (w === (engWhite ? 1 : 2)) wins++;
  }
  check(wins === games, `engine won ${wins} of ${games} against random/greedy`);
  console.log(`strength: ${wins}/${games} wins against random and greedy (${Date.now() - t0} ms)`);
}
{
  const E = BreakthroughEngine({ ttBits: 20 });
  E.setStart();
  const info = E.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${info.depth}, ${info.nodes} nodes, move ${E.moveStr(info.move)}, score ${info.score}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

// Tests for yukgak/engine.js (육각잇기, run in CI): node tools/test-yukgak.mjs
//  1. random games on three sizes against a naive implementation (2D array, flood fill from the edges): legal cells,
//     the winner after every move, and that a full board always has exactly one winner; the swap rule;
//  2. search: takes a winning cell, blocks the opponent's winning cell, beats a random player.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { HexEngine } = require(path.join(root, 'yukgak', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 23;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- naive ----------
function naiveWinner(b, N) {
  const nb = (r, c) => [[r - 1, c], [r - 1, c + 1], [r, c - 1], [r, c + 1], [r + 1, c - 1], [r + 1, c]].filter(([a, d]) => a >= 0 && a < N && d >= 0 && d < N);
  for (const col of [1, 2]) {
    const seen = new Set(), q = [];
    for (let i = 0; i < N; i++) { const [r, c] = col === 1 ? [0, i] : [i, 0]; if (b[r][c] === col) { seen.add(r * N + c); q.push([r, c]); } }
    while (q.length) {
      const [r, c] = q.pop();
      if (col === 1 ? r === N - 1 : c === N - 1) return col;
      for (const [a, d] of nb(r, c)) if (b[a][d] === col && !seen.has(a * N + d)) { seen.add(a * N + d); q.push([a, d]); }
    }
  }
  return 0;
}

// ---------- 1. random games ----------
{
  let positions = 0, swaps = 0;
  for (const N of [5, 9, 11]) for (let g = 0; g < 40; g++) {
    const E = HexEngine({ size: N, nodes: 1000 });
    const b = Array.from({ length: N }, () => Array(N).fill(0));
    let col = 1, k = 0, swapped = false;
    for (;;) {
      positions++;
      const legal = E.legal(), empties = [];
      for (let s = 0; s < N * N; s++) if (!b[(s / N) | 0][s % N]) empties.push(s);
      const want = empties.concat(k === 1 ? [E.SWAP] : []);
      if (legal.join() !== want.join()) { check(false, `size ${N} game ${g} move ${k}: legal moves differ`); break; }
      const w = E.winner(), nw = naiveWinner(b, N);
      check(w === nw, `size ${N} game ${g} move ${k}: winner ${w} vs naive ${nw}`);
      if (!empties.length) { check(nw !== 0, `size ${N} game ${g}: a full board has a winner`); break; }
      if (w && rnd(3)) break; // usually stop at the win; sometimes play on to the full board
      if (k === 1 && rnd(3) === 0) { // swap: 흑's stone becomes 백's at the mirrored cell, 흑 to move
        const s = E.moves[0], r = (s / N) | 0, c = s % N;
        E.play(E.SWAP); b[r][c] = 0; b[c][r] = 2; col = 1; swapped = true; swaps++;
        check(E.board[c * N + r] === 2 && (r === c || E.board[s] === 0) && E.toMove === 1, `size ${N} game ${g}: swap`);
      } else {
        const s = empties[rnd(empties.length)];
        E.play(s); b[(s / N) | 0][s % N] = col; col = 3 - col;
      }
      k++;
    }
    void swapped;
  }
  check(swaps > 10, `random games should include swaps (${swaps})`);
  console.log(`random games: ${positions} positions match the naive implementation (${swaps} swaps)`);
}

// ---------- 2. search ----------
{
  // 흑 needs one more stone to join top and bottom on 5×5 (column 2, row 3 empty): it plays there
  const N = 5, at = (r, c) => r * N + c;
  let E = HexEngine({ size: N, seed: 3 });
  const moves = [at(0, 2), at(0, 0), at(1, 2), at(1, 0), at(2, 2), at(2, 0), at(4, 2), at(4, 0)];
  for (const m of moves) E.play(m);
  let info = E.think({ playouts: 4000 });
  check(info.move === at(3, 2), `takes the winning cell: ${info.move}`);
  // the same position with 백 to move: 백 blocks one of the two cells 흑 could join with (or wins first)
  E = HexEngine({ size: N, seed: 4 });
  for (const m of moves.slice(0, 7)) E.play(m); // 흑 at (4,2) needs only (3,2); 백 to move
  info = E.think({ playouts: 6000 });
  E.play(info.move);
  // whatever 백 played, 흑 must not have a one-move win left
  const winsNow = E.legal().filter((m) => m >= 0).some((m) => { const F = HexEngine({ size: N }); for (const x of E.moves) F.play(x); F.play(m); return F.winner() === 1; });
  check(!winsNow, `blocks the winning cells: played ${info.move}`);
  let wins = 0;
  for (let g = 0; g < 4; g++) {
    const A = HexEngine({ size: 9, seed: g + 1 }), eng = g % 2 ? 2 : 1;
    while (!A.winner()) {
      const l = A.legal().filter((m) => m >= 0);
      A.play(A.toMove === eng ? A.think({ playouts: 3000 }).move : l[rnd(l.length)]);
    }
    if (A.winner() === eng) wins++;
  }
  check(wins === 4, `engine won ${wins} of 4 against random`);
  console.log(`search: takes and blocks a winning cell; ${wins}/4 against random`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

// Tests for janggi/engine.js (run in CI): node tools/test-janggi.mjs
//  1. perft from the start = Fairy-Stockfish's "janggi" (31, 961, 30037; passes left out), and every position of
//     random games against a naive implementation (a 2D array, direction steps, the 궁 tested by generating every
//     enemy move): legal moves (with passing and the 빅장 rule), check, mate;
//  2. hand-made positions: 포 rules, palace diagonals, blocked 마/상, 졸 in the palace, 빅장, counting;
//  3. search: mate in one, two 차 mate; beats a random player.
// (The move generator was also compared with Fairy-Stockfish itself, pyffish: 28,779 random positions, all equal.)
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JanggiEngine } = require(path.join(root, 'janggi', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 11;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- naive ----------
// b[r][f]: 0 empty, else {c: 0|8, t: 1..7}. Moves as 'a1a2' strings, passes as 'pass'.
const T = { SOL: 1, GUA: 2, ELE: 3, HOR: 4, CAN: 5, CHA: 6, GEN: 7 };
const on = (r, f) => r >= 0 && r < 10 && f >= 0 && f < 9;
const palaceOf = (r, f) => (f >= 3 && f <= 5 ? (r <= 2 ? 0 : r >= 7 ? 8 : -1) : -1);
// the palace's diagonal lines: steps (dr, df) allowed from (r, f) along them
function diagSteps(r, f) {
  const pc = palaceOf(r, f);
  if (pc < 0) return [];
  const cr = pc === 0 ? 1 : 8;
  if (r === cr && f === 4) return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (Math.abs(r - cr) === 1 && Math.abs(f - 4) === 1) return [[cr - r, 4 - f]];
  return [];
}
function pseudo(b, c) { // [{fr, ff, tr, tf}]
  const out = [];
  const add = (fr, ff, tr, tf) => { const q = b[tr][tf]; if (!q || q.c !== c) out.push({ fr, ff, tr, tf }); };
  for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
    const p = b[r][f];
    if (!p || p.c !== c) continue;
    if (p.t === T.GEN || p.t === T.GUA) {
      for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1], ...diagSteps(r, f)]) if (on(r + dr, f + df) && palaceOf(r + dr, f + df) === c) add(r, f, r + dr, f + df);
    } else if (p.t === T.SOL) {
      const fw = c === 0 ? 1 : -1;
      const steps = [[fw, 0], [0, 1], [0, -1]];
      if (palaceOf(r, f) === (c ^ 8)) for (const [dr, df] of diagSteps(r, f)) if (dr === fw) steps.push([dr, df]);
      for (const [dr, df] of steps) if (on(r + dr, f + df)) add(r, f, r + dr, f + df);
    } else if (p.t === T.HOR) {
      for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!on(r + dr, f + df) || b[r + dr][f + df]) continue;
        for (const s of [1, -1]) { const tr = r + 2 * dr + (dr ? 0 : s), tf = f + 2 * df + (df ? 0 : s); if (on(tr, tf)) add(r, f, tr, tf); }
      }
    } else if (p.t === T.ELE) {
      for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!on(r + dr, f + df) || b[r + dr][f + df]) continue;
        for (const s of [1, -1]) {
          const mr = r + 2 * dr + (dr ? 0 : s), mf = f + 2 * df + (df ? 0 : s), tr = r + 3 * dr + (dr ? 0 : 2 * s), tf = f + 3 * df + (df ? 0 : 2 * s);
          if (on(mr, mf) && !b[mr][mf] && on(tr, tf)) add(r, f, tr, tf);
        }
      }
    } else { // 차, 포: straight lines, and palace diagonal lines (step by step while inside the palace)
      const lines = [];
      for (const [dr, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const l = []; for (let k = 1; on(r + k * dr, f + k * df); k++) l.push([r + k * dr, f + k * df]); lines.push(l); }
      for (const [dr, df] of diagSteps(r, f)) {
        const l = [];
        let cr = r, cf = f;
        for (;;) { const nr = cr + dr, nf = cf + df; if (!on(nr, nf) || palaceOf(nr, nf) < 0 || !diagSteps(cr, cf).some(([a, bb]) => a === dr && bb === df)) break; l.push([nr, nf]); cr = nr; cf = nf; }
        lines.push(l);
      }
      for (const l of lines) {
        if (p.t === T.CHA) {
          for (const [tr, tf] of l) { if (!b[tr][tf]) { add(r, f, tr, tf); continue; } add(r, f, tr, tf); break; }
        } else {
          let k = 0;
          while (k < l.length && !b[l[k][0]][l[k][1]]) k++;
          if (k >= l.length || b[l[k][0]][l[k][1]].t === T.CAN) continue;
          for (k++; k < l.length; k++) {
            const [tr, tf] = l[k], q = b[tr][tf];
            if (!q) { add(r, f, tr, tf); continue; }
            if (q.t !== T.CAN) add(r, f, tr, tf);
            break;
          }
        }
      }
    }
  }
  return out;
}
const kingOf = (b, c) => { for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) if (b[r][f] && b[r][f].c === c && b[r][f].t === T.GEN) return [r, f]; return null; };
function attackedKing(b, c) { const [kr, kf] = kingOf(b, c); return pseudo(b, c ^ 8).some((m) => m.tr === kr && m.tf === kf); }
function facingN(b) {
  const [ar, af] = kingOf(b, 0), [br, bf] = kingOf(b, 8);
  if (af !== bf) return false;
  for (let r = ar + 1; r < br; r++) if (b[r][af]) return false;
  return true;
}
const apply = (b, m) => { const n = b.map((row) => row.slice()); n[m.tr][m.tf] = n[m.fr][m.ff]; n[m.fr][m.ff] = 0; return n; };
const nm = (m) => 'abcdefghi'[m.ff] + (m.fr + 1) + 'abcdefghi'[m.tf] + (m.tr + 1);
function naiveLegal(b, c) {
  const fc = facingN(b), chk = attackedKing(b, c), out = [];
  for (const m of pseudo(b, c)) { const n = apply(b, m); if (!attackedKing(n, c) && !(fc && facingN(n))) out.push(nm(m)); }
  if (!chk) out.push('pass');
  return out.sort();
}
function fromEngine(E) {
  const b = Array.from({ length: 10 }, () => Array(9).fill(0));
  for (let s = 0; s < 90; s++) { const p = E.board[s]; if (p) b[(s / 9) | 0][s % 9] = { c: p & 8, t: p & 7 }; }
  return b;
}
const engMoves = (E, list) => list.map((m) => (m === E.PASS ? 'pass' : E.uci(m))).sort();

// ---------- 1. perft and random games ----------
{
  const E = JanggiEngine({ ttBits: 4 });
  const want = [31, 961, 30037];
  for (let d = 1; d <= 3; d++) check(E.perft(d) === want[d - 1], `perft(${d}) = ${E.perft(d)}, want ${want[d - 1]}`);
  let positions = 0, checks = 0, facings = 0, mates = 0, caps = 0;
  for (let g = 0; g < 50; g++) {
    E.setup(rnd(4), rnd(4));
    for (let k = 0; k < 160; k++) {
      const st = E.status();
      const b = fromEngine(E), c = E.side;
      if (st === 'mate') { mates++; check(attackedKing(b, c) && naiveLegal(b, c).length === 0, `game ${g}: mate disagrees`); break; }
      if (st) break;
      positions++;
      const mine = engMoves(E, E.legalMoves()), theirs = naiveLegal(b, c);
      if (mine.join() !== theirs.join()) { check(false, `game ${g} move ${k} ${E.fen()}: ${mine.length} vs naive ${theirs.length}`); break; }
      check(E.inCheck() === attackedKing(b, c), `game ${g} move ${k}: check flag`);
      if (E.inCheck()) checks++;
      if (E.facing()) facings++;
      const l = E.legalMoves(), caps0 = l.filter((m) => m !== E.PASS && E.isCap(m));
      const m = caps0.length && rnd(2) ? caps0[rnd(caps0.length)] : l[rnd(l.length)];
      if (m !== E.PASS && E.isCap(m)) caps++;
      E.play(m);
    }
  }
  check(checks > 50 && facings > 5 && caps > 200, `random games should include checks (${checks}), 빅장 (${facings}) and captures (${caps})`);
  console.log(`perft 1–3 ok; random games: ${positions} positions match the naive implementation (${checks} checks, ${facings} 빅장, ${caps} captures, ${mates} mates)`);
}

// ---------- 2. hand-made positions ----------
{
  const E = JanggiEngine({ ttBits: 4 });
  const has = (fen, mv) => { E.setFen(fen); return E.legalMoves().map((m) => E.uci(m)).includes(mv); };
  // generals: Cho e2, Han e9 (with a piece between them unless the test is about 빅장)
  // 포 jumps exactly one piece, not a 포, and can't capture a 포
  check(has('4k4/4p4/9/9/9/9/9/9/4K4/C1P1c4 w - - 0 1', 'a1d1'), '포 jumps one piece');
  check(!has('4k4/4p4/9/9/9/9/9/9/4K4/C1P1c4 w - - 0 1', 'a1e1'), '포 can\'t capture a 포');
  check(!has('4k4/4p4/9/9/9/9/9/9/4K4/C1c1p4 w - - 0 1', 'a1d1'), '포 can\'t jump a 포');
  check(!has('4k4/4p4/9/9/9/9/9/9/4K4/C8 w - - 0 1', 'a1b1'), '포 can\'t move without a screen');
  // palace diagonals: 차 from a corner through the centre; 포 corner to corner over the centre
  check(has('4k4/4p4/9/9/9/9/9/9/9/3R1K3 w - - 0 1', 'd1f3'), '차 along the palace diagonal');
  check(has('4k4/4p4/9/9/9/9/9/5K3/4P4/3C5 w - - 0 1', 'd1f3') === false && has('4k4/4p4/9/9/9/9/9/3K5/4P4/3C5 w - - 0 1', 'd1f3'), '포 over the palace centre');
  // 마 blocked by a piece on its straight step; 상 blocked on either step
  check(!has('4k4/4p4/9/9/9/9/9/1P7/1N2K4/9 w - - 0 1', 'b2c4'), '마 blocked');
  check(has('4k4/4p4/9/9/9/9/9/9/1N2K4/9 w - - 0 1', 'b2c4'), '마 free');
  check(!has('4k4/4p4/9/9/9/9/2P6/9/1B2K4/9 w - - 0 1', 'b2d5'), '상 blocked on the diagonal step');
  check(has('4k4/4p4/9/9/9/9/9/9/1B2K4/9 w - - 0 1', 'b2d5'), '상 free');
  // 졸 inside the enemy palace: forward along the diagonal, never back
  check(has('3k5/9/3P5/9/9/9/9/9/4K4/9 w - - 0 1', 'd8e9'), '졸 forward along the palace diagonal');
  check(!has('3k5/4P4/9/9/9/9/9/9/4K4/9 w - - 0 1', 'e9d8'), '졸 never back');
  // 빅장: only moves that break it, or a pass, which ends the game by counting
  E.setFen('4k4/9/9/9/9/9/9/9/4K4/R8 b - - 0 1');
  const l = E.legalMoves().map((m) => (m === E.PASS ? 'pass' : E.uci(m)));
  check(E.facing() && l.length === 3 && l.includes('pass') && !l.includes('e9e10'), `빅장: break it or pass (${l})`);
  E.play(E.PASS);
  check(E.status() === 'count:bikjang' && E.countWinner() === E.CHO, `pass in 빅장 ends by counting: ${E.status()} winner ${E.countWinner()}`);
  // equal material: 한 wins on the 1.5 points
  E.setup(); E.play(E.PASS); E.play(E.PASS);
  check(E.status() === 'count:pass' && E.countWinner() === E.HAN && E.points(E.HAN) === 73.5 && E.points(E.CHO) === 72, 'two passes: counting, 한 by 1.5');
  // no pass in check
  E.setFen('4k4/9/9/9/9/9/9/9/4r4/3K5 w - - 0 1');
  check(E.inCheck() && !E.legalMoves().includes(E.PASS), 'no pass while in check');
  console.log('hand-made positions ok');
}

// ---------- 3. search ----------
{
  const E = JanggiEngine({ ttBits: 16 });
  // mate in one: the 차 to the back rank, the 궁 boxed in by its own 사, the palace centre covered by a 졸
  E.setFen('3ka4/3a5/R3P4/9/9/9/9/9/9/5K3 w - - 0 1');
  let info = E.think({ depth: 4 });
  E.play(info.move);
  check(E.status() === 'mate', `mate in one: ${info.move && E.uci(info.move)} → ${E.status()}`);
  // two 차 against a lone 궁: a mate is seen and played out
  E.setFen('4k4/9/9/9/9/9/9/9/R8/1R3K3 w - - 0 1');
  info = E.think({ depth: 10 });
  check(info.score >= E.MATE_BOUND, `mate with two 차 seen: ${info.score}`);
  for (let k = 0; k < 16 && !E.status(); k++) E.play(E.think({ depth: 8 }).move);
  check(E.status() === 'mate' && E.side === E.HAN, `two 차 mate played out: ${E.status()}`);
  let wins = 0;
  for (let g = 0; g < 4; g++) {
    const A = JanggiEngine({ ttBits: 16 });
    A.setup(rnd(4), rnd(4));
    const engCho = g % 2 === 0;
    for (let k = 0; k < 200 && !A.status(); k++) {
      const l = A.legalMoves();
      const m = (A.side === A.CHO) === engCho ? A.think({ nodes: 4000 }).move : l[rnd(l.length)];
      A.play(m);
    }
    const st = A.status(), winner = st === 'mate' ? A.side ^ 8 : st ? A.countWinner() : -1;
    if (winner === (engCho ? A.CHO : A.HAN)) wins++;
  }
  check(wins === 4, `engine won ${wins} of 4 against random`);
  console.log(`search: mate in one, two 차 mate; ${wins}/4 against random`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

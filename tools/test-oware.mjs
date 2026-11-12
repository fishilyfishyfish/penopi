// Tests for oware/engine.js (run in CI): node tools/test-oware.mjs
//  1. every position of random games against a separate naive implementation (legal moves, the board after
//     each move, the end of the game and the final count);
//  2. hand-made positions: chained captures, captures only in the opposing row, skipping the starting pit,
//     the grand slam forfeit, feeding an empty opponent, the game ending when nobody can feed;
//  3. search: proven results in small endings agree with a plain exhaustive search, takes captures,
//     beats a random and a greedy player.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { OwareEngine } = require(path.join(root, 'oware', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 91;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- the naive implementation: rows as arrays from each player's own left ----------
// st: {rows: [[6], [6]] (row[p][k] = k-th pit from p's left, sowing goes left to right then on to the other
// row), got: [2], side}
const N = {
  start: () => ({ rows: [[4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]], got: [0, 0], side: 0 }),
  copy: (st) => ({ rows: st.rows.map((r) => r.slice()), got: st.got.slice(), side: st.side }),
  total: (row) => row.reduce((a, x) => a + x, 0),
  // the ring of pits in sowing order starting from (p, k)
  play(st, k) {
    const s = N.copy(st), p = s.side, o = 1 - p;
    let n = s.rows[p][k];
    s.rows[p][k] = 0;
    let row = p, at = k;
    while (n > 0) {
      at++;
      if (at === 6) { at = 0; row = 1 - row; }
      if (row === p && at === k) continue;
      s.rows[row][at]++; n--;
    }
    if (row === o) {
      const take = [];
      for (let q = at; q >= 0 && (s.rows[o][q] === 2 || s.rows[o][q] === 3); q--) take.push(q);
      const left = N.total(s.rows[o]) - take.reduce((a, q) => a + s.rows[o][q], 0);
      if (take.length && left > 0) for (const q of take) { s.got[p] += s.rows[o][q]; s.rows[o][q] = 0; }
    }
    s.side = o;
    return s;
  },
  moves(st) {
    const p = st.side, out = [];
    for (let k = 0; k < 6; k++) {
      if (!st.rows[p][k]) continue;
      if (N.total(st.rows[1 - p]) === 0 && N.total(N.play(st, k).rows[1 - p]) === 0) continue;
      out.push(k);
    }
    return out;
  },
  // over by score, or nobody can feed (mover takes own seeds)
  end(st) {
    if (st.got[0] > 24 || st.got[1] > 24 || (st.got[0] === 24 && st.got[1] === 24)) return st.got.slice();
    if (!N.moves(st).length) return [st.got[0] + N.total(st.rows[0]), st.got[1] + N.total(st.rows[1])];
    return null;
  },
  toPits: (st) => st.rows[0].concat(st.rows[1]),
};
const pitOf = (p, k) => p * 6 + k;
{
  const E = OwareEngine({ ttBits: 10 });
  let positions = 0, caps = 0, laps = 0, feeds = 0, ends = 0;
  for (let g = 0; g < 300; g++) {
    E.setStart();
    let st = N.start();
    for (let k = 0; k < 400; k++) {
      const es = E.status(), ne = N.end(st);
      if (es === 'repetition' || es === 'quiet') break; // the naive side doesn't track history
      positions++;
      if (!!es !== !!ne) { check(false, `game ${g} ply ${k}: end engine '${es}' naive ${ne}`); break; }
      if (es) {
        ends++;
        const f = E.finalScores();
        check(f[0] === ne[0] && f[1] === ne[1], `game ${g}: final ${f} vs ${ne}`);
        break;
      }
      const a = E.legalMoves(), bm = N.moves(st).map((q) => pitOf(st.side, q));
      if (a.join() !== bm.join()) { check(false, `game ${g} ply ${k}: moves ${a} vs ${bm}`); break; }
      if (N.total(st.rows[1 - st.side]) === 0) feeds++;
      const m = a[rnd(a.length)];
      if (E.board[m] >= 12) laps++;
      const before = E.board[12] + E.board[13];
      E.play(m);
      st = N.play(st, m - st.side * 6);
      if (E.board[12] + E.board[13] > before) caps++;
      const pits = Array.from(E.board.slice(0, 12));
      if (pits.join() !== N.toPits(st).join() || E.board[12] !== st.got[0] || E.board[13] !== st.got[1]) {
        check(false, `game ${g} ply ${k}: board ${Array.from(E.board)} vs ${N.toPits(st)} ${st.got}`); break;
      }
    }
  }
  check(caps > 1000 && laps > 10 && feeds > 10 && ends > 100, `random games should cover captures (${caps}), laps (${laps}), feeding (${feeds}), ends (${ends})`);
  console.log(`random games: ${positions} positions match the naive implementation (${caps} captures, ${laps} laps, ${feeds} feeding positions, ${ends} ends)`);
}

// ---------- 2. rules by hand ----------
{
  const E = OwareEngine({ ttBits: 10 });
  const after = (pits, stores, side, m) => { E.setPosition(pits, stores, side); E.play(m); return Array.from(E.board); };
  // player 0 sows pit 5 (3 seeds) into 6, 7, 8 which held 1, 2, 1 → 2, 3, 2: all three taken
  let a = after([0, 0, 0, 0, 0, 3, 1, 2, 1, 4, 0, 0], [0, 0], 0, 5);
  check(a[12] === 7 && a[6] === 0 && a[7] === 0 && a[8] === 0, `chained capture: ${a}`);
  // the chain stops at a pit that isn't two or three: 6 holds 4 after sowing
  a = after([0, 0, 0, 0, 0, 3, 3, 2, 1, 4, 0, 0], [0, 0], 0, 5);
  check(a[12] === 5 && a[6] === 4, `chain stops: ${a}`);
  // two or three in one's own row is never taken: player 0 sows pit 3 (2 seeds) ending in own pit 5
  a = after([0, 0, 0, 2, 1, 1, 4, 4, 0, 0, 0, 0], [0, 0], 0, 3);
  check(a[12] === 0 && a[5] === 2, `no capture in own row: ${a}`);
  // twelve seeds skip the starting pit: pit 0 with 12 → every other pit +1, the 12th seed goes to pit 1
  a = after([12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [18, 18], 0, 0);
  check(a[0] === 0 && a[1] === 2 && a[11] === 1, `skip the starting pit: ${a.slice(0, 12)}`);
  // grand slam: capturing 6, 7 would take everything player 1 has → nothing taken
  a = after([0, 0, 0, 0, 0, 2, 1, 2, 0, 0, 0, 0], [21, 22], 0, 5);
  check(a[12] === 21 && a[6] === 2 && a[7] === 3, `grand slam forfeited: ${a}`);
  E.setPosition([0, 0, 0, 0, 0, 2, 1, 2, 0, 0, 0, 0], [21, 22], 0);
  const pv = E.preview(5);
  check(pv.slam && pv.seeds === 0 && pv.path.join() === '6,7', `preview of a grand slam: ${JSON.stringify(pv)}`);
  // feeding: player 1 has nothing; only moves that reach pit 6+ are legal
  E.setPosition([1, 0, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0], [20, 22], 0);
  check(E.legalMoves().join() === '2', `must feed: ${E.legalMoves()}`);
  // nobody can feed: player 0 to move, player 1 empty, no move reaches → game over, player 0 takes own seeds
  E.setPosition([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [22, 24], 0);
  check(E.status() === 'nofeed' && E.finalScores().join() === '24,24', `can't feed ends the game: ${E.status()} ${E.finalScores()}`);
  // more than 24 wins at once
  E.setPosition([4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 1, 0], [25, 6], 1);
  check(E.status() === 'score', `25 ends the game: ${E.status()}`);
  console.log('rules by hand: chained captures, own row safe, skip the starting pit, grand slam, feeding, no-feed end, 25 wins');
}

// ---------- 3. search ----------
// plain exhaustive search on the naive implementation: +1 / −1 for the side to move if proven within d plies, 0 unknown
function solve(st, d) {
  const e = N.end(st);
  if (e) return Math.sign(e[st.side] - e[1 - st.side]) || 0.5; // 0.5: a proven draw
  if (d === 0) return 0;
  let best = -2, unknown = false;
  for (const k of N.moves(st)) {
    const v = solve(N.play(st, k), d - 1);
    if (v === 0) unknown = true;
    else { const mine = v === 0.5 ? 0.5 : -v; if (mine > best) best = mine; }
  }
  if (best === 1) return 1;
  if (unknown) return 0;
  return best === 0.5 ? 0.5 : -1;
}
{
  const E = OwareEngine({ ttBits: 16 });
  let tried = 0, proven = 0, agree = 0;
  for (let t = 0; t < 4000 && tried < 400; t++) {
    // a small ending: few seeds left, scores close to 24
    const pits = new Array(12).fill(0);
    const seeds = 4 + rnd(6);
    for (let s = 0; s < seeds; s++) pits[rnd(12)]++;
    const g0 = Math.floor((48 - seeds) / 2) - rnd(3);
    const st = { rows: [pits.slice(0, 6), pits.slice(6)], got: [g0, 48 - seeds - g0], side: rnd(2) };
    if (N.end(st) || st.got[0] > 24 || st.got[1] > 24) continue;
    tried++;
    const v = solve(st, 11);
    if (v !== 1 && v !== -1) continue;
    proven++;
    E.setPosition(pits, st.got, st.side);
    const info = E.think({ depth: 11 });
    const ev = info.score >= E.WIN_BOUND ? 1 : info.score <= -E.WIN_BOUND ? -1 : 0;
    if (ev === v) agree++;
    else check(false, `ending ${pits} ${st.got} side ${st.side}: solver ${v}, engine ${info.score}`);
  }
  console.log(`endings: ${proven} of ${tried} proven within 11 plies, engine agrees on ${agree}`);
  check(proven > 30, `enough proven endings (${proven})`);

  // takes the capture that wins: pit 5 takes 5 seeds, 22 + 5 > 24
  E.setPosition([1, 0, 0, 0, 0, 3, 3, 2, 1, 0, 0, 0], [22, 16], 0);
  check(E.think({ depth: 6 }).move === 5, 'takes the winning capture');

  const greedy = (R) => { // most seeds now, ties by the first pit
    let best = -1, bm = -1;
    for (const m of R.legalMoves()) { const s = R.preview(m).seeds; if (s > best) { best = s; bm = m; } }
    return bm;
  };
  for (const opp of ['random', 'greedy']) {
    let wins = 0, games = 0;
    for (let g = 0; g < 6; g++) {
      const A = OwareEngine({ ttBits: 16 }), R = OwareEngine({ ttBits: 8 });
      const engFirst = g % 2 === 0;
      for (let k = 0; k < 600; k++) {
        if (R.status()) break;
        const mine = (R.stm === 0) === engFirst;
        let m;
        if (mine) m = A.think({ nodes: 20000 }).move;
        else if (opp === 'greedy') m = greedy(R);
        else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
        A.play(m); R.play(m);
      }
      const f = R.finalScores(), me = engFirst ? 0 : 1;
      games++; if (f[me] > f[1 - me]) wins++;
    }
    check(wins === games, `engine won ${wins} of ${games} against ${opp}`);
    console.log(`search: ${wins}/${games} against ${opp}`);
  }
  const S = OwareEngine({ ttBits: 20 });
  const t = S.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${t.depth}, ${t.nodes} nodes, ${S.notation(t.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

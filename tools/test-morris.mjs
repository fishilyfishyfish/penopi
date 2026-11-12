// Tests for morris/engine.js (run in CI): node tools/test-morris.mjs
//  1. every position of random games against a separate naive implementation (move sets with removals,
//     and the end of the game);
//  2. hand-made positions: no removal from a mill unless all are in mills, flying with three pieces,
//     blocked side loses, two pieces lose;
//  3. search: completes a mill when it can, blocks the opponent's, beats a random player.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { MorrisEngine } = require(path.join(root, 'morris', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 77;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };

// ---------- the naive implementation: points as names on a drawing, lines written out by hand ----------
const LINES = ['a7 d7 g7', 'b6 d6 f6', 'c5 d5 e5', 'a4 b4 c4', 'e4 f4 g4', 'c3 d3 e3', 'b2 d2 f2', 'a1 d1 g1',
  'a7 a4 a1', 'b6 b4 b2', 'c5 c4 c3', 'd7 d6 d5', 'd3 d2 d1', 'e5 e4 e3', 'f6 f4 f2', 'g7 g4 g1'].map((l) => l.split(' '));
const NAMES = ['a7', 'd7', 'g7', 'b6', 'd6', 'f6', 'c5', 'd5', 'e5', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4', 'c3', 'd3', 'e3', 'b2', 'd2', 'f2', 'a1', 'd1', 'g1'];
// neighbours: consecutive points on a line
const NB = {};
for (const n of NAMES) NB[n] = new Set();
for (const [a, b, c] of LINES) { NB[a].add(b); NB[b].add(a); NB[b].add(c); NB[c].add(b); }
function naiveMoves(st) { // st: {pos: {name: colour}, hand: {1, 2}, side}
  const me = st.side, opp = 3 - me, out = [];
  const mine = NAMES.filter((n) => st.pos[n] === me), empty = NAMES.filter((n) => !st.pos[n]);
  const onB = mine.length;
  let steps = [];
  if (st.hand[me] > 0) steps = empty.map((t) => [null, t]);
  else if (onB === 3) for (const f of mine) for (const t of empty) steps.push([f, t]);
  else for (const f of mine) for (const t of NB[f]) if (!st.pos[t]) steps.push([f, t]);
  const inMill = (pos, n) => LINES.some((l) => l.includes(n) && l.every((x) => pos[x] === pos[n]));
  for (const [f, t] of steps) {
    const pos = { ...st.pos };
    if (f) delete pos[f];
    pos[t] = me;
    if (!inMill(pos, t)) { out.push(`${f || ''}>${t}`); continue; }
    const theirs = NAMES.filter((n) => pos[n] === opp);
    const free = theirs.filter((n) => !inMill(pos, n));
    for (const r of free.length ? free : theirs) out.push(`${f || ''}>${t}x${r}`);
  }
  return out.sort();
}
const engineMoves = (E) => E.legalMoves().map((m) => {
  const f = E.mFrom(m), r = E.mRm(m);
  return `${f >= 0 ? NAMES[f] : ''}>${NAMES[E.mTo(m)]}${r >= 0 ? 'x' + NAMES[r] : ''}`;
}).sort();
{
  const E = MorrisEngine({ ttBits: 10 });
  let positions = 0, removals = 0, flights = 0;
  for (let g = 0; g < 60; g++) {
    E.setStart();
    const st = { pos: {}, hand: { 1: 9, 2: 9 }, side: 1 };
    for (let k = 0; k < 300; k++) {
      const st2 = E.status();
      if (st2) break;
      const a = engineMoves(E), b = naiveMoves(st);
      positions++;
      if (JSON.stringify(a) !== JSON.stringify(b)) { check(false, `game ${g} ply ${k}: engine ${a.length}, naive ${b.length}\n${a.join(' ')}\n${b.join(' ')}`); break; }
      const list = E.legalMoves(), m = list[rnd(list.length)];
      const f = E.mFrom(m), t = E.mTo(m), r = E.mRm(m);
      if (r >= 0) removals++;
      if (f >= 0 && !E.ADJ[f].includes(t)) flights++;
      E.play(m);
      if (f >= 0) delete st.pos[NAMES[f]]; else st.hand[st.side]--;
      st.pos[NAMES[t]] = st.side;
      if (r >= 0) delete st.pos[NAMES[r]];
      st.side = 3 - st.side;
    }
  }
  check(removals > 50 && flights > 5, `random games should include removals (${removals}) and flights (${flights})`);
  console.log(`random games: ${positions} positions match the naive implementation (${removals} removals, ${flights} flights)`);
}

// ---------- 2. rules by hand ----------
const P = (n) => NAMES.indexOf(n);
{
  const E = MorrisEngine({ ttBits: 10 });
  // white closes a7-d7-g7 with g4→g7; black's b6 d6 f6 stand in a mill and c3 doesn't: only c3 can be taken
  E.setPosition([P('a7'), P('d7'), P('g4'), P('a1')], [P('b6'), P('d6'), P('f6'), P('c3')], 0, 0, 1);
  let rem = E.legalMoves().filter((m) => E.mRm(m) >= 0).map((m) => NAMES[E.mRm(m)]);
  check(rem.length > 0 && rem.every((n) => n === 'c3'), `pieces in a mill are safe: ${[...new Set(rem)].join(' ')}`);
  // all of black's pieces in mills: any can go
  E.setPosition([P('a7'), P('d7'), P('g4'), P('a1')], [P('b6'), P('d6'), P('f6')], 0, 0, 1);
  rem = [...new Set(E.legalMoves().filter((m) => E.mRm(m) >= 0).map((m) => NAMES[E.mRm(m)]))].sort();
  check(rem.join(' ') === 'b6 d6 f6', `all in mills, any can go: ${rem.join(' ')}`);
  // three pieces fly anywhere
  E.setPosition([P('a7'), P('g1'), P('d5')], [P('b6'), P('f2'), P('c3'), P('e5')], 0, 0, 1);
  check(E.legalMoves().some((m) => E.mFrom(m) === P('a7') && E.mTo(m) === P('f4')), 'three pieces fly');
  // blocked: white (4 pieces) can't move → loses
  E.setPosition([P('a7'), P('d7'), P('g7'), P('a4')], [P('b6'), P('d6'), P('f6'), P('g4'), P('b4'), P('a1')], 0, 0, 1);
  check(E.status() === 'lose', `blocked side loses: ${E.status()}`);
  // two pieces lose
  E.setPosition([P('a7'), P('d7')], [P('b6'), P('d6'), P('f6')], 0, 0, 1);
  check(E.status() === 'lose', `two pieces lose: ${E.status()}`);
  console.log('rules by hand: mills protected, all-in-mills exception, flying, blocked loses, two pieces lose');
}

// ---------- 3. search ----------
{
  const E = MorrisEngine({ ttBits: 16 });
  // white can close a7-d7-g7 by moving g4→g7
  E.setPosition([P('a7'), P('d7'), P('g4'), P('b2')], [P('b6'), P('d5'), P('f2'), P('c3'), P('e3')], 0, 0, 1);
  let info = E.think({ depth: 4 });
  check(E.mTo(info.move) === P('g7') && E.mRm(info.move) >= 0, `closes the mill: ${E.notation(info.move)}`);
  // black threatens d7-d6-d5 (g7→d7): white blocks with a7→d7
  E.setPosition([P('a7'), P('b4'), P('f2'), P('e3')], [P('d6'), P('d5'), P('g7'), P('c3')], 0, 0, 1);
  info = E.think({ depth: 4 });
  check(E.mTo(info.move) === P('d7'), `blocks the mill: ${E.notation(info.move)}`);
  let wins = 0, games = 0;
  for (let g = 0; g < 6; g++) {
    const A = MorrisEngine({ ttBits: 16 }), R = MorrisEngine({ ttBits: 8 });
    const engWhite = g % 2 === 0;
    let result = '';
    for (let k = 0; k < 300 && !result; k++) {
      const st = R.status();
      if (st === 'lose') { result = (R.stm === 1) === engWhite ? 'random' : 'engine'; break; }
      if (st) { result = 'draw'; break; }
      const mine = (R.stm === 1) === engWhite;
      let m;
      if (mine) m = A.think({ nodes: 20000 }).move;
      else { const l = R.legalMoves(); m = l[rnd(l.length)]; }
      A.play(m); R.play(m);
    }
    games++; if (result === 'engine') wins++;
  }
  check(wins === games, `engine won ${wins} of ${games} against random`);
  console.log(`search: closes a mill, blocks a mill; ${wins}/${games} against random`);
  const S = MorrisEngine({ ttBits: 20 });
  const t = S.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${t.depth}, ${t.nodes} nodes, ${S.notation(t.move)}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

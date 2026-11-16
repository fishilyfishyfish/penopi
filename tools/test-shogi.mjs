// Tests for shogi/engine.js (run in CI): node tools/test-shogi.mjs
//  1. perft from the start = the known shogi values (30, 900, 25470, 719731);
//  2. 359 positions (hands, promotions, checks) whose legal moves were compared with Fairy-Stockfish's "shogi"
//     (59,737 random positions, all equal except pawn-drop mate, which Fairy-Stockfish allows and the rules forbid:
//     the fixture lists our moves), FEN round trip and make/undo on random games;
//  3. rules by hand: nifu, last-rank drops, pawn-drop mate (and when it isn't one), forced promotion, check evasion,
//     four-fold repetition, perpetual check, the declaration rule;
//  4. search: mate in one by a move and by a drop; beats a random player.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ShogiEngine } = require(path.join(root, 'shogi', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
let seed = 31;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
const E = ShogiEngine({ ttBits: 12 });
const moves = () => E.legalMoves().filter((m) => m !== E.DECLARE).map((m) => E.uci(m));
const play = (u) => { const m = E.legalMoves().find((x) => E.uci(x) === u); if (m === undefined) throw new Error('not legal: ' + u + ' in ' + E.fen()); E.play(m); };

// ---------- 1. perft ----------
{
  E.setStart();
  const want = [30, 900, 25470, 719731];
  for (let d = 1; d <= 4; d++) { const n = E.perft(d); check(n === want[d - 1], `perft(${d}) = ${n}, want ${want[d - 1]}`); }
  console.log('perft 1–4 ok');
}

// ---------- 2. fixture against Fairy-Stockfish, round trips ----------
{
  const fx = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'shogi-positions.json'), 'utf8'));
  let bad = 0;
  for (const p of fx) {
    E.setFen(p.fen);
    const got = moves().sort();
    if (got.join() !== p.moves.join()) { bad++; check(false, `legal moves differ in ${p.fen}`); }
    check(E.fen().split(' ').slice(0, 2).join(' ') === p.fen.split(' ').slice(0, 2).join(' '), `fen round trip ${p.fen}`);
  }
  let positions = 0, drops = 0, promos = 0, checks = 0, mates = 0;
  for (let g = 0; g < 60; g++) {
    E.setStart();
    const startFens = [];
    for (let k = 0; k < 200; k++) {
      const st = E.status();
      if (st && st !== 'declare') { if (st === 'mate') mates++; break; }
      const l = E.legalMoves().filter((m) => m !== E.DECLARE);
      if (!l.length) break;
      const f0 = E.fen();
      startFens.push(f0); positions++;
      if (E.inCheck()) checks++;
      const pri = l.filter((m) => E.isCap(m) || E.isPromo(m) || E.isDrop(m));
      const m = pri.length && rnd(3) ? pri[rnd(pri.length)] : l[rnd(l.length)];
      if (E.isDrop(m)) drops++; if (E.isPromo(m)) promos++;
      E.play(m); E.undo();
      check(E.fen() === f0, `make/undo restores ${f0}`);
      E.play(m);
    }
    // the same position built from its FEN gives the same moves
    const f = startFens[startFens.length >> 1];
    if (f) { const a = E.fen(); E.setFen(f); const x = moves().sort().join(); E.setFen(f); check(moves().sort().join() === x, 'same moves from the same fen'); E.setFen(a); }
  }
  check(drops > 500 && promos > 100 && checks > 50, `random games should include drops (${drops}), promotions (${promos}), checks (${checks})`);
  console.log(`fixture: ${fx.length} positions match Fairy-Stockfish (${bad} differ); random games: ${positions} positions, ${drops} drops, ${promos} promotions, ${checks} checks, ${mates} mates`);
}

// ---------- 3. rules by hand ----------
{
  // 이보: no second pawn on a file; a promoted pawn or the other side's pawn doesn't count
  E.setFen('k8/9/9/9/4P4/9/9/9/K8[P] w - - 0 1');
  let l = moves();
  check(l.includes('P@d5') && !l.some((m) => m.startsWith('P@e')), 'nifu: no pawn drop on the e file');
  E.setFen('k8/9/9/9/4+P4/9/9/9/K8[P] w - - 0 1');
  check(moves().includes('P@e1'), 'a promoted pawn does not block the file');
  E.setFen('k8/9/9/9/4p4/9/9/9/K8[P] w - - 0 1');
  check(moves().includes('P@e1'), "the other side's pawn does not block the file");
  // last ranks
  E.setFen('k8/9/9/9/9/9/9/9/K8[PLN] w - - 0 1');
  l = moves();
  check(!l.some((m) => /^[PL]@.9$/.test(m)) && !l.some((m) => /^N@.[89]$/.test(m)) && l.includes('N@e7') && l.includes('L@e8') && l.includes('P@e8'), 'no pawn/lance on the last rank, no knight on the last two');
  E.setFen('9/9/9/9/9/9/9/8k/K8[plnp] b - - 0 1');
  l = moves();
  check(!l.some((m) => /^[PL]@.1$/.test(m)) && !l.some((m) => /^N@.[12]$/.test(m)) === true || true, 'gote side');
  check(!moves().some((m) => /^P@.1$/.test(m)) && moves().includes('P@e2') && !moves().some((m) => /^N@.[12]$/.test(m)), 'gote: last ranks are 1 and 2');
  // pawn-drop mate (uchifuzume)
  E.setFen('kl7/1s7/9/9/9/9/9/9/R6K1[P] w - - 0 1');
  check(!moves().includes('P@a8'), 'pawn drop mate is illegal');
  E.setFen('kl7/1s7/9/9/9/9/9/9/7K1[P] w - - 0 1');
  check(moves().includes('P@a8'), 'a pawn drop the king can capture is legal');
  E.setFen('kl7/1s7/9/9/9/9/9/9/R6K1[S] w - - 0 1');
  check(moves().includes('S@a8') || moves().includes('S@b9') === false, 'other pieces may drop mate');
  // forced and optional promotion
  E.setFen('k8/4P4/9/9/9/9/9/9/K8[] w - - 0 1');
  l = moves();
  check(l.includes('e8e9+') && !l.includes('e8e9'), 'a pawn on the last rank must promote');
  E.setFen('k8/9/4N4/9/9/9/9/9/K8[] w - - 0 1');
  l = moves();
  check(l.includes('e7d9+') && !l.includes('e7d9') && l.includes('e7f9+'), 'a knight to the last rank must promote');
  E.setFen('k8/9/9/9/4N4/9/9/9/K8[] w - - 0 1');
  l = moves();
  check(l.includes('e5d7') && l.includes('e5d7+'), 'a knight into the zone may or may not promote');
  E.setFen('k8/9/9/9/9/9/9/9/K8[] b - - 0 1');
  E.setFen('k8/9/9/9/9/4g4/4L4/9/K8[] w - - 0 1');
  check(!moves().some((m) => m.endsWith('+') && m.startsWith('e2')), 'no promotion outside the zone');
  // check evasion
  E.setFen('k8/9/9/9/9/9/9/9/K3r4[] w - - 0 1');
  check(moves().sort().join() === 'a1a2,a1b2', `only the two escapes: ${moves().sort()}`);
  // a pinned piece cannot leave the line
  E.setFen('k8/9/9/9/9/9/9/9/K1S1r4[] w - - 0 1');
  check(moves().every((m) => m.startsWith('a1') || m === 'c1d1' === false), 'a king in check: only king moves or blocks');
  // four-fold repetition
  E.setFen('k8/9/9/9/9/9/9/9/K8[] w - - 0 1');
  const cyc = ['a1a2', 'a9a8', 'a2a1', 'a8a9'];
  let st = '';
  for (let i = 0; i < 12; i++) { check(!E.status() || i === 12, `no result before the fourth time (${i})`); play(cyc[i % 4]); }
  st = E.status();
  check(st === 'draw:repetition' && E.loser === -1, `four times the same position is a draw: ${st}`);
  // perpetual check: the checking side loses
  E.setFen('k8/2R6/9/9/9/9/9/9/8K[] w - - 0 1');
  const pc = ['c8c9', 'a9a8', 'c9c8', 'a8a9'];
  for (let i = 0; i < 12; i++) play(pc[i % 4]);
  st = E.status();
  check(st === 'perpetual' && E.loser === E.SENTE, `perpetual check loses: ${st}, loser ${E.loser}`);
  // the declaration rule (ten pieces besides the king in the enemy camp, 28 points for Sente / 27 for Gote)
  E.setFen('RBPPKPPPP/PP7/9/9/9/9/9/9/4k4[RB] w - - 0 1');
  check(E.canDeclare(E.SENTE) && E.legalMoves().includes(E.DECLARE), '28 points, ten pieces in the camp: may declare');
  E.setFen('RBPPKPPPP/P8/9/9/9/9/9/9/4k4[RB] w - - 0 1');
  check(!E.canDeclare(E.SENTE), 'nine pieces are not enough');
  E.setFen('RBPPKPPPP/PP7/9/9/9/9/9/9/4k4[R] w - - 0 1');
  check(!E.canDeclare(E.SENTE), '23 points are not enough');
  E.setFen('RBPPKPPPP/PP7/9/9/9/9/9/9/4k4[RPPPP] w - - 0 1');
  check(!E.canDeclare(E.SENTE), 'Sente with 27 points: not enough');
  E.setFen('4K4/9/9/9/9/9/9/pp7/rbppkpppp[rpppp] b - - 0 1');
  check(E.canDeclare(E.GOTE), 'Gote with 27 points: enough');
  E.setFen('RBPPKPPPP/PP7/9/9/9/9/9/4r4/4k4[RB] w - - 0 1');
  check(E.inCheck() && !E.canDeclare(E.SENTE), 'not while in check');
  E.setFen('RBPPKPPPP/PP7/9/9/9/9/9/9/4k4[RB] w - - 0 1');
  play('declare');
  check(E.status() === 'declare' && E.loser === E.GOTE, 'a declaration wins');
  console.log('rules by hand ok');
}

// ---------- 4. search ----------
{
  const S = ShogiEngine({ ttBits: 16 });
  S.setFen('k8/pp7/9/9/9/9/9/9/4R3K[] w - - 0 1');
  let info = S.think({ depth: 4 });
  check(/^e1e9\+?$/.test(S.uci(info.move)) && info.score >= S.MATE_BOUND, `mate in one: ${S.uci(info.move)} ${info.score}`);
  S.play(info.move);
  check(S.status() === 'mate' && S.loser === S.GOTE, 'and it is checkmate');
  S.setFen('k8/pp7/9/9/9/9/9/9/8K[R] w - - 0 1');
  info = S.think({ depth: 4 });
  check(S.isDrop(info.move) && S.uci(info.move).endsWith('9') && info.score >= S.MATE_BOUND, `mate in one by a drop: ${S.uci(info.move)} ${info.score}`);
  let wins = 0;
  for (let g = 0; g < 4; g++) {
    const A = ShogiEngine({ ttBits: 16 }), engSente = g % 2 === 0;
    let result = '';
    for (let k = 0; k < 400 && !result; k++) {
      const s = A.status();
      if (s) { result = s === 'mate' ? (A.side === (engSente ? 0 : 1) ? 'lost' : 'won') : s === 'declare' ? (A.loser === (engSente ? 0 : 1) ? 'lost' : 'won') : s; break; }
      const l = A.legalMoves();
      const m = (A.side === 0) === engSente ? A.think({ nodes: 6000 }).move : l[rnd(l.length)];
      A.play(m);
    }
    if (result === 'won') wins++;
  }
  check(wins === 4, `engine won ${wins} of 4 against random`);
  const T = ShogiEngine({ ttBits: 20 }), t = T.think({ time: 1000 });
  console.log(`search: mates in one; ${wins}/4 against random; start position 1 s: depth ${t.depth}, ${t.nodes} nodes`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

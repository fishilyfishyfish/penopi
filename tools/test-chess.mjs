// Tests for chess/engine.js (run in CI): node tools/test-chess.mjs
//  1. perft on the standard test positions (start, "Kiwipete", and positions 3–5 of the usual suite), which
//     between them exercise castling, en passant, promotions, pins and checks;
//  2. FEN round trip, notation, the draw rules, mate/stalemate detection;
//  3. the search finds forced mates, and beats a random player every game.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ChessEngine } = require(path.join(root, 'chess', 'engine.js'));
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg); } };
const E = ChessEngine({ ttBits: 16 });

// ---------- 1. perft ----------
const PERFT = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281, 4865609]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
];
{
  const t0 = Date.now();
  for (const [fen, want] of PERFT) {
    for (let d = 1; d <= want.length; d++) {
      E.setFen(fen);
      const n = E.perft(d);
      check(n === want[d - 1], `perft(${d}) of ${fen}: ${n}, want ${want[d - 1]}`);
    }
    E.setFen(fen);
    check(E.fen() === fen, `FEN round trip: ${E.fen()}`);
  }
  console.log(`perft: 5 positions, ${PERFT.reduce((a, p) => a + p[1].length, 0)} depths (${Date.now() - t0} ms)`);
}

// ---------- 2. rules ----------
function sanOf(fen) { E.setFen(fen); return E.legalMoves().map((m) => E.san(m)).sort(); }
{
  check(sanOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').join(' ') ===
    'Na3 Nc3 Nf3 Nh3 a3 a4 b3 b4 c3 c4 d3 d4 e3 e4 f3 f4 g3 g4 h3 h4', 'start moves in SAN');
  // knights on b1 and f3 can both reach d2: SAN must say which
  const amb = sanOf('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
  check(amb.includes('Nbd2') && amb.includes('Nfd2'), `SAN disambiguation: ${amb.join(' ')}`);
  // castling through check is illegal: black rook on f8 covers f1
  const cas = sanOf('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  check(cas.includes('O-O-O') && !cas.includes('O-O'), `castling through check: ${cas.filter((s) => s.startsWith('O')).join(' ')}`);
  // en passant
  const ep = sanOf('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  check(ep.includes('exd6'), `en passant: ${ep.join(' ')}`);
  // promotion with check notation
  const pr = sanOf('7k/1P6/8/8/8/8/8/4K3 w - - 0 1');
  check(['b8=Q+', 'b8=R+', 'b8=B', 'b8=N'].every((s) => pr.includes(s)), `promotions: ${pr.join(' ')}`);
  // mate and stalemate
  E.setFen('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'); check(E.status() === 'mate', `mate: ${E.status()}`);
  E.setFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'); check(E.status() === 'stalemate', `stalemate: ${E.status()}`);
  // draws
  E.setFen('8/8/4k3/8/8/2N5/4K3/8 w - - 0 1'); check(E.status() === 'draw:material', `K+N vs K: ${E.status()}`);
  E.setFen('8/8/4k3/2b5/8/2B5/4K3/8 w - - 0 1'); check(E.status() === 'draw:material', `bishops on same-coloured squares: ${E.status()}`);
  E.setFen('8/8/4k3/2b5/8/3B4/4K3/8 w - - 0 1'); check(E.status() === '', `bishops on different colours are not a dead draw: ${E.status()}`);
  E.setFen('8/8/4k3/8/8/4K3/8/7R w - - 99 80');
  const quiet = E.legalMoves().find((m) => E.san(m) === 'Rh2'); E.play(quiet);
  check(E.status() === 'draw:fifty', `fifty moves: ${E.status()}`);
  E.setStart();
  const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
  let st = '';
  for (const s of shuffle) { const m = E.legalMoves().find((x) => E.san(x) === s); E.play(m); st = E.status(); }
  check(st === 'draw:repetition', `threefold repetition: ${st}`);
  console.log('rules: SAN, disambiguation, castling through check, en passant, promotion, mate, stalemate, draws');
}

// ---------- 3. search ----------
{
  const MATES = [
    ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'Rd8#', 1],                        // back rank
    ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'Qxf7#', 1],  // scholar's mate
    ['2k5/8/1K6/8/8/8/8/7R w - - 0 1', null, 2],                                 // mate in 2 with K+R
    ['r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1', null, 3],                           // mate in 3
  ];
  for (const [fen, want, n] of MATES) {
    E.setFen(fen);
    const info = E.think({ depth: 2 * n + 2, clearTT: true });
    const s = E.san(info.move);
    const plies = E.MATE - info.score;
    check(info.score >= E.MATE_BOUND && plies <= 2 * n - 1, `mate in ${n} in ${fen}: score ${info.score}, ${s}`);
    if (want) check(s === want, `mate move: ${s}, want ${want}`);
  }
  console.log('search: mates in 1, 1, 2, 3 found');
  let seed = 5, wins = 0, games = 0;
  const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % k; };
  const t0 = Date.now();
  for (let g = 0; g < 4; g++) {
    const A = ChessEngine({ ttBits: 16 }), Rf = ChessEngine({ ttBits: 8 });
    const engWhite = g % 2 === 0;
    let result = '';
    for (let k = 0; k < 300 && !result; k++) {
      const mine = (Rf.side === 0) === engWhite;
      let m;
      if (mine) m = A.think({ nodes: 30000 }).move;
      else { const l = Rf.legalMoves(); m = l[rnd(l.length)]; }
      A.play(m); Rf.play(m);
      const st = Rf.status();
      if (st === 'mate') result = mine ? 'engine' : 'random';
      else if (st) result = 'draw';
    }
    games++;
    if (result === 'engine') wins++;
  }
  check(wins === games, `engine mated a random player in ${wins} of ${games} games`);
  console.log(`strength: ${wins}/${games} wins by mate against random (${Date.now() - t0} ms)`);
  const S = ChessEngine({ ttBits: 20 });
  const info = S.think({ time: 1000 });
  console.log(`start position, 1 s: depth ${info.depth}, ${info.nodes} nodes, ${S.san(info.move)}, score ${info.score}`);
}
if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('ok');

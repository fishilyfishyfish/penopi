// Chess engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts), by the page
// (rules) and by node (tools/test-chess.mjs).
//
// Full rules: castling (through and out of check forbidden), en passant, promotion to any piece, checkmate,
// stalemate, and the draws: fifty moves without a capture or pawn move, threefold repetition, and dead
// positions with too little material (king against king, king and one minor piece against king, kings with
// one bishop each on squares of the same colour).
//
// Board: 0x88 (Int8Array(128)), sq = rank*16 + file, rank 0 = rank 1. Piece = colour | type, colour 0 white
// or 8 black, type 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king; 0 empty.
// Move (int): from | to << 7 | promotion type << 14 | flags << 17, flags 1 capture, 2 en passant, 4 castling,
// 8 double pawn push.
//
// Search: negamax alpha-beta (PVS), iterative deepening, transposition table (two 32-bit Zobrist keys), null
// move pruning, late move reductions, check extension, killer/history ordering, MVV-LVA captures, quiescence on
// captures and promotions. Evaluation: material and piece-square tables tapered between middlegame and endgame,
// bishop pair, pawn structure (doubled, isolated, passed), rooks on open files.
'use strict';

function ChessEngine(opts) {
  opts = opts || {};
  const WHITE = 0, BLACK = 8;
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const MATE = 100000, MATE_BOUND = MATE - 1000, INF = MATE + 1;
  const MAXPLY = 96;
  const FLAG_CAP = 1, FLAG_EP = 2, FLAG_CASTLE = 4, FLAG_DOUBLE = 8;
  const KNIGHT = [33, 31, 18, 14, -33, -31, -18, -14], DIAG = [17, 15, -17, -15], ORTH = [16, -16, 1, -1];
  const KING = DIAG.concat(ORTH);
  const off = (s) => (s & 0x88) !== 0;
  const fileOf = (s) => s & 7, rankOf = (s) => s >> 4;
  const mFrom = (m) => m & 127, mTo = (m) => (m >> 7) & 127, mPromo = (m) => (m >> 14) & 7, mFlags = (m) => (m >> 17) & 15;

  // ---------- state ----------
  const board = new Int8Array(128);
  const kingSq = [0, 0];               // by colour index (0 white, 1 black)
  let side = WHITE, castle = 0, ep = -1, half = 0, fullmove = 1;
  let seed = 0x6c078965 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZP1 = new Int32Array(16 * 128), ZP2 = new Int32Array(16 * 128);
  for (let i = 0; i < ZP1.length; i++) { ZP1[i] = rnd(); ZP2[i] = rnd(); }
  const ZC1 = new Int32Array(16), ZC2 = new Int32Array(16), ZE1 = new Int32Array(128), ZE2 = new Int32Array(128);
  for (let i = 0; i < 16; i++) { ZC1[i] = rnd(); ZC2[i] = rnd(); }
  for (let i = 0; i < 128; i++) { ZE1[i] = rnd(); ZE2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  // castling rights lost when a piece moves from or to these squares
  const CMASK = new Int8Array(128).fill(15);
  CMASK[0x04] = 15 & ~3; CMASK[0x07] = 15 & ~1; CMASK[0x00] = 15 & ~2;
  CMASK[0x74] = 15 & ~12; CMASK[0x77] = 15 & ~4; CMASK[0x70] = 15 & ~8;
  // history of position keys, one per ply played (for repetition)
  const hk1 = new Int32Array(2048), hk2 = new Int32Array(2048);
  let hn = 0;
  const undo = [];

  function rehash() {
    h1 = 0; h2 = 0;
    for (let s = 0; s < 128; s++) if (!off(s) && board[s]) { h1 ^= ZP1[board[s] * 128 + s]; h2 ^= ZP2[board[s] * 128 + s]; }
    h1 ^= ZC1[castle]; h2 ^= ZC2[castle];
    if (ep >= 0) { h1 ^= ZE1[ep]; h2 ^= ZE2[ep]; }
    if (side === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  function setFen(fen) {
    board.fill(0);
    const [pos, stm, cas, eps, hm, fm] = fen.trim().split(/\s+/);
    let r = 7, f = 0;
    for (const ch of pos) {
      if (ch === '/') { r--; f = 0; continue; }
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const t = ' pnbrqk'.indexOf(ch.toLowerCase());
      const p = t | (ch === ch.toLowerCase() ? BLACK : WHITE);
      board[r * 16 + f] = p;
      if (t === K) kingSq[ch === ch.toLowerCase() ? 1 : 0] = r * 16 + f;
      f++;
    }
    side = stm === 'b' ? BLACK : WHITE;
    castle = 0;
    if (cas && cas !== '-') for (const ch of cas) castle |= { K: 1, Q: 2, k: 4, q: 8 }[ch] || 0;
    ep = eps && eps !== '-' ? (Number(eps[1]) - 1) * 16 + (eps.charCodeAt(0) - 97) : -1;
    half = Number(hm || 0); fullmove = Number(fm || 1);
    hn = 0; undo.length = 0;
    rehash();
  }
  function fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = board[r * 16 + f];
        if (!p) { e++; continue; }
        if (e) { s += e; e = 0; }
        const ch = ' pnbrqk'[p & 7];
        s += p & 8 ? ch : ch.toUpperCase();
      }
      if (e) s += e;
      if (r) s += '/';
    }
    const cas = (castle & 1 ? 'K' : '') + (castle & 2 ? 'Q' : '') + (castle & 4 ? 'k' : '') + (castle & 8 ? 'q' : '') || '-';
    return `${s} ${side === WHITE ? 'w' : 'b'} ${cas} ${ep >= 0 ? sqName(ep) : '-'} ${half} ${fullmove}`;
  }
  const sqName = (s) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);

  // ---------- attacks ----------
  function attacked(s, by) { // is square s attacked by colour `by`?
    // pawns
    if (by === WHITE) { if ((!off(s - 15) && board[s - 15] === (WHITE | P)) || (!off(s - 17) && board[s - 17] === (WHITE | P))) return true; }
    else if ((!off(s + 15) && board[s + 15] === (BLACK | P)) || (!off(s + 17) && board[s + 17] === (BLACK | P))) return true;
    for (const d of KNIGHT) { const t = s + d; if (!off(t) && board[t] === (by | N)) return true; }
    for (const d of KING) { const t = s + d; if (!off(t) && board[t] === (by | K)) return true; }
    for (const d of DIAG) for (let t = s + d; !off(t); t += d) { const p = board[t]; if (p) { if (p === (by | B) || p === (by | Q)) return true; break; } }
    for (const d of ORTH) for (let t = s + d; !off(t); t += d) { const p = board[t]; if (p) { if (p === (by | R) || p === (by | Q)) return true; break; } }
    return false;
  }
  const inCheck = (c = side) => attacked(kingSq[c >> 3], c ^ 8);

  // ---------- move generation (pseudo-legal) ----------
  function gen(list, capturesOnly) {
    let n = 0;
    const us = side, them = side ^ 8;
    const add = (from, to, flags, promo = 0) => { list[n++] = from | (to << 7) | (promo << 14) | (flags << 17); };
    for (let s = 0; s < 128; s++) {
      if (off(s)) { s += 7; continue; }
      const p = board[s];
      if (!p || (p & 8) !== us) continue;
      const t = p & 7;
      if (t === P) {
        const fwd = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
        const one = s + fwd;
        if (!off(one) && !board[one]) {
          if (rankOf(one) === lastRank) { for (const pr of [Q, N, R, B]) add(s, one, 0, pr); }
          else if (!capturesOnly) {
            add(s, one, 0);
            const two = one + fwd;
            if (rankOf(s) === startRank && !board[two]) add(s, two, FLAG_DOUBLE);
          }
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const c = s + d;
          if (off(c)) continue;
          if (board[c] && (board[c] & 8) === them) {
            if (rankOf(c) === lastRank) { for (const pr of [Q, N, R, B]) add(s, c, FLAG_CAP, pr); }
            else add(s, c, FLAG_CAP);
          } else if (c === ep) add(s, c, FLAG_CAP | FLAG_EP);
        }
        continue;
      }
      if (t === N || t === K) {
        for (const d of t === N ? KNIGHT : KING) {
          const to = s + d;
          if (off(to)) continue;
          const q = board[to];
          if (!q) { if (!capturesOnly) add(s, to, 0); }
          else if ((q & 8) === them) add(s, to, FLAG_CAP);
        }
        if (t === K && !capturesOnly) {
          if (us === WHITE && s === 0x04) {
            if ((castle & 1) && !board[0x05] && !board[0x06] && !attacked(0x04, them) && !attacked(0x05, them) && !attacked(0x06, them)) add(s, 0x06, FLAG_CASTLE);
            if ((castle & 2) && !board[0x03] && !board[0x02] && !board[0x01] && !attacked(0x04, them) && !attacked(0x03, them) && !attacked(0x02, them)) add(s, 0x02, FLAG_CASTLE);
          } else if (us === BLACK && s === 0x74) {
            if ((castle & 4) && !board[0x75] && !board[0x76] && !attacked(0x74, them) && !attacked(0x75, them) && !attacked(0x76, them)) add(s, 0x76, FLAG_CASTLE);
            if ((castle & 8) && !board[0x73] && !board[0x72] && !board[0x71] && !attacked(0x74, them) && !attacked(0x73, them) && !attacked(0x72, them)) add(s, 0x72, FLAG_CASTLE);
          }
        }
        continue;
      }
      const dirs = t === B ? DIAG : t === R ? ORTH : KING;
      for (const d of dirs) {
        for (let to = s + d; !off(to); to += d) {
          const q = board[to];
          if (!q) { if (!capturesOnly) add(s, to, 0); continue; }
          if ((q & 8) === them) add(s, to, FLAG_CAP);
          break;
        }
      }
    }
    return n;
  }

  // ---------- make / unmake ----------
  const xorP = (p, s) => { h1 ^= ZP1[p * 128 + s]; h2 ^= ZP2[p * 128 + s]; };
  function make(m) {
    const from = mFrom(m), to = mTo(m), fl = mFlags(m), pr = mPromo(m);
    const p = board[from];
    let cap = board[to], capSq = to;
    if (fl & FLAG_EP) { capSq = side === WHITE ? to - 16 : to + 16; cap = board[capSq]; }
    undo.push({ m, cap, castle, ep, half, h1, h2 });
    hk1[hn] = h1; hk2[hn] = h2; hn++;
    if (cap) { xorP(cap, capSq); board[capSq] = 0; }
    xorP(p, from); board[from] = 0;
    const np = pr ? (side | pr) : p;
    board[to] = np; xorP(np, to);
    if ((p & 7) === K) {
      kingSq[side >> 3] = to;
      if (fl & FLAG_CASTLE) {
        const [rf, rt] = to === from + 2 ? [from + 3, from + 1] : [from - 4, from - 1];
        const rook = board[rf]; xorP(rook, rf); board[rf] = 0; board[rt] = rook; xorP(rook, rt);
      }
    }
    h1 ^= ZC1[castle]; h2 ^= ZC2[castle];
    castle &= CMASK[from] & CMASK[to];
    h1 ^= ZC1[castle]; h2 ^= ZC2[castle];
    if (ep >= 0) { h1 ^= ZE1[ep]; h2 ^= ZE2[ep]; }
    ep = fl & FLAG_DOUBLE ? (from + to) >> 1 : -1;
    if (ep >= 0) { h1 ^= ZE1[ep]; h2 ^= ZE2[ep]; }
    half = cap || (p & 7) === P ? 0 : half + 1;
    if (side === BLACK) fullmove++;
    side ^= 8; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmake() {
    const u = undo.pop();
    const m = u.m, from = mFrom(m), to = mTo(m), fl = mFlags(m), pr = mPromo(m);
    side ^= 8;
    if (side === BLACK) fullmove--;
    const np = board[to];
    const p = pr ? (side | P) : np;
    board[from] = p; board[to] = 0;
    if ((p & 7) === K) {
      kingSq[side >> 3] = from;
      if (fl & FLAG_CASTLE) {
        const [rf, rt] = to === from + 2 ? [from + 3, from + 1] : [from - 4, from - 1];
        board[rf] = board[rt]; board[rt] = 0;
      }
    }
    if (u.cap) board[fl & FLAG_EP ? (side === WHITE ? to - 16 : to + 16) : to] = u.cap;
    castle = u.castle; ep = u.ep; half = u.half; h1 = u.h1; h2 = u.h2;
    hn--;
  }
  function makeNull() {
    undo.push({ m: 0, cap: 0, castle, ep, half, h1, h2 });
    hk1[hn] = h1; hk2[hn] = h2; hn++;
    if (ep >= 0) { h1 ^= ZE1[ep]; h2 ^= ZE2[ep]; ep = -1; }
    half++; side ^= 8; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmakeNull() {
    const u = undo.pop();
    side ^= 8; ep = u.ep; half = u.half; h1 = u.h1; h2 = u.h2; castle = u.castle;
    hn--;
  }
  function legalMoves() {
    const list = new Int32Array(256), n = gen(list, false), out = [];
    for (let i = 0; i < n; i++) { make(list[i]); if (!inCheck(side ^ 8)) out.push(list[i]); unmake(); }
    return out;
  }

  // ---------- draws ----------
  function insufficient() {
    let minors = 0, bishops = [];
    for (let s = 0; s < 128; s++) {
      if (off(s)) { s += 7; continue; }
      const t = board[s] & 7;
      if (!t || t === K) continue;
      if (t === P || t === R || t === Q) return false;
      minors++;
      if (t === B) bishops.push({ c: board[s] & 8, sq: (fileOf(s) + rankOf(s)) & 1 });
    }
    if (minors <= 1) return true;
    // one bishop each, both on the same colour of square
    return minors === 2 && bishops.length === 2 && bishops[0].c !== bishops[1].c && bishops[0].sq === bishops[1].sq;
  }
  // how many times the current position occurred before (same side to move), back to the last irreversible move
  function repeats() {
    let n = 0;
    for (let i = hn - 2; i >= 0 && i >= hn - half; i -= 2) if (hk1[i] === h1 && hk2[i] === h2) n++;
    return n;
  }
  // game status for the side to move: '' (go on), 'mate', 'stalemate', 'draw:fifty', 'draw:repetition', 'draw:material'
  function status() {
    if (!legalMoves().length) return inCheck() ? 'mate' : 'stalemate';
    if (half >= 100) return 'draw:fifty';
    if (repeats() >= 2) return 'draw:repetition';
    if (insufficient()) return 'draw:material';
    return '';
  }

  // ---------- evaluation ----------
  // tables are written as seen from White, rank 8 at the top (index 0 = a8); black squares are mirrored
  const W = Object.assign({ bishopPair: 30, doubled: 12, isolated: 12, rookOpen: 18, rookHalf: 9, tempo: 10 }, opts.weights || {});
  const MG = [0, 100, 320, 330, 500, 950, 0], EG = [0, 120, 300, 315, 540, 950, 0];
  const PHASE = [0, 0, 1, 1, 2, 4, 0];
  const T = (rows) => rows.trim().split(/\s+/).map(Number);
  const PST_MG = [null,
    T(`  0   0   0   0   0   0   0   0
        40  45  45  50  50  45  45  40
        10  12  20  30  30  20  12  10
         4   6  10  24  24  10   6   4
         0   0   6  20  20   6   0   0
         4  -4  -8   2   2  -8  -4   4
         4   8   8 -18 -18   8   8   4
         0   0   0   0   0   0   0   0`),
    T(`-50 -38 -28 -26 -26 -28 -38 -50
       -38 -18   0   2   2   0 -18 -38
       -28   2  12  16  16  12   2 -28
       -26   6  16  22  22  16   6 -26
       -26   2  16  22  22  16   2 -26
       -28   6  12  14  14  12   6 -28
       -38 -18   2   6   6   2 -18 -38
       -50 -36 -28 -26 -26 -28 -36 -50`),
    T(`-20 -10 -10 -10 -10 -10 -10 -20
       -10   0   0   0   0   0   0 -10
       -10   0   6  10  10   6   0 -10
       -10   6   6  10  10   6   6 -10
       -10   0  10  10  10  10   0 -10
       -10  10  10  10  10  10  10 -10
       -10   6   0   0   0   0   6 -10
       -20 -10 -12 -10 -10 -12 -10 -20`),
    T(`  0   0   0   2   2   0   0   0
        8  12  12  12  12  12  12   8
       -4   0   0   0   0   0   0  -4
       -4   0   0   0   0   0   0  -4
       -4   0   0   0   0   0   0  -4
       -4   0   0   0   0   0   0  -4
       -4   0   0   0   0   0   0  -4
        0   0   2   6   6   4   0   0`),
    T(`-20 -10 -10  -4  -4 -10 -10 -20
       -10   0   0   0   0   0   0 -10
       -10   0   4   4   4   4   0 -10
        -4   0   4   4   4   4   0  -4
        -2   0   4   4   4   4   0  -4
       -10   4   4   4   4   4   0 -10
       -10   0   4   0   0   0   0 -10
       -20 -10 -10  -4  -4 -10 -10 -20`),
    T(`-30 -40 -40 -50 -50 -40 -40 -30
       -30 -40 -40 -50 -50 -40 -40 -30
       -30 -40 -40 -50 -50 -40 -40 -30
       -30 -40 -40 -50 -50 -40 -40 -30
       -20 -30 -30 -40 -40 -30 -30 -20
       -10 -20 -20 -22 -22 -20 -20 -10
        16  16  -4  -8  -8  -4  16  16
        18  28  10  -2   0   8  30  20`),
  ];
  const PST_EG = [null,
    T(`  0   0   0   0   0   0   0   0
        80  80  80  80  80  80  80  80
        50  50  50  50  50  50  50  50
        30  30  30  30  30  30  30  30
        18  18  18  18  18  18  18  18
         8   8   8   8   8   8   8   8
         0   0   0   0   0   0   0   0
         0   0   0   0   0   0   0   0`),
    T(`-50 -40 -30 -30 -30 -30 -40 -50
       -40 -20   0   0   0   0 -20 -40
       -30   0  10  15  15  10   0 -30
       -30   5  15  20  20  15   5 -30
       -30   0  15  20  20  15   0 -30
       -30   5  10  15  15  10   5 -30
       -40 -20   0   5   5   0 -20 -40
       -50 -40 -30 -30 -30 -30 -40 -50`),
    T(`-14 -10  -8  -6  -6  -8 -10 -14
       -10  -2   0   2   2   0  -2 -10
        -8   0   6   6   6   6   0  -8
        -6   2   6   8   8   6   2  -6
        -6   2   6   8   8   6   2  -6
        -8   0   6   6   6   6   0  -8
       -10  -2   0   2   2   0  -2 -10
       -14 -10  -8  -6  -6  -8 -10 -14`),
    T(` 10  10  10  10  10  10  10  10
        12  12  12  12  12  12  12  12
         4   4   4   4   4   4   4   4
         2   2   2   2   2   2   2   2
         0   0   0   0   0   0   0   0
        -2  -2  -2  -2  -2  -2  -2  -2
        -4  -4  -4  -4  -4  -4  -4  -4
        -6  -4  -2   0   0  -2  -4  -6`),
    T(`-20 -10 -10  -5  -5 -10 -10 -20
       -10   0   5   5   5   5   0 -10
       -10   5  10  10  10  10   5 -10
        -5   5  10  15  15  10   5  -5
        -5   5  10  15  15  10   5  -5
       -10   5  10  10  10  10   5 -10
       -10   0   5   5   5   5   0 -10
       -20 -10 -10  -5  -5 -10 -10 -20`),
    T(`-50 -36 -26 -20 -20 -26 -36 -50
       -30 -10   0   8   8   0 -10 -30
       -26   4  18  24  24  18   4 -26
       -24   8  24  32  32  24   8 -24
       -24   8  24  32  32  24   8 -24
       -26   4  18  24  24  18   4 -26
       -32 -14   0   4   4   0 -14 -32
       -50 -38 -28 -24 -24 -28 -38 -50`),
  ];
  // index into the tables: a8 = 0 .. h1 = 63 from White's view
  const idxW = (s) => (7 - rankOf(s)) * 8 + fileOf(s), idxB = (s) => rankOf(s) * 8 + fileOf(s);
  const PASSED_MG = [0, 4, 8, 14, 24, 40, 60, 0], PASSED_EG = [0, 10, 18, 32, 54, 86, 130, 0];
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  const pawnMin = [new Int8Array(8), new Int8Array(8)], pawnMax = [new Int8Array(8), new Int8Array(8)];
  function evaluate() {
    let mg = 0, eg = 0, phase = 0;
    const bishops = [0, 0];
    for (let c = 0; c < 2; c++) { pawnFiles[c].fill(0); pawnMin[c].fill(8); pawnMax[c].fill(-1); }
    for (let s = 0; s < 128; s++) {
      if (off(s)) { s += 7; continue; }
      const p = board[s];
      if (!p) continue;
      const t = p & 7, c = p >> 3, sign = c ? -1 : 1, i = c ? idxB(s) : idxW(s);
      mg += sign * (MG[t] + PST_MG[t][i]);
      eg += sign * (EG[t] + PST_EG[t][i]);
      phase += PHASE[t];
      if (t === B) bishops[c]++;
      if (t === P) {
        const f = fileOf(s), r = rankOf(s);
        pawnFiles[c][f]++;
        if (r < pawnMin[c][f]) pawnMin[c][f] = r;
        if (r > pawnMax[c][f]) pawnMax[c][f] = r;
      }
    }
    // pawn structure and rooks: a second pass over pawns and rooks
    for (let s = 0; s < 128; s++) {
      if (off(s)) { s += 7; continue; }
      const p = board[s], t = p & 7;
      if (t !== P && t !== R) continue;
      const c = p >> 3, o = 1 - c, sign = c ? -1 : 1, f = fileOf(s), r = rankOf(s);
      if (t === R) {
        if (!pawnFiles[c][f]) { const v = pawnFiles[o][f] ? W.rookHalf : W.rookOpen; mg += sign * v; eg += sign * (v >> 1); }
        continue;
      }
      if (pawnFiles[c][f] > 1) { mg -= sign * W.doubled; eg -= sign * W.doubled; }
      if ((f === 0 || !pawnFiles[c][f - 1]) && (f === 7 || !pawnFiles[c][f + 1])) { mg -= sign * W.isolated; eg -= sign * W.isolated; }
      // passed: no enemy pawn ahead on this or a neighbouring file
      let passed = true;
      for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1) && passed; ff++) {
        if (!pawnFiles[o][ff]) continue;
        if (c === 0 ? pawnMax[o][ff] > r : pawnMin[o][ff] < r) passed = false;
      }
      if (passed) { const adv = c === 0 ? r : 7 - r; mg += sign * PASSED_MG[adv]; eg += sign * PASSED_EG[adv]; }
    }
    if (bishops[0] >= 2) { mg += W.bishopPair; eg += W.bishopPair; }
    if (bishops[1] >= 2) { mg -= W.bishopPair; eg -= W.bishopPair; }
    if (phase > 24) phase = 24;
    let sc = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    sc = side === WHITE ? sc : -sc;
    return sc + W.tempo;
  }

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  let ply = 0;
  const toTT = (sc) => (sc >= MATE_BOUND ? sc + ply : sc <= -MATE_BOUND ? sc - ply : sc);
  const fromTT = (sc) => (sc >= MATE_BOUND ? sc - ply : sc <= -MATE_BOUND ? sc + ply : sc);

  // ---------- search ----------
  const MV = [], SC = [];
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(256)); SC.push(new Int32Array(256)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(16 * 128);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 2047) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function score(n, p, ttMove) {
    const ms = MV[p], sc = SC[p];
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      let v;
      if (m === ttMove) v = 1 << 30;
      else if (mFlags(m) & FLAG_CAP) {
        const victim = mFlags(m) & FLAG_EP ? P : board[mTo(m)] & 7, attacker = board[mFrom(m)] & 7;
        v = (1 << 28) + victim * 16 - attacker + (mPromo(m) === Q ? 1000 : 0);
      } else if (mPromo(m)) v = mPromo(m) === Q ? (1 << 28) + 50 : -1000;
      else if (m === KIL[p * 2]) v = 1 << 27;
      else if (m === KIL[p * 2 + 1]) v = (1 << 27) - 1;
      else v = HIST[board[mFrom(m)] * 128 + mTo(m)];
      sc[i] = v;
    }
  }
  function pick(n, p, i) {
    const ms = MV[p], sc = SC[p];
    let b = i;
    for (let j = i + 1; j < n; j++) if (sc[j] > sc[b]) b = j;
    if (b !== i) { let t = ms[i]; ms[i] = ms[b]; ms[b] = t; t = sc[i]; sc[i] = sc[b]; sc[b] = t; }
    return ms[i];
  }
  function hasPieces(c) { // something besides pawns and the king (null move is unsafe in pawn endings)
    for (let s = 0; s < 128; s++) { if (off(s)) { s += 7; continue; } const p = board[s]; if (p && (p & 8) === c && (p & 7) > P && (p & 7) < K) return true; }
    return false;
  }
  function qsearch(alpha, beta, p) {
    nodes++;
    if (timeUp()) return 0;
    const stand = evaluate();
    if (p >= MAXPLY) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const n = gen(MV[p], true);
    score(n, p, 0);
    let best = stand;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      // delta pruning: even winning this piece can't lift alpha
      if (!mPromo(m) && stand + MG[mFlags(m) & FLAG_EP ? P : board[mTo(m)] & 7] + 200 < alpha) continue;
      make(m);
      if (inCheck(side ^ 8)) { unmake(); continue; }
      ply++;
      const sc = -qsearch(-beta, -alpha, p + 1);
      ply--; unmake();
      if (stopped) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  }
  function search(depth, alpha, beta, p, pv, nullOk) {
    if (p > 0 && (half >= 100 || repeats() >= 1 || insufficient())) return 0; // a repeat inside the search counts as a draw
    const check = inCheck();
    if (check) depth++;
    if (depth <= 0) return qsearch(alpha, beta, p);
    nodes++;
    if (timeUp()) return 0;
    if (p >= MAXPLY) return evaluate();
    const idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pv && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    // null move: give the opponent a free move; if we're still above beta, this node is good enough
    if (!pv && !check && nullOk && depth >= 3 && hasPieces(side) && evaluate() >= beta) {
      makeNull(); ply++;
      const sc = -search(depth - 1 - (depth > 6 ? 3 : 2), -beta, -beta + 1, p + 1, false, false);
      ply--; unmakeNull();
      if (stopped) return 0;
      if (sc >= beta) return sc >= MATE_BOUND ? beta : sc;
    }
    const n = gen(MV[p], false);
    score(n, p, ttMove);
    const a0 = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      make(m);
      if (inCheck(side ^ 8)) { unmake(); continue; }
      legal++; ply++;
      const quiet = !(mFlags(m) & FLAG_CAP) && !mPromo(m);
      let sc;
      if (legal === 1) sc = -search(depth - 1, -beta, -alpha, p + 1, pv, true);
      else {
        let r = 0;
        if (depth >= 3 && legal > 3 && quiet && !check && m !== KIL[p * 2] && m !== KIL[p * 2 + 1]) r = legal > 10 ? 2 : 1;
        sc = -search(depth - 1 - r, -alpha - 1, -alpha, p + 1, false, true);
        if (sc > alpha && r) sc = -search(depth - 1, -alpha - 1, -alpha, p + 1, false, true);
        if (sc > alpha && sc < beta) sc = -search(depth - 1, -beta, -alpha, p + 1, true, true);
      }
      ply--; unmake();
      if (stopped) return 0;
      if (sc > best) { best = sc; bestMove = m; if (p === 0) rootBest = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (quiet) {
          if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
          HIST[board[mFrom(m)] * 128 + mTo(m)] += depth * depth;
        }
        break;
      }
    }
    if (!legal) return check ? -(MATE - p) : 0;
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes, soft}. Returns {move, score, depth, nodes, ms}; score from the side to move,
  // MATE − n = mates in n plies
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    const soft = cfg.time ? cfg.time * (cfg.soft || 0.5) : 0, maxDepth = Math.min(cfg.depth || 64, MAXPLY - 8);
    nodes = 0; stopped = false; ply = 0;
    KIL.fill(0);
    for (let i = 0; i < HIST.length; i++) HIST[i] >>= 3;
    if (cfg.clearTT) ttClear();
    const legal = legalMoves();
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!legal.length) { info.score = inCheck() ? -MATE : 0; return info; }
    if (legal.length === 1) { info.move = legal[0]; info.score = evaluate(); info.ms = Date.now() - t0; return info; }
    let best = legal[0];
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      const sc = search(d, -INF, INF, 0, true, false);
      if (stopped) { if (rootBest && d > 1 && legal.includes(rootBest)) best = rootBest; break; } // keep a better move found in the cut iteration
      if (rootBest) best = rootBest;
      info.depth = d; info.score = sc;
      if (Math.abs(sc) >= MATE_BOUND && d >= 2) break;
      if (soft && Date.now() - t0 >= soft) break;
      if (maxNodes && nodes >= maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page ----------
  function perft(d) {
    const list = new Int32Array(256), n = gen(list, false);
    let total = 0;
    for (let i = 0; i < n; i++) {
      make(list[i]);
      if (!inCheck(side ^ 8)) total += d <= 1 ? 1 : perft(d - 1);
      unmake();
    }
    return total;
  }
  // Standard algebraic notation of a legal move in the current position
  function san(m) {
    const from = mFrom(m), to = mTo(m), fl = mFlags(m), p = board[from] & 7;
    let s;
    if (fl & FLAG_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else {
      s = p === P ? '' : ' NBRQK'[p - 1];
      if (p !== P) { // disambiguation
        const others = legalMoves().filter((x) => x !== m && mTo(x) === to && (board[mFrom(x)] & 7) === p);
        if (others.length) {
          const sameFile = others.some((x) => fileOf(mFrom(x)) === fileOf(from)), sameRank = others.some((x) => rankOf(mFrom(x)) === rankOf(from));
          s += !sameFile ? 'abcdefgh'[fileOf(from)] : !sameRank ? rankOf(from) + 1 : sqName(from);
        }
      }
      if (fl & FLAG_CAP) s += (p === P ? 'abcdefgh'[fileOf(from)] : '') + 'x';
      s += sqName(to);
      if (mPromo(m)) s += '=' + ' NBRQ'[mPromo(m) - 1];
    }
    make(m);
    if (inCheck()) s += legalMoves().length ? '+' : '#';
    unmake();
    return s;
  }
  const uci = (m) => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? ' nbrq'[mPromo(m) - 1] : '');
  function play(m) { make(m); }
  function piecesOf(c) { // material count by type for the colour, for the page's remarks
    const n = [0, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 128; s++) { if (off(s)) { s += 7; continue; } const p = board[s]; if (p && (p & 8) === c) n[p & 7]++; }
    return n;
  }

  setFen(START_FEN);
  return {
    WHITE, BLACK, P, N, B, R, Q, K, MATE, MATE_BOUND, FLAG_CAP, FLAG_EP, FLAG_CASTLE, FLAG_DOUBLE, START_FEN,
    setFen, fen, setStart() { setFen(START_FEN); }, legalMoves, play, think, evaluate, perft, san, uci, status, inCheck, ttClear,
    mFrom, mTo, mPromo, mFlags, sqName, piecesOf,
    get side() { return side; }, get board() { return board; }, get kings() { return kingSq.slice(); },
  };
}
if (typeof module !== 'undefined') module.exports = { ChessEngine };

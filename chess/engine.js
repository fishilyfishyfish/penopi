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
  // kept up to date by addP/delP: pieces by code, material + piece-square sums from White's view (middlegame,
  // endgame), game phase, and a key of the pawns alone (for the pawn table)
  const count = new Int8Array(16);
  let mgS = 0, egS = 0, phaseS = 0, pk1 = 0, pk2 = 0;

  function rehash() {
    h1 = 0; h2 = 0; pk1 = 0; pk2 = 0; mgS = 0; egS = 0; phaseS = 0; count.fill(0);
    for (let s = 0; s < 128; s++) if (!off(s) && board[s]) { const p = board[s]; board[s] = 0; addP(p, s); }
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
  function addP(p, sq) {
    board[sq] = p; count[p]++;
    h1 ^= ZP1[p * 128 + sq]; h2 ^= ZP2[p * 128 + sq];
    const t = p & 7, i = p & 8 ? idxB(sq) : idxW(sq);
    if (p & 8) { mgS -= MG[t] + PST_MG[t][i]; egS -= EG[t] + PST_EG[t][i]; } else { mgS += MG[t] + PST_MG[t][i]; egS += EG[t] + PST_EG[t][i]; }
    phaseS += PHASE[t];
    if (t === P) { pk1 ^= ZP1[p * 128 + sq]; pk2 ^= ZP2[p * 128 + sq]; }
  }
  function delP(sq) {
    const p = board[sq];
    board[sq] = 0; count[p]--;
    h1 ^= ZP1[p * 128 + sq]; h2 ^= ZP2[p * 128 + sq];
    const t = p & 7, i = p & 8 ? idxB(sq) : idxW(sq);
    if (p & 8) { mgS += MG[t] + PST_MG[t][i]; egS += EG[t] + PST_EG[t][i]; } else { mgS -= MG[t] + PST_MG[t][i]; egS -= EG[t] + PST_EG[t][i]; }
    phaseS -= PHASE[t];
    if (t === P) { pk1 ^= ZP1[p * 128 + sq]; pk2 ^= ZP2[p * 128 + sq]; }
    return p;
  }
  function make(m) {
    const from = mFrom(m), to = mTo(m), fl = mFlags(m), pr = mPromo(m);
    const p = board[from];
    const capSq = fl & FLAG_EP ? (side === WHITE ? to - 16 : to + 16) : to;
    const cap = board[capSq];
    undo.push({ m, cap, castle, ep, half, h1, h2, pk1, pk2 });
    hk1[hn] = h1; hk2[hn] = h2; hn++;
    if (cap) delP(capSq);
    delP(from);
    addP(pr ? (side | pr) : p, to);
    if ((p & 7) === K) {
      kingSq[side >> 3] = to;
      if (fl & FLAG_CASTLE) {
        const [rf, rt] = to === from + 2 ? [from + 3, from + 1] : [from - 4, from - 1];
        addP(delP(rf), rt);
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
    const np = delP(to);
    const p = pr ? (side | P) : np;
    addP(p, from);
    if ((p & 7) === K) {
      kingSq[side >> 3] = from;
      if (fl & FLAG_CASTLE) {
        const [rf, rt] = to === from + 2 ? [from + 3, from + 1] : [from - 4, from - 1];
        addP(delP(rt), rf);
      }
    }
    if (u.cap) addP(u.cap, fl & FLAG_EP ? (side === WHITE ? to - 16 : to + 16) : to);
    castle = u.castle; ep = u.ep; half = u.half; h1 = u.h1; h2 = u.h2; pk1 = u.pk1; pk2 = u.pk2;
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
    if (count[WHITE | P] || count[BLACK | P] || count[WHITE | R] || count[BLACK | R] || count[WHITE | Q] || count[BLACK | Q]) return false;
    const wm = count[WHITE | N] + count[WHITE | B], bm = count[BLACK | N] + count[BLACK | B];
    if (wm + bm <= 1) return true;
    if (wm !== 1 || bm !== 1 || count[WHITE | B] !== 1 || count[BLACK | B] !== 1) return false;
    // one bishop each: dead only if both stand on the same colour of square
    let c = -1;
    for (let sq = 0; sq < 128; sq++) { if (off(sq)) { sq += 7; continue; } if ((board[sq] & 7) === B) { const k = (fileOf(sq) + rankOf(sq)) & 1; if (c < 0) c = k; else return c === k; } }
    return false;
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
  const PASSED_MG = [0, 5, 10, 16, 28, 48, 75, 0], PASSED_EG = [0, 12, 20, 36, 60, 95, 145, 0];
  // pawn structure depends on the pawns alone: kept in a table by pawn key
  // entry: [key1, key2, mg, eg, white file mask, black file mask, passed squares (array)]
  const PT_SIZE = 1 << 14, pawnTable = new Array(PT_SIZE);
  function pawnEntry() {
    const i = pk1 & (PT_SIZE - 1), e = pawnTable[i];
    if (e && e[0] === pk1 && e[1] === pk2) return e;
    const files = [new Int8Array(8), new Int8Array(8)], lo = [new Int8Array(8).fill(8), new Int8Array(8).fill(8)], hi = [new Int8Array(8).fill(-1), new Int8Array(8).fill(-1)];
    const pawns = [];
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) { sq += 7; continue; }
      const q = board[sq];
      if ((q & 7) !== P) continue;
      const c = q >> 3, f = fileOf(sq), r = rankOf(sq);
      files[c][f]++; if (r < lo[c][f]) lo[c][f] = r; if (r > hi[c][f]) hi[c][f] = r;
      pawns.push(sq);
    }
    let mg = 0, eg = 0;
    const passed = [];
    for (const sq of pawns) {
      const c = board[sq] >> 3, o = 1 - c, sign = c ? -1 : 1, f = fileOf(sq), r = rankOf(sq);
      if (files[c][f] > 1) { mg -= sign * W.doubled; eg -= sign * (W.doubled + 8); }
      if ((f === 0 || !files[c][f - 1]) && (f === 7 || !files[c][f + 1])) { mg -= sign * W.isolated; eg -= sign * (W.isolated + 4); }
      let free = true;
      for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1) && free; ff++) {
        if (!files[o][ff]) continue;
        if (c === 0 ? hi[o][ff] > r : lo[o][ff] < r) free = false;
      }
      if (free && !(files[c][f] > 1 && (c === 0 ? hi[c][f] > r : lo[c][f] < r))) { // the front pawn of a doubled pair only
        const adv = c === 0 ? r : 7 - r;
        mg += sign * PASSED_MG[adv]; eg += sign * PASSED_EG[adv];
        passed.push(sq);
      }
    }
    let wf = 0, bf = 0;
    for (let f = 0; f < 8; f++) { if (files[0][f]) wf |= 1 << f; if (files[1][f]) bf |= 1 << f; }
    const ent = [pk1, pk2, mg, eg, wf, bf, passed];
    pawnTable[i] = ent;
    return ent;
  }
  const dist = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
  // mobility: squares a piece reaches that aren't own pieces or covered by an enemy pawn, around a typical count
  const MOB_MG = [0, 0, 4, 5, 2, 1, 0], MOB_EG = [0, 0, 4, 5, 4, 2, 0], MOB_MID = [0, 0, 4, 6, 7, 13, 0];
  const ATT_W = [0, 0, 2, 2, 3, 5, 0];                         // king attack units by attacker
  const SAFETY = [];
  for (let u = 0; u < 64; u++) SAFETY.push(Math.min(500, Math.round(u * u * 2.2)));
  const zone = [new Int8Array(128), new Int8Array(128)];     // squares around each king (by king's colour index)
  const pawnHit = (sq, by) => by === WHITE // is sq covered by a pawn of colour `by`?
    ? (!off(sq - 15) && board[sq - 15] === (WHITE | P)) || (!off(sq - 17) && board[sq - 17] === (WHITE | P))
    : (!off(sq + 15) && board[sq + 15] === (BLACK | P)) || (!off(sq + 17) && board[sq + 17] === (BLACK | P));
  function evaluate() {
    let mg = mgS, eg = egS;
    const pe = pawnEntry();
    mg += pe[2]; eg += pe[3];
    // king zones
    for (let c = 0; c < 2; c++) {
      const z = zone[c], k = kingSq[c], fw = c ? -16 : 16;
      z.fill(0);
      for (const d of KING) if (!off(k + d)) z[k + d] = 1;
      z[k] = 1;
      for (const d of [fw - 1, fw, fw + 1]) { const t = k + fw + d; if (!off(t)) z[t] = 1; }
    }
    const units = [0, 0], attackers = [0, 0];
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) { sq += 7; continue; }
      const p = board[sq], t = p & 7;
      if (t < N || t > Q) continue;
      const c = p >> 3, us = p & 8, them = us ^ 8, sign = c ? -1 : 1, ez = zone[1 - c];
      let mob = 0, hits = 0;
      if (t === N) {
        for (const d of KNIGHT) {
          const to = sq + d;
          if (off(to)) continue;
          if (ez[to]) hits++;
          const q = board[to];
          if ((!q || (q & 8) === them) && !pawnHit(to, them)) mob++;
        }
      } else {
        const dirs = t === B ? DIAG : t === R ? ORTH : KING;
        for (const d of dirs) for (let to = sq + d; !off(to); to += d) {
          if (ez[to]) hits++;
          const q = board[to];
          if (q) { if ((q & 8) === them && !pawnHit(to, them)) mob++; break; }
          if (!pawnHit(to, them)) mob++;
        }
      }
      mg += sign * MOB_MG[t] * (mob - MOB_MID[t]);
      eg += sign * MOB_EG[t] * (mob - MOB_MID[t]);
      if (hits) { units[c] += ATT_W[t] * hits; attackers[c]++; }
      if (t === R) {
        const f = fileOf(sq), own = c ? pe[5] : pe[4], opp = c ? pe[4] : pe[5];
        if (!(own & (1 << f))) { const v = opp & (1 << f) ? W.rookHalf : W.rookOpen; mg += sign * v; eg += sign * (v >> 1); }
        if (rankOf(sq) === (c ? 1 : 6)) { mg += sign * 12; eg += sign * 24; } // rook on the seventh
      }
    }
    // king safety (middlegame): attack units on the zone, counted when two or more pieces join and a queen is there
    for (let c = 0; c < 2; c++) {
      const sign = c ? -1 : 1, enemy = 1 - c;
      if (attackers[enemy] >= 2 && count[(enemy ? BLACK : WHITE) | Q]) mg -= sign * SAFETY[Math.min(63, units[enemy])];
      // pawn shield in front of a king tucked away on the wing
      const k = kingSq[c], f = fileOf(k), r = rankOf(k);
      if ((c === 0 ? r <= 1 : r >= 6) && (f <= 2 || f >= 5)) {
        let shield = 0;
        const fw = c ? -16 : 16;
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
          const s1 = k - f + ff + fw, s2 = s1 + fw;
          if (board[s1] === ((c ? BLACK : WHITE) | P)) shield += 2; else if (!off(s2) && board[s2] === ((c ? BLACK : WHITE) | P)) shield += 1;
        }
        mg += sign * (shield * 8 - 18);
      }
    }
    // passed pawns: free path and king distances in the endgame
    for (const sq of pe[6]) {
      const q = board[sq], c = q >> 3, sign = c ? -1 : 1, adv = c ? 7 - rankOf(sq) : rankOf(sq);
      const fw = c ? -16 : 16, promo = c ? fileOf(sq) : 0x70 + fileOf(sq);
      if (!board[sq + fw]) eg += sign * (adv * 4);
      const w = adv * adv;
      eg += sign * Math.round((dist(kingSq[1 - c], promo) * 5 - dist(kingSq[c], promo) * 2) * w / 8);
    }
    if (count[WHITE | B] >= 2) { mg += W.bishopPair; eg += W.bishopPair + 10; }
    if (count[BLACK | B] >= 2) { mg -= W.bishopPair; eg -= W.bishopPair + 10; }
    const phase = phaseS > 24 ? 24 : phaseS;
    let sc = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    // drawish material: no pawns and a minor piece up at most
    if (!count[WHITE | P] && sc > 0 && count[WHITE | N] + count[WHITE | B] <= 1 && !count[WHITE | R] && !count[WHITE | Q]) sc >>= 3;
    if (!count[BLACK | P] && sc < 0 && count[BLACK | N] + count[BLACK | B] <= 1 && !count[BLACK | R] && !count[BLACK | Q]) sc >>= 3;
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

  // ---------- static exchange evaluation ----------
  // What a capture on `to` wins if both sides keep recapturing with their least valuable piece (pieces behind
  // the first attacker on a line join in as the board is cleared).
  const SEE_V = [0, 100, 320, 330, 500, 950, 20000];
  function lva(sq, by) { // square of the least valuable piece of colour `by` attacking sq, or -1
    const pd = by === WHITE ? [-15, -17] : [15, 17];
    for (const d of pd) { const t = sq + d; if (!off(t) && board[t] === (by | P)) return t; }
    for (const d of KNIGHT) { const t = sq + d; if (!off(t) && board[t] === (by | N)) return t; }
    let rook = -1, queen = -1;
    for (const d of DIAG) for (let t = sq + d; !off(t); t += d) { const q = board[t]; if (q) { if (q === (by | B)) return t; if (q === (by | Q) && queen < 0) queen = t; break; } }
    for (const d of ORTH) for (let t = sq + d; !off(t); t += d) { const q = board[t]; if (q) { if (q === (by | R) && rook < 0) rook = t; if (q === (by | Q) && queen < 0) queen = t; break; } }
    if (rook >= 0) return rook;
    if (queen >= 0) return queen;
    for (const d of KING) { const t = sq + d; if (!off(t) && board[t] === (by | K)) return t; }
    return -1;
  }
  const seeGain = new Int32Array(40), seeSq = new Int16Array(40), seeP = new Int8Array(40);
  function see(m) {
    const from = mFrom(m), to = mTo(m), fl = mFlags(m);
    let victim = fl & FLAG_EP ? P : board[to] & 7;
    let n = 0;
    seeGain[0] = SEE_V[victim] + (mPromo(m) ? SEE_V[mPromo(m)] - 100 : 0);
    let attacker = mPromo(m) || board[from] & 7;
    seeSq[n] = from; seeP[n] = board[from]; n++; board[from] = 0;
    let epSq = -1, epP = 0;
    if (fl & FLAG_EP) { epSq = side === WHITE ? to - 16 : to + 16; epP = board[epSq]; board[epSq] = 0; }
    let by = side ^ 8, d = 0;
    for (;;) {
      const a = lva(to, by);
      if (a < 0) break;
      d++;
      seeGain[d] = SEE_V[attacker] - seeGain[d - 1];
      if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break; // can't come out ahead by going on
      attacker = board[a] & 7;
      seeSq[n] = a; seeP[n] = board[a]; n++; board[a] = 0;
      by ^= 8;
    }
    while (n) { n--; board[seeSq[n]] = seeP[n]; }
    if (epSq >= 0) board[epSq] = epP;
    while (d > 0) { seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]); d--; }
    return seeGain[0];
  }

  // ---------- search ----------
  const MV = [], SC = [], QT = [];
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(256)); SC.push(new Int32Array(256)); QT.push(new Int32Array(256)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(16 * 128);
  const LMR = [];
  for (let d = 0; d < 64; d++) { LMR.push(new Int8Array(64)); for (let i = 1; i < 64; i++) LMR[d][i] = d && i ? Math.floor(0.6 + Math.log(d) * Math.log(i) / 2.2) : 0; }
  const RFP_MARGIN = 85, FUT_MARGIN = [0, 110, 210, 310], LMP = [0, 5, 8, 13, 20];
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
        const mvv = victim * 16 - attacker + (mPromo(m) === Q ? 1000 : 0);
        v = (victim >= attacker || mPromo(m) || see(m) >= 0) ? (1 << 28) + mvv : -(1 << 20) + mvv; // losing captures after the quiet moves
      } else if (mPromo(m)) v = mPromo(m) === Q ? (1 << 28) + 50 : -(1 << 21);
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
    return count[c | N] + count[c | B] + count[c | R] + count[c | Q] > 0;
  }
  const histAdd = (i, bonus) => { HIST[i] += bonus - Math.trunc(HIST[i] * Math.abs(bonus) / 16384); };
  function qsearch(alpha, beta, p, qd) {
    nodes++;
    if (timeUp()) return 0;
    if (p >= MAXPLY) return evaluate();
    const check = qd < 4 && inCheck(); // evasions near the leaves: so mates at the horizon are seen
    let best = -INF, n;
    if (check) n = gen(MV[p], false);
    else {
      const stand = evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
      n = gen(MV[p], true);
    }
    score(n, p, 0);
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      if (!check) {
        if (!mPromo(m) && best + SEE_V[mFlags(m) & FLAG_EP ? P : board[mTo(m)] & 7] + 200 < alpha) continue; // delta pruning
        if (SC[p][i] < 0) continue; // a losing capture
      }
      make(m);
      if (inCheck(side ^ 8)) { unmake(); continue; }
      legal++; ply++;
      const sc = -qsearch(-beta, -alpha, p + 1, qd + 1);
      ply--; unmake();
      if (stopped) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    if (check && !legal) return -(MATE - p);
    return best;
  }
  function search(depth, alpha, beta, p, pv, nullOk) {
    if (p > 0) {
      if (half >= 100 || repeats() >= 1 || insufficient()) return 0; // a repeat inside the search counts as a draw
      // mate distance pruning
      if (alpha < -(MATE - p)) alpha = -(MATE - p);
      if (beta > MATE - p - 1) beta = MATE - p - 1;
      if (alpha >= beta) return alpha;
    }
    const check = inCheck();
    if (check) depth++;
    if (depth <= 0) return qsearch(alpha, beta, p, 0);
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
    const ev = check ? -INF : evaluate();
    // reverse futility: far above beta with little depth left, the opponent won't let this happen anyway
    if (!pv && !check && depth <= 6 && Math.abs(beta) < MATE_BOUND && ev - RFP_MARGIN * depth >= beta) return ev;
    // null move: give the opponent a free move; if we're still above beta, this node is good enough
    if (!pv && !check && nullOk && depth >= 3 && hasPieces(side) && ev >= beta) {
      makeNull(); ply++;
      const sc = -search(depth - 1 - (3 + (depth >> 2)), -beta, -beta + 1, p + 1, false, false);
      ply--; unmakeNull();
      if (stopped) return 0;
      if (sc >= beta) return sc >= MATE_BOUND ? beta : sc;
    }
    // no table move at a deep PV node: a shallower search finds one to try first
    if (pv && !ttMove && depth >= 6) {
      search(depth - 3, alpha, beta, p, true, false);
      if (stopped) return 0;
      if (tFlag[idx] && tKey[idx] === h2) ttMove = tMove[idx];
    }
    const n = gen(MV[p], false);
    score(n, p, ttMove);
    const futile = !pv && !check && depth <= 3 && ev + FUT_MARGIN[depth] <= alpha;
    const a0 = alpha, qt = QT[p];
    let best = -INF, bestMove = 0, legal = 0, quiets = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      const quiet = !(mFlags(m) & FLAG_CAP) && !mPromo(m);
      make(m);
      if (inCheck(side ^ 8)) { unmake(); continue; }
      legal++;
      const gives = inCheck();
      if (quiet && !gives && legal > 1 && best > -MATE_BOUND) {
        // futility and late move pruning: quiet moves that can't plausibly lift alpha at the frontier
        if (futile || (!pv && !check && depth <= 4 && quiets >= LMP[depth])) { unmake(); quiets++; continue; }
      }
      if (quiet) qt[quiets++] = m;
      ply++;
      let sc;
      if (legal === 1) sc = -search(depth - 1, -beta, -alpha, p + 1, pv, true);
      else {
        let r = 0;
        if (depth >= 3 && quiet && !gives && !check && m !== KIL[p * 2] && m !== KIL[p * 2 + 1]) {
          r = LMR[Math.min(depth, 63)][Math.min(legal, 63)];
          if (pv) r--;
          if (HIST[board[mTo(m)] * 128 + mTo(m)] > 4000) r--;
          if (r < 0) r = 0;
          if (r > depth - 2) r = depth - 2;
        }
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
          const bonus = Math.min(depth * depth * 16, 1600);
          histAdd(board[mFrom(m)] * 128 + mTo(m), bonus);
          for (let j = 0; j < quiets - 1; j++) { const x = qt[j]; histAdd(board[mFrom(x)] * 128 + mTo(x), -bonus); }
        }
        break;
      }
    }
    if (!legal) return check ? -(MATE - p) : 0;
    if (best === -INF) best = alpha; // every move was pruned
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
    for (let i = 0; i < HIST.length; i++) HIST[i] >>= 2;
    if (cfg.clearTT) ttClear();
    const legal = legalMoves();
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!legal.length) { info.score = inCheck() ? -MATE : 0; return info; }
    if (legal.length === 1) { info.move = legal[0]; info.score = evaluate(); info.ms = Date.now() - t0; return info; }
    let best = legal[0], prev = 0;
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      let sc, delta = 30, lo = -INF, hi = INF;
      if (d >= 5 && Math.abs(prev) < MATE_BOUND) { lo = prev - delta; hi = prev + delta; } // aspiration window
      for (;;) {
        sc = search(d, lo, hi, 0, true, false);
        if (stopped) break;
        if (sc <= lo) { lo = Math.max(-INF, lo - delta); delta *= 2; if (delta > 500) lo = -INF; continue; }
        if (sc >= hi) { hi = Math.min(INF, hi + delta); delta *= 2; if (delta > 500) hi = INF; if (rootBest) best = rootBest; continue; }
        break;
      }
      if (stopped) { if (rootBest && d > 1 && legal.includes(rootBest)) best = rootBest; break; } // a better move found in the cut iteration
      if (rootBest) best = rootBest;
      prev = sc;
      info.depth = d; info.score = sc;
      if (Math.abs(sc) >= MATE_BOUND && d >= 2 && MATE - Math.abs(sc) < d) break;
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

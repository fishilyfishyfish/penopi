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
  // undo stack (one entry per make / makeNull)
  const U_SIZE = 2048;
  const uM = new Int32Array(U_SIZE), uCap = new Int8Array(U_SIZE), uCastle = new Int8Array(U_SIZE), uEp = new Int16Array(U_SIZE), uHalf = new Int16Array(U_SIZE);
  const uH1 = new Int32Array(U_SIZE), uH2 = new Int32Array(U_SIZE), uPk1 = new Int32Array(U_SIZE), uPk2 = new Int32Array(U_SIZE);
  let un = 0;
  // piece lists: squares of each colour's pieces (pawns and king included), kept by addP/delP
  const plist = [new Int16Array(16), new Int16Array(16)], pcnt = [0, 0], pidx = new Int8Array(128);
  // kept up to date by addP/delP: pieces by code, material + piece-square sums from White's view (middlegame,
  // endgame), game phase, and a key of the pawns alone (for the pawn table)
  const count = new Int8Array(16);
  let mgS = 0, egS = 0, phaseS = 0, pk1 = 0, pk2 = 0;

  function rehash() {
    h1 = 0; h2 = 0; pk1 = 0; pk2 = 0; mgS = 0; egS = 0; phaseS = 0; count.fill(0); pcnt[0] = pcnt[1] = 0;
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
    hn = 0; un = 0;
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
  // LINE[d + 119]: the 0x88 difference d lies on a queen line (a piece there and the king could be on one ray)
  const LINE = new Int8Array(239);
  for (const d of [17, 15, -17, -15, 16, -16, 1, -1]) for (let k = 1; k < 8; k++) LINE[d * k + 119] = 1;
  // after make(m): did the move leave the mover's king attacked? kq = the mover's king square before the move,
  // chk = the mover was in check. Only king moves, en passant, moves out of check and moves from a square on a
  // line with the king can; everything else skips the attack test.
  // KN_D[d + 119]: a knight jump
  const KN_D = new Int8Array(239);
  for (const d of KNIGHT) KN_D[d + 119] = 1;
  // after make(m): could the move check the side now to move? (a cheap filter before the attack test)
  function givesCheck(m) {
    const ek = kingSq[side >> 3], to = mTo(m), from = mFrom(m);
    if (mFlags(m) & (FLAG_EP | FLAG_CASTLE) || mPromo(m)) return inCheck();
    if (LINE[from - ek + 119] || LINE[to - ek + 119] || KN_D[to - ek + 119]) return inCheck();
    return false;
  }
  const leftInCheck = (m, kq, chk) => (chk || mFrom(m) === kq || (mFlags(m) & FLAG_EP) || LINE[mFrom(m) - kq + 119]) && inCheck(side ^ 8);

  // ---------- move generation (pseudo-legal) ----------
  function gen(list, capturesOnly) {
    let n = 0;
    const us = side, them = side ^ 8;
    const pl = plist[us >> 3], pn = pcnt[us >> 3];
    for (let k = 0; k < pn; k++) {
      const s = pl[k], p = board[s];
      const t = p & 7;
      if (t === P) {
        const fwd = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
        const one = s + fwd;
        if (!off(one) && !board[one]) {
          if (rankOf(one) === lastRank) { for (let pr = Q; pr >= N; pr--) list[n++] = s | (one << 7) | (pr << 14); }
          else if (!capturesOnly) {
            list[n++] = s | (one << 7);
            const two = one + fwd;
            if (rankOf(s) === startRank && !board[two]) list[n++] = s | (two << 7) | ((FLAG_DOUBLE) << 17);
          }
        }
        for (let dd = -1; dd <= 1; dd += 2) {
          const c = s + fwd + dd;
          if (off(c)) continue;
          if (board[c] && (board[c] & 8) === them) {
            if (rankOf(c) === lastRank) { for (let pr = Q; pr >= N; pr--) list[n++] = s | (c << 7) | (pr << 14) | (FLAG_CAP << 17); }
            else list[n++] = s | (c << 7) | ((FLAG_CAP) << 17);
          } else if (c === ep) list[n++] = s | (c << 7) | ((FLAG_CAP | FLAG_EP) << 17);
        }
        continue;
      }
      if (t === N || t === K) {
        for (const d of t === N ? KNIGHT : KING) {
          const to = s + d;
          if (off(to)) continue;
          const q = board[to];
          if (!q) { if (!capturesOnly) list[n++] = s | (to << 7); }
          else if ((q & 8) === them) list[n++] = s | (to << 7) | ((FLAG_CAP) << 17);
        }
        if (t === K && !capturesOnly) {
          if (us === WHITE && s === 0x04) {
            if ((castle & 1) && !board[0x05] && !board[0x06] && !attacked(0x04, them) && !attacked(0x05, them) && !attacked(0x06, them)) list[n++] = s | (0x06 << 7) | ((FLAG_CASTLE) << 17);
            if ((castle & 2) && !board[0x03] && !board[0x02] && !board[0x01] && !attacked(0x04, them) && !attacked(0x03, them) && !attacked(0x02, them)) list[n++] = s | (0x02 << 7) | ((FLAG_CASTLE) << 17);
          } else if (us === BLACK && s === 0x74) {
            if ((castle & 4) && !board[0x75] && !board[0x76] && !attacked(0x74, them) && !attacked(0x75, them) && !attacked(0x76, them)) list[n++] = s | (0x76 << 7) | ((FLAG_CASTLE) << 17);
            if ((castle & 8) && !board[0x73] && !board[0x72] && !board[0x71] && !attacked(0x74, them) && !attacked(0x73, them) && !attacked(0x72, them)) list[n++] = s | (0x72 << 7) | ((FLAG_CASTLE) << 17);
          }
        }
        continue;
      }
      const dirs = t === B ? DIAG : t === R ? ORTH : KING;
      for (const d of dirs) {
        for (let to = s + d; !off(to); to += d) {
          const q = board[to];
          if (!q) { if (!capturesOnly) list[n++] = s | (to << 7); continue; }
          if ((q & 8) === them) list[n++] = s | (to << 7) | ((FLAG_CAP) << 17);
          break;
        }
      }
    }
    return n;
  }

  // ---------- make / unmake ----------
  function addP(p, sq) {
    board[sq] = p; count[p]++;
    { const c = p >> 3; pidx[sq] = pcnt[c]; plist[c][pcnt[c]++] = sq; }
    h1 ^= ZP1[p * 128 + sq]; h2 ^= ZP2[p * 128 + sq];
    const t = p & 7, i = p & 8 ? idxB(sq) : idxW(sq);
    if (p & 8) { mgS -= MG[t] + PST_MG[t][i]; egS -= EG[t] + PST_EG[t][i]; } else { mgS += MG[t] + PST_MG[t][i]; egS += EG[t] + PST_EG[t][i]; }
    phaseS += PHASE[t];
    if (t === P) { pk1 ^= ZP1[p * 128 + sq]; pk2 ^= ZP2[p * 128 + sq]; }
  }
  function delP(sq) {
    const p = board[sq];
    board[sq] = 0; count[p]--;
    { const c = p >> 3, i = pidx[sq], last = plist[c][--pcnt[c]]; plist[c][i] = last; pidx[last] = i; }
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
    uM[un] = m; uCap[un] = cap; uCastle[un] = castle; uEp[un] = ep; uHalf[un] = half; uH1[un] = h1; uH2[un] = h2; uPk1[un] = pk1; uPk2[un] = pk2; un++;
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
    const u = --un;
    const m = uM[u], from = mFrom(m), to = mTo(m), fl = mFlags(m), pr = mPromo(m);
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
    if (uCap[u]) addP(uCap[u], fl & FLAG_EP ? (side === WHITE ? to - 16 : to + 16) : to);
    castle = uCastle[u]; ep = uEp[u]; half = uHalf[u]; h1 = uH1[u]; h2 = uH2[u]; pk1 = uPk1[u]; pk2 = uPk2[u];
    hn--;
  }
  function makeNull() {
    uM[un] = 0; uCap[un] = 0; uCastle[un] = castle; uEp[un] = ep; uHalf[un] = half; uH1[un] = h1; uH2[un] = h2; un++;
    hk1[hn] = h1; hk2[hn] = h2; hn++;
    if (ep >= 0) { h1 ^= ZE1[ep]; h2 ^= ZE2[ep]; ep = -1; }
    half++; side ^= 8; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmakeNull() {
    const u = --un;
    side ^= 8; ep = uEp[u]; half = uHalf[u]; h1 = uH1[u]; h2 = uH2[u]; castle = uCastle[u];
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
  // feature switches (1 on, 0 off) are here too so self-play can measure each: mob, ks (king safety), pp (passed pawn extras),
  // rfp, fut, lmp, iid, asp, qcheck
  const W = Object.assign({ mob: 1, ks: 1, pp: 1, rfp: 1, fut: 1, lmp: 1, iid: 1, asp: 1, qcheck: 1, shield: 1, cm: 1, hp: 0, raz: 1 }, opts.weights || {});
  const PHASE = [0, 0, 1, 1, 2, 4, 0];
  const T = (rows) => rows.trim().split(/\s+/).map(Number);
  const PST_MG0 = [null,
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
  const PST_EG0 = [null,
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
  // tuned values of PV (written by tools/chess-tune.mjs; null = the hand-written starting values)
  const TUNED = [0,74,336,350,494,960,0,0,96,304,334,543,963,0,0,0,0,0,0,0,0,0,41,44,44,50,50,44,45,41,11,12,20,28,31,17,12,11,0,0,7,20,24,10,0,2,4,-8,2,19,19,3,-10,-4,4,-6,-1,11,9,-10,5,2,5,6,-6,-4,-7,17,10,-13,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,82,79,78,80,81,77,78,80,52,50,50,51,51,44,48,49,32,23,21,28,22,24,22,21,22,16,11,6,13,18,13,15,7,13,8,8,13,17,1,10,5,5,6,5,1,13,10,4,0,0,0,0,0,0,0,0,-51,-38,-28,-26,-26,-28,-38,-50,-39,-18,1,2,2,0,-18,-38,-28,3,12,17,16,12,3,-27,-25,2,18,29,25,17,5,-26,-24,1,20,17,21,19,1,-23,-26,6,0,14,11,8,11,-28,-37,-17,0,12,0,-3,-19,-38,-50,-25,-29,-25,-26,-28,-29,-50,-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-29,0,10,16,14,11,0,-29,-29,7,17,23,22,16,7,-29,-30,0,13,20,21,15,1,-29,-30,3,9,13,13,5,7,-28,-40,-20,-1,5,3,-2,-20,-40,-50,-41,-31,-30,-31,-29,-38,-50,-20,-10,-10,-10,-10,-10,-10,-20,-11,-1,0,0,-1,0,-1,-11,-11,-1,8,9,10,7,0,-10,-11,1,5,15,12,7,2,-10,-11,3,10,12,12,6,1,-9,-10,12,7,3,9,9,13,-8,-10,9,3,-4,2,1,21,-10,-20,-10,-7,-10,-13,-11,-10,-19,-14,-10,-7,-6,-6,-7,-10,-14,-10,-1,1,2,2,0,-2,-11,-7,0,8,3,7,9,0,-8,-6,2,5,9,6,7,1,-5,-4,3,9,7,6,8,3,-6,-8,0,5,7,8,7,-1,-7,-9,-1,1,1,0,1,-2,-10,-13,-9,-6,-7,-8,-9,-10,-14,0,0,0,3,2,0,0,0,7,11,11,13,13,13,11,8,-4,1,1,2,1,1,1,-4,-5,0,1,1,2,0,1,-4,-6,-2,0,0,0,2,0,-4,-5,-2,-2,1,2,-2,3,-5,-6,-1,0,1,0,-1,-3,-7,-6,2,3,9,10,12,-7,-7,12,11,10,12,10,11,11,12,13,10,11,13,12,11,9,10,5,5,4,6,6,4,4,4,4,2,4,3,3,4,2,3,0,-1,-1,-2,0,1,1,1,-3,-3,-3,-3,-1,-5,0,-3,-5,-5,-5,-4,-3,-5,-6,-5,-5,-9,-3,3,0,0,-6,-8,-20,-11,-10,-4,-3,-10,-10,-20,-10,-1,1,0,1,1,0,-11,-10,0,5,5,5,4,1,-9,-5,-3,4,4,3,5,2,-5,-6,-2,5,2,4,3,2,-7,-9,1,7,4,7,4,1,-11,-11,-2,4,5,5,1,-1,-10,-19,-9,-12,3,-6,-10,-10,-20,-20,-10,-10,-5,-4,-10,-10,-20,-10,0,6,6,6,6,0,-10,-10,5,10,11,10,10,5,-10,-5,5,10,16,16,11,6,-5,-6,5,11,16,15,10,6,-5,-10,5,11,11,10,10,5,-10,-11,-1,5,6,5,4,-1,-10,-20,-10,-10,-4,-6,-10,-10,-20,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-51,-51,-40,-39,-30,-20,-30,-31,-41,-40,-31,-30,-20,-10,-20,-20,-24,-23,-20,-20,-10,16,16,-4,-11,-13,-6,18,16,17,27,15,-6,14,0,35,20,-50,-36,-26,-20,-20,-26,-36,-50,-30,-9,1,8,8,1,-9,-30,-26,6,19,23,23,19,7,-25,-23,10,23,25,29,24,11,-23,-23,8,20,27,31,21,10,-23,-25,3,16,18,17,17,4,-24,-30,-12,2,5,1,1,-14,-32,-50,-37,-20,-25,-25,-30,-31,-52,3,4,9,15,0,1,6,12,29,47,74,0,0,14,22,39,58,90,140,0,-17,-12,-3,0,4,5,9,16,14,-16,-14,-7,1,3,6,15,11,5,-26,-24,-12,-10,-5,-2,1,1,11,13,22,23,29,33,-33,-25,-19,-12,-3,0,8,10,11,17,21,21,28,29,-23,-19,-13,-7,-5,2,1,-2,4,8,7,8,10,11,12,-32,-28,-25,-19,-8,-7,0,4,7,16,13,19,21,22,19,-12,-7,-11,-11,-8,-8,-5,-7,-4,-4,-3,-2,-2,0,-1,2,3,4,5,8,8,8,9,10,11,12,13,14,-26,-24,-22,-20,-18,-17,-15,-11,-10,-8,-5,-3,-1,1,3,5,7,10,11,14,15,17,18,20,22,24,26,28,28,6,16,9,11,17,0,0,1,2,7,7,6,12,17,18,25,30,33,44,48,56,65,74,81,88,100,108,120,132,144,150,150,149,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,150,11,-18,0,6,7,17,23,21,28,28,0,1,2,12,20,32,29,31,0,0,-3,-9,-14,-21,-23,-12,38,50,0]; // tuned-params
  // ---------- evaluation parameters ----------
  // Every number the evaluation uses lives in one Int32Array PV (tools/chess-tune.mjs tunes it from self-play);
  // the tables the evaluation reads are views into it. The starting values are the hand-written ones above.
  // PDEF: [name, offset, length, endgame term?]
  const PDEF = [], PINIT = [];
  let PN = 0;
  function prm(name, init, eg) { const o = PN; PDEF.push([name, o, init.length, eg ? 1 : 0]); for (const v of init) PINIT.push(v); PN += init.length; return o; }
  const lin = (n, f) => Array.from({ length: n }, (_, k) => f(k));
  const MOB_MID = [0, 0, 4, 6, 7, 13, 0], MOBN = [0, 0, 9, 14, 15, 28, 0], MOB_MG0 = [0, 0, 4, 5, 2, 1, 0], MOB_EG0 = [0, 0, 4, 5, 4, 2, 0];
  const O = { matMg: prm('material mg', [0, 100, 320, 330, 500, 950, 0]), matEg: prm('material eg', [0, 120, 300, 315, 540, 950, 0], 1), pstMg: [0], pstEg: [0], mobMg: [0, 0], mobEg: [0, 0] };
  for (let t = 1; t <= 6; t++) { O.pstMg.push(prm('pst mg ' + t, PST_MG0[t])); O.pstEg.push(prm('pst eg ' + t, PST_EG0[t], 1)); }
  O.doubledMg = prm('doubled mg', [12]); O.doubledEg = prm('doubled eg', [20], 1);
  O.isoMg = prm('isolated mg', [12]); O.isoEg = prm('isolated eg', [16], 1);
  O.passMg = prm('passed mg', [0, 5, 10, 16, 28, 48, 75, 0]); O.passEg = prm('passed eg', [0, 12, 20, 36, 60, 95, 145, 0], 1);
  for (let t = N; t <= Q; t++) {
    O.mobMg.push(prm('mobility mg ' + t, lin(MOBN[t], (k) => MOB_MG0[t] * (k - MOB_MID[t]))));
    O.mobEg.push(prm('mobility eg ' + t, lin(MOBN[t], (k) => MOB_EG0[t] * (k - MOB_MID[t])), 1));
  }
  O.rookOpenMg = prm('rook open file mg', [18]); O.rookOpenEg = prm('rook open file eg', [9], 1);
  O.rookHalfMg = prm('rook half-open file mg', [9]); O.rookHalfEg = prm('rook half-open file eg', [4], 1);
  O.rook7Mg = prm('rook on the 7th mg', [12]); O.rook7Eg = prm('rook on the 7th eg', [24], 1);
  O.safety = prm('king attack by units', lin(64, (u) => Math.min(150, Math.round(u * u * 0.25))));
  O.shieldUnit = prm('pawn shield unit', [8]); O.shieldBase = prm('pawn shield base', [-18]);
  O.pFree = prm('passed pawn free path eg', lin(8, (a) => a * 4), 1);
  O.pKingEnemy = prm('passed pawn enemy king distance eg', lin(8, (a) => Math.round(5 * a * a / 8)), 1);
  O.pKingOwn = prm('passed pawn own king distance eg', lin(8, (a) => Math.round(-2 * a * a / 8)), 1);
  O.bpairMg = prm('bishop pair mg', [30]); O.bpairEg = prm('bishop pair eg', [40], 1);
  O.tempo = prm('tempo', [10]);
  // opening terms (added after the first tuning: new parameters go at the end so TUNED stays valid)
  O.undev = prm('minor piece still at home mg', [0]);
  O.earlyQueen = prm('queen out with two minors at home mg', [0]);
  O.kingCenter = prm('king on d/e file without castling rights mg', [0]);
  O.castleRight = prm('castling right kept mg', [0]);
  const PV = Int32Array.from(PINIT);
  if (TUNED) PV.set(TUNED.slice(0, PN));
  if (opts.params) PV.set(opts.params);
  const view = (o, n) => PV.subarray(o, o + n);
  const MG = view(O.matMg, 7), EG = view(O.matEg, 7), PST_MG = [null], PST_EG = [null], MOBT_MG = [null, null], MOBT_EG = [null, null];
  for (let t = 1; t <= 6; t++) { PST_MG.push(view(O.pstMg[t], 64)); PST_EG.push(view(O.pstEg[t], 64)); }
  for (let t = N; t <= Q; t++) { MOBT_MG.push(view(O.mobMg[t], MOBN[t])); MOBT_EG.push(view(O.mobEg[t], MOBN[t])); }
  const PASSED_MG = view(O.passMg, 8), PASSED_EG = view(O.passEg, 8), SAFETY = view(O.safety, 64);
  const PFREE = view(O.pFree, 8), PKE = view(O.pKingEnemy, 8), PKO = view(O.pKingOwn, 8);
  // tracing (features()): the coefficient of each parameter in the evaluation, White's view, before tapering
  let TR = null, trPhase = 24, trScale = 1;

  // index into the tables: a8 = 0 .. h1 = 63 from White's view
  const idxW = (s) => (7 - rankOf(s)) * 8 + fileOf(s), idxB = (s) => rankOf(s) * 8 + fileOf(s);
  // pawn structure depends on the pawns alone: kept in a table by pawn key
  // entry: [key1, key2, mg, eg, white file mask, black file mask, passed squares (array)]
  const PT_SIZE = 1 << 14, pawnTable = new Array(PT_SIZE);
  function pawnEntry() {
    const i = pk1 & (PT_SIZE - 1), e = pawnTable[i];
    if (!TR && e && e[0] === pk1 && e[1] === pk2) return e;
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
      if (files[c][f] > 1) { mg -= sign * PV[O.doubledMg]; eg -= sign * PV[O.doubledEg]; if (TR) { TR[O.doubledMg] -= sign; TR[O.doubledEg] -= sign; } }
      if ((f === 0 || !files[c][f - 1]) && (f === 7 || !files[c][f + 1])) { mg -= sign * PV[O.isoMg]; eg -= sign * PV[O.isoEg]; if (TR) { TR[O.isoMg] -= sign; TR[O.isoEg] -= sign; } }
      let free = true;
      for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1) && free; ff++) {
        if (!files[o][ff]) continue;
        if (c === 0 ? hi[o][ff] > r : lo[o][ff] < r) free = false;
      }
      if (free && !(files[c][f] > 1 && (c === 0 ? hi[c][f] > r : lo[c][f] < r))) { // the front pawn of a doubled pair only
        const adv = c === 0 ? r : 7 - r;
        mg += sign * PASSED_MG[adv]; eg += sign * PASSED_EG[adv];
        if (TR) { TR[O.passMg + adv] += sign; TR[O.passEg + adv] += sign; }
        passed.push(sq);
      }
    }
    let wf = 0, bf = 0;
    for (let f = 0; f < 8; f++) { if (files[0][f]) wf |= 1 << f; if (files[1][f]) bf |= 1 << f; }
    const ent = [pk1, pk2, mg, eg, wf, bf, passed];
    if (!TR) pawnTable[i] = ent;
    return ent;
  }
  const dist = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
  // mobility: squares a piece reaches that aren't own pieces or covered by an enemy pawn (a table by count)
  const ATT_W = [0, 0, 2, 2, 3, 5, 0];                         // king attack units by attacker
  // penalty by attack units (SAFETY): started as the square of the attack, capped
  // squares around each king (the king's square, its neighbours and three more in front), by colour and square
  const ZONE = [[], []];
  for (let c = 0; c < 2; c++) for (let k = 0; k < 128; k++) {
    const z = [];
    if (!off(k)) {
      const fw = c ? -16 : 16;
      z.push(k);
      for (const d of KING) if (!off(k + d)) z.push(k + d);
      for (const d of [fw - 1, fw, fw + 1]) { const t = k + fw + d; if (!off(t)) z.push(t); }
    }
    ZONE[c].push(Int16Array.from(z));
  }
  const zone = [new Int8Array(128), new Int8Array(128)];     // marked king zones during evaluate (by colour index)
  const pawnAtt = [new Int8Array(128), new Int8Array(128)];  // squares covered by each colour's pawns during evaluate
  const units = [0, 0], attackers = [0, 0];
  // static evaluations by position key (the same position is evaluated again and again in a search)
  const EC_SIZE = 1 << 16, ecKey1 = new Int32Array(EC_SIZE), ecKey2 = new Int32Array(EC_SIZE), ecVal = new Int32Array(EC_SIZE);
  ecKey2[0] = 1; // so the empty slot 0 doesn't match key (0, 0)
  function evaluate() {
    const ei = h1 & (EC_SIZE - 1);
    if (ecKey1[ei] === h1 && ecKey2[ei] === h2) return ecVal[ei];
    const v = evaluateFull();
    ecKey1[ei] = h1; ecKey2[ei] = h2; ecVal[ei] = v;
    return v;
  }
  function evaluateFull() {
    let mg = mgS, eg = egS;
    if (TR) for (let c = 0; c < 2; c++) for (let k = 0; k < pcnt[c]; k++) { // material and squares
      const sq = plist[c][k], t = board[sq] & 7, i = c ? idxB(sq) : idxW(sq), sign = c ? -1 : 1;
      TR[O.matMg + t] += sign; TR[O.matEg + t] += sign; TR[O.pstMg[t] + i] += sign; TR[O.pstEg[t] + i] += sign;
    }
    const pe = pawnEntry();
    mg += pe[2]; eg += pe[3];
    // mark the king zones and the pawn-covered squares (cleared again below)
    for (let c = 0; c < 2; c++) {
      const zl = ZONE[c][kingSq[c]], z = zone[c];
      for (let i = 0; i < zl.length; i++) z[zl[i]] = 1;
      const pl = plist[c], pa = pawnAtt[c], fw = c ? -16 : 16;
      for (let i = 0; i < pcnt[c]; i++) {
        const sq = pl[i];
        if ((board[sq] & 7) !== P) continue;
        const a = sq + fw - 1, b2 = sq + fw + 1;
        if (!off(a)) pa[a] = 1;
        if (!off(b2)) pa[b2] = 1;
      }
    }
    units[0] = units[1] = attackers[0] = attackers[1] = 0;
    for (let c = 0; c < 2; c++) {
      const pl = plist[c], them = c ? WHITE : BLACK, sign = c ? -1 : 1, ez = zone[1 - c], ph = pawnAtt[1 - c];
      for (let k = 0; k < pcnt[c]; k++) {
      const sq = pl[k], t = board[sq] & 7;
      if (t < N || t > Q) continue;
      let mob = 0, hits = 0;
      if (t === N) {
        for (let i = 0; i < 8; i++) {
          const to = sq + KNIGHT[i];
          if (off(to)) continue;
          if (ez[to]) hits++;
          const q = board[to];
          if ((!q || (q & 8) === them) && !ph[to]) mob++;
        }
      } else {
        const dirs = t === B ? DIAG : t === R ? ORTH : KING;
        for (let i = 0; i < dirs.length; i++) { const d = dirs[i]; for (let to = sq + d; !off(to); to += d) {
          if (ez[to]) hits++;
          const q = board[to];
          if (q) { if ((q & 8) === them && !ph[to]) mob++; break; }
          if (!ph[to]) mob++;
        } }
      }
      if (W.mob) { mg += sign * MOBT_MG[t][mob]; eg += sign * MOBT_EG[t][mob]; if (TR) { TR[O.mobMg[t] + mob] += sign; TR[O.mobEg[t] + mob] += sign; } }
      if (hits) { units[c] += ATT_W[t] * hits; attackers[c]++; }
      if (t === R) {
        const f = fileOf(sq), own = c ? pe[5] : pe[4], opp = c ? pe[4] : pe[5];
        if (!(own & (1 << f))) {
          const om = opp & (1 << f) ? O.rookHalfMg : O.rookOpenMg, oe = opp & (1 << f) ? O.rookHalfEg : O.rookOpenEg;
          mg += sign * PV[om]; eg += sign * PV[oe];
          if (TR) { TR[om] += sign; TR[oe] += sign; }
        }
        if (rankOf(sq) === (c ? 1 : 6)) { mg += sign * PV[O.rook7Mg]; eg += sign * PV[O.rook7Eg]; if (TR) { TR[O.rook7Mg] += sign; TR[O.rook7Eg] += sign; } } // rook on the seventh
      }
      }
    }
    for (let c = 0; c < 2; c++) {
      const zl = ZONE[c][kingSq[c]], z = zone[c];
      for (let i = 0; i < zl.length; i++) z[zl[i]] = 0;
      const pl = plist[c], pa = pawnAtt[c], fw = c ? -16 : 16;
      for (let i = 0; i < pcnt[c]; i++) {
        const sq = pl[i];
        if ((board[sq] & 7) !== P) continue;
        const a = sq + fw - 1, b2 = sq + fw + 1;
        if (!off(a)) pa[a] = 0;
        if (!off(b2)) pa[b2] = 0;
      }
    }
    // king safety (middlegame): attack units on the zone, counted when two or more pieces join and a queen is there
    for (let c = 0; c < 2 && W.ks; c++) {
      const sign = c ? -1 : 1, enemy = 1 - c;
      if (attackers[enemy] >= 2 && count[(enemy ? BLACK : WHITE) | Q]) {
        const u = Math.min(63, units[enemy]);
        mg -= sign * SAFETY[u];
        if (TR) TR[O.safety + u] -= sign;
      }
      // pawn shield in front of a king tucked away on the wing
      const k = kingSq[c], f = fileOf(k), r = rankOf(k);
      if ((c === 0 ? r <= 1 : r >= 6) && (f <= 2 || f >= 5)) {
        let shield = 0;
        const fw = c ? -16 : 16;
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
          const s1 = k - f + ff + fw, s2 = s1 + fw;
          if (board[s1] === ((c ? BLACK : WHITE) | P)) shield += 2; else if (!off(s2) && board[s2] === ((c ? BLACK : WHITE) | P)) shield += 1;
        }
        if (W.shield) { mg += sign * (shield * PV[O.shieldUnit] + PV[O.shieldBase]); if (TR) { TR[O.shieldUnit] += sign * shield; TR[O.shieldBase] += sign; } }
      }
    }
    // passed pawns: free path and king distances in the endgame
    if (W.pp) for (const sq of pe[6]) {
      const q = board[sq], c = q >> 3, sign = c ? -1 : 1, adv = c ? 7 - rankOf(sq) : rankOf(sq);
      const fw = c ? -16 : 16, promo = c ? fileOf(sq) : 0x70 + fileOf(sq);
      if (!board[sq + fw]) { eg += sign * PFREE[adv]; if (TR) TR[O.pFree + adv] += sign; }
      const de = dist(kingSq[1 - c], promo), dw = dist(kingSq[c], promo);
      eg += sign * (de * PKE[adv] + dw * PKO[adv]);
      if (TR) { TR[O.pKingEnemy + adv] += sign * de; TR[O.pKingOwn + adv] += sign * dw; }
    }
    // opening: development, an early queen, the king stuck in the middle
    for (let c = 0; c < 2; c++) {
      const sign = c ? -1 : 1, base = c ? 0x70 : 0, col = c ? BLACK : WHITE;
      let home = 0;
      if (board[base + 1] === (col | N)) home++;
      if (board[base + 6] === (col | N)) home++;
      if (board[base + 2] === (col | B)) home++;
      if (board[base + 5] === (col | B)) home++;
      if (home) { mg -= sign * home * PV[O.undev]; if (TR) TR[O.undev] -= sign * home; }
      if (home >= 2 && count[col | Q] && board[base + 3] !== (col | Q)) { mg -= sign * PV[O.earlyQueen]; if (TR) TR[O.earlyQueen] -= sign; }
      const rights = c ? castle & 12 : castle & 3, kf = fileOf(kingSq[c]);
      if (rights) { mg += sign * PV[O.castleRight]; if (TR) TR[O.castleRight] += sign; }
      else if ((kf === 3 || kf === 4) && count[(col ^ 8) | Q]) { mg -= sign * PV[O.kingCenter]; if (TR) TR[O.kingCenter] -= sign; }
    }
    const bp = (count[WHITE | B] >= 2 ? 1 : 0) - (count[BLACK | B] >= 2 ? 1 : 0);
    if (bp) { mg += bp * PV[O.bpairMg]; eg += bp * PV[O.bpairEg]; if (TR) { TR[O.bpairMg] += bp; TR[O.bpairEg] += bp; } }
    const phase = phaseS > 24 ? 24 : phaseS;
    let sc = ((mg * phase + eg * (24 - phase)) / 24) | 0, scale = 1;
    // drawish material: no pawns and a minor piece up at most
    if (!count[WHITE | P] && sc > 0 && count[WHITE | N] + count[WHITE | B] <= 1 && !count[WHITE | R] && !count[WHITE | Q]) { sc >>= 3; scale = 0.125; }
    if (!count[BLACK | P] && sc < 0 && count[BLACK | N] + count[BLACK | B] <= 1 && !count[BLACK | R] && !count[BLACK | Q]) { sc >>= 3; scale = 0.125; }
    if (TR) { trPhase = phase; trScale = scale; TR[O.tempo] += side === WHITE ? 1 : -1; }
    sc = side === WHITE ? sc : -sc;
    return sc + PV[O.tempo];
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
  const CM = new Int32Array(16 * 128); // countermove: the quiet move that last refuted (piece, square) of the move before
  const LMR = [];
  for (let d = 0; d < 64; d++) { LMR.push(new Int8Array(64)); for (let i = 1; i < 64; i++) LMR[d][i] = d && i ? Math.floor(0.6 + Math.log(d) * Math.log(i) / 2.2) : 0; }
  const RFP_MARGIN = 85, FUT_MARGIN = [0, 110, 210, 310], LMP = [0, 5, 8, 13, 20];
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 2047) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function score(n, p, ttMove) {
    const ms = MV[p], sc = SC[p], pm = un > 0 ? uM[un - 1] : 0, cmMove = pm ? CM[board[mTo(pm)] * 128 + mTo(pm)] : 0;
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
      else if (W.cm && m === cmMove) v = (1 << 27) - 2;
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
    const check = W.qcheck && qd < 4 && inCheck(); // evasions near the leaves: so mates at the horizon are seen
    const realCheck = W.qcheck && qd < 4 ? check : inCheck(), kq = kingSq[side >> 3];
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
      if (leftInCheck(m, kq, realCheck)) { unmake(); continue; }
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
    if (W.rfp && !pv && !check && depth <= 6 && Math.abs(beta) < MATE_BOUND && ev - RFP_MARGIN * depth >= beta) return ev;
    // razoring: hopelessly below alpha near the leaves: see whether a capture rescues it, else give up here
    if (W.raz && !pv && !check && depth <= 2 && ev + 280 * depth <= alpha) {
      const q = qsearch(alpha, alpha + 1, p, 0);
      if (stopped) return 0;
      if (q <= alpha) return q;
    }
    // null move: give the opponent a free move; if we're still above beta, this node is good enough
    if (!pv && !check && nullOk && depth >= 3 && hasPieces(side) && ev >= beta) {
      makeNull(); ply++;
      const sc = -search(depth - 1 - (3 + (depth >> 2)), -beta, -beta + 1, p + 1, false, false);
      ply--; unmakeNull();
      if (stopped) return 0;
      if (sc >= beta) return sc >= MATE_BOUND ? beta : sc;
    }
    // no table move at a deep PV node: a shallower search finds one to try first
    if (W.iid && pv && !ttMove && depth >= 6) {
      search(depth - 3, alpha, beta, p, true, false);
      if (stopped) return 0;
      if (tFlag[idx] && tKey[idx] === h2) ttMove = tMove[idx];
    }
    const n = gen(MV[p], false);
    score(n, p, ttMove);
    const futile = W.fut && !pv && !check && depth <= 3 && ev + FUT_MARGIN[depth] <= alpha;
    const a0 = alpha, qt = QT[p], kq = kingSq[side >> 3];
    let best = -INF, bestMove = 0, legal = 0, quiets = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      const quiet = !(mFlags(m) & FLAG_CAP) && !mPromo(m);
      make(m);
      if (leftInCheck(m, kq, check)) { unmake(); continue; }
      legal++;
      const gives = givesCheck(m);
      if (quiet && !gives && legal > 1 && best > -MATE_BOUND) {
        // futility and late move pruning: quiet moves that can't plausibly lift alpha at the frontier
        if (futile || (W.lmp && !pv && !check && depth <= 4 && quiets >= LMP[depth])) { unmake(); quiets++; continue; }
        // a quiet move that has kept failing elsewhere, near the leaves
        if (W.hp && !pv && !check && depth <= 3 && HIST[board[mTo(m)] * 128 + mTo(m)] < -1500 * depth) { unmake(); quiets++; continue; }
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
          if (un > 0 && uM[un - 1]) { const pm = uM[un - 1]; CM[board[mTo(pm)] * 128 + mTo(pm)] = m; }
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
      if (W.asp && d >= 5 && Math.abs(prev) < MATE_BOUND) { lo = prev - delta; hi = prev + delta; } // aspiration window
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
    const list = new Int32Array(256), n = gen(list, false), kq = kingSq[side >> 3], chk = inCheck();
    let total = 0;
    for (let i = 0; i < n; i++) {
      make(list[i]);
      if (!leftInCheck(list[i], kq, chk)) total += d <= 1 ? 1 : perft(d - 1);
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
  // the evaluation as a linear function of PV, White's view: value ≈ Σ coef[k] × PV[idx[k]] (up to rounding)
  function features() {
    TR = new Float64Array(PN);
    const v = evaluateFull(), tr = TR;
    TR = null;
    const idx = [], coef = [];
    for (const [name, o, n, egTerm] of PDEF) for (let k = o; k < o + n; k++) {
      if (!tr[k]) continue;
      idx.push(k);
      coef.push(k === O.tempo ? tr[k] : tr[k] * (egTerm ? 24 - trPhase : trPhase) / 24 * trScale);
      void name;
    }
    return { idx, coef, value: side === WHITE ? v : -v };
  }
  // quiescence score of the current position (for picking quiet positions when tuning the evaluation)
  function qscore() { nodes = 0; stopped = false; deadline = 0; maxNodes = 0; ply = 0; return qsearch(-INF, INF, 0, 0); }
  function piecesOf(c) { // material count by type for the colour, for the page's remarks
    const n = [0, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 128; s++) { if (off(s)) { s += 7; continue; } const p = board[s]; if (p && (p & 8) === c) n[p & 7]++; }
    return n;
  }

  setFen(START_FEN);
  return {
    WHITE, BLACK, P, N, B, R, Q, K, MATE, MATE_BOUND, FLAG_CAP, FLAG_EP, FLAG_CASTLE, FLAG_DOUBLE, START_FEN,
    setFen, fen, setStart() { setFen(START_FEN); }, legalMoves, play, think, evaluate, qscore, features, see, PDEF, params: () => PV.slice(), perft, san, uci, status, inCheck, ttClear,
    mFrom, mTo, mPromo, mFlags, sqName, piecesOf,
    get side() { return side; }, get board() { return board; }, get kings() { return kingSq.slice(); },
  };
}
if (typeof module !== 'undefined') module.exports = { ChessEngine };

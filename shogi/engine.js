// Shogi (Japanese chess) engine, written for this site: alpha-beta in plain JS. Loaded on the page (rules) and in
// worker.js (thinking), like the janggi engine.
//
// Rules (Japan Shogi Association, as Fairy-Stockfish's "shogi" has them): 9×9, 선수 (Sente, moves first) and 후수 (Gote).
// Captured pieces go into the captor's hand, unpromoted, and may be dropped later on any empty point (one turn). Drops:
// no pawn on a file that already holds one's own unpromoted pawn (이보, nifu); no pawn/lance on the last rank, no knight on
// the last two; a pawn drop may not give checkmate (uchifuzume). Promotion (optional, forced for pieces that would have
// no move) when a pawn/lance/knight/silver/bishop/rook moves into, within or out of the last three ranks. Check must be
// answered; checkmate (or no legal move) loses. The same position (hands and side to move included) four times is a draw,
// unless one side gave check every move: then that side loses. A king in the enemy camp may declare victory by the
// 27-point rule (CSA flavour: king in the camp, not in check, ≥10 other pieces there, points ≥ 28 for 선수 / 27 for 후수,
// counting pieces in the camp and in hand: bishop/rook 5, others 1). 600 plies is a draw (a cap, not in the rules).
//
// Squares: s = rank*9 + file, rank 0 = 선수's home rank, file 0 = a (as Fairy-Stockfish writes shogi: a1 bottom left).
// Pieces: colour*16 + type; types 1 P, 2 L, 3 N, 4 S, 5 G, 6 B, 7 R, 8 K, 9 +P, 10 +L, 11 +N, 12 +S, 13 +B, 14 +R.
// Moves: from | to<<7 | 1<<14 promotion | 1<<15 capture; from = 81 + type for a drop; DECLARE = 1<<16.
function ShogiEngine(opts) {
  opts = opts || {};
  const SENTE = 0, GOTE = 1;
  const P = 1, L = 2, N = 3, S = 4, G = 5, B = 6, R = 7, K = 8, PP = 9, PL = 10, PN = 11, PS = 12, PB = 13, PR = 14;
  const MATE = 100000, MATE_BOUND = MATE - 1000, INF = MATE + 1, MAXPLY = 96, PLY_LIMIT = 600;
  const DECLARE = 1 << 16, F_CAP = 1 << 15, F_PROMO = 1 << 14;
  const mFrom = (m) => m & 127, mTo = (m) => (m >> 7) & 127;
  const isDrop = (m) => m < DECLARE && (m & 127) > 81, isCap = (m) => (m & F_CAP) !== 0, isPromo = (m) => (m & F_PROMO) !== 0;
  const PROMOTE_TO = [0, 9, 10, 11, 12, 0, 13, 14, 0, 0, 0, 0, 0, 0, 0];
  const UNPRO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 6, 7];
  const PROMOTABLE = [0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const LETTER = ' plnsgbrk';

  // ---------- tables ----------
  const R_OF = new Int8Array(81), F_OF = new Int8Array(81);
  for (let s = 0; s < 81; s++) { R_OF[s] = (s / 9) | 0; F_OF[s] = s % 9; }
  const ZONE = [new Uint8Array(81), new Uint8Array(81)], LAST1 = [new Uint8Array(81), new Uint8Array(81)], LAST2 = [new Uint8Array(81), new Uint8Array(81)];
  for (let s = 0; s < 81; s++) {
    const r = R_OF[s];
    ZONE[0][s] = r >= 6 ? 1 : 0; ZONE[1][s] = r <= 2 ? 1 : 0;
    LAST1[0][s] = r === 8 ? 1 : 0; LAST1[1][s] = r === 0 ? 1 : 0;
    LAST2[0][s] = r >= 7 ? 1 : 0; LAST2[1][s] = r <= 1 ? 1 : 0;
  }
  const inB = (r, f) => r >= 0 && r < 9 && f >= 0 && f < 9;
  const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ORTH = [[1, 0], [0, 1], [-1, 0], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const GOLD = [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1], [-1, 0]];
  const STEPV = [], SLIDEV = [];
  STEPV[P] = [[1, 0]]; STEPV[S] = [[1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const t of [G, PP, PL, PN, PS]) STEPV[t] = GOLD;
  STEPV[K] = D8; STEPV[PB] = ORTH; STEPV[PR] = DIAG;
  SLIDEV[L] = [[1, 0]]; SLIDEV[B] = DIAG; SLIDEV[R] = ORTH; SLIDEV[PB] = DIAG; SLIDEV[PR] = ORTH;
  const KNV = [[2, 1], [2, -1]];
  const STEPS = [[], []], RAYS = [[], []];
  for (let c = 0; c < 2; c++) {
    const sg = c ? -1 : 1;
    for (let t = 1; t <= 14; t++) {
      STEPS[c][t] = []; RAYS[c][t] = [];
      for (let s = 0; s < 81; s++) {
        const r = R_OF[s], f = F_OF[s], st = [], rays = [];
        for (const [dr, df] of STEPV[t] || []) if (inB(r + dr * sg, f + df)) st.push((r + dr * sg) * 9 + f + df);
        if (t === N) for (const [dr, df] of KNV) if (inB(r + dr * sg, f + df)) st.push((r + dr * sg) * 9 + f + df);
        for (const [dr, df] of SLIDEV[t] || []) {
          const ray = [];
          for (let k = 1; inB(r + dr * sg * k, f + df * k); k++) ray.push((r + dr * sg * k) * 9 + f + df * k);
          if (ray.length) rays.push(ray);
        }
        STEPS[c][t][s] = st; RAYS[c][t][s] = rays;
      }
    }
  }
  // attacks: ATT[piece*8 + i] = how a piece standing along direction i from the target reaches it (1 adjacent step, 2 slide)
  const ATT = new Uint8Array(32 * 8);
  const dirIdx = (dr, df) => D8.findIndex(([a, b]) => a === dr && b === df);
  for (let c = 0; c < 2; c++) {
    const sg = c ? -1 : 1;
    for (let t = 1; t <= 14; t++) {
      for (const [dr, df] of STEPV[t] || []) { const i = dirIdx(-dr * sg, -df); ATT[(c * 16 + t) * 8 + i] = Math.max(ATT[(c * 16 + t) * 8 + i], 1); }
      for (const [dr, df] of SLIDEV[t] || []) { const i = dirIdx(-dr * sg, -df); ATT[(c * 16 + t) * 8 + i] = 2; }
    }
  }
  const RAYDIR = Array.from({ length: 81 }, (_, s) => D8.map(([dr, df]) => {
    const ray = [];
    for (let k = 1; inB(R_OF[s] + dr * k, F_OF[s] + df * k); k++) ray.push((R_OF[s] + dr * k) * 9 + F_OF[s] + df * k);
    return ray;
  }));
  const KNFROM = [[], []]; // squares of a colour's knights that attack s
  for (let c = 0; c < 2; c++) for (let s = 0; s < 81; s++) {
    const sg = c ? -1 : 1, out = [];
    for (const [dr, df] of KNV) if (inB(R_OF[s] - dr * sg, F_OF[s] - df)) out.push((R_OF[s] - dr * sg) * 9 + F_OF[s] - df);
    KNFROM[c][s] = out;
  }

  // ---------- state ----------
  const board = new Int8Array(81), hand = new Int8Array(16), kingSq = [-1, -1];
  let side = SENTE, h1 = 0, h2 = 0, un = 0, irrev = 0, chk = false, declared = -1;
  let seed = 0x3c6ef372;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(32 * 81), Z2 = new Int32Array(32 * 81), ZH1 = new Int32Array(16 * 40), ZH2 = new Int32Array(16 * 40);
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  for (let i = 0; i < ZH1.length; i++) { ZH1[i] = rnd(); ZH2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  const H = 1024;
  const hk1 = new Int32Array(H), hk2 = new Int32Array(H), uM = new Int32Array(H), uCap = new Int8Array(H), uPiece = new Int8Array(H);
  const uChk = new Uint8Array(H), uPrevChk = new Uint8Array(H), uPrevIrrev = new Int16Array(H), uSide = new Uint8Array(H);

  function rehash() {
    h1 = 0; h2 = 0;
    for (let s = 0; s < 81; s++) { const p = board[s]; if (p) { h1 ^= Z1[p * 81 + s]; h2 ^= Z2[p * 81 + s]; if ((p & 15) === K) kingSq[p >> 4] = s; } }
    for (let c = 0; c < 2; c++) for (let t = 1; t <= 7; t++) { h1 ^= ZH1[(c * 8 + t) * 40 + hand[c * 8 + t]]; h2 ^= ZH2[(c * 8 + t) * 40 + hand[c * 8 + t]]; }
    if (side === GOTE) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  function reset() {
    un = 0; irrev = 0; declared = -1;
    rehash();
    hk1[0] = h1; hk2[0] = h2;
    chk = kingSq[side] >= 0 && attacked(kingSq[side], side ^ 1);
  }
  const START = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL[-] w 0 1';
  // Fairy-Stockfish style FEN: ranks 9 to 1, '+' promoted, [hands] (uppercase 선수), w = 선수 to move
  function setFen(fen) {
    board.fill(0); hand.fill(0); kingSq[0] = kingSq[1] = -1;
    const parts = fen.trim().split(/\s+/), m = /^([^\[]*)(?:\[([^\]]*)\])?$/.exec(parts[0]);
    const rows = m[1].split('/');
    for (let i = 0; i < 9; i++) {
      let f = 0, promo = 0;
      for (const ch of rows[i]) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        if (ch === '+') { promo = 1; continue; }
        let t = LETTER.indexOf(ch.toLowerCase());
        if (promo) t = PROMOTE_TO[t];
        board[(8 - i) * 9 + f] = ((ch === ch.toLowerCase() ? GOTE : SENTE) << 4) | t;
        f++; promo = 0;
      }
    }
    for (const ch of m[2] || '') { if (ch === '-') continue; hand[((ch === ch.toLowerCase() ? GOTE : SENTE) * 8) + LETTER.indexOf(ch.toLowerCase())]++; }
    side = parts[1] === 'b' ? GOTE : SENTE;
    reset();
  }
  function fen() {
    const rows = [];
    for (let r = 8; r >= 0; r--) {
      let row = '', e = 0;
      for (let f = 0; f < 9; f++) {
        const p = board[r * 9 + f];
        if (!p) { e++; continue; }
        if (e) { row += e; e = 0; }
        let t = p & 15, pre = '';
        if (t > 8) { pre = '+'; t = UNPRO[t]; }
        const ch = LETTER[t];
        row += pre + (p >> 4 ? ch : ch.toUpperCase());
      }
      if (e) row += e;
      rows.push(row);
    }
    let hs = '';
    for (const c of [SENTE, GOTE]) for (const t of [R, B, G, S, N, L, P]) hs += (c ? LETTER[t] : LETTER[t].toUpperCase()).repeat(hand[c * 8 + t]);
    return `${rows.join('/')}[${hs}] ${side === SENTE ? 'w' : 'b'} - - 0 1`;
  }
  const sqName = (s) => 'abcdefghi'[F_OF[s]] + (R_OF[s] + 1);
  const uci = (m) => (m === DECLARE ? 'declare' : isDrop(m) ? `${LETTER[(m & 127) - 81].toUpperCase()}@${sqName(mTo(m))}` : sqName(mFrom(m)) + sqName(mTo(m)) + (isPromo(m) ? '+' : ''));

  // ---------- attacks ----------
  function attacked(s, by) {
    for (let i = 0; i < 8; i++) {
      const ray = RAYDIR[s][i];
      for (let k = 0; k < ray.length; k++) {
        const q = board[ray[k]];
        if (q) {
          if ((q >> 4) === by) { const a = ATT[q * 8 + i]; if (a === 2 || (a === 1 && k === 0)) return true; }
          break;
        }
      }
    }
    const kn = KNFROM[by][s], np = by * 16 + N;
    for (let i = 0; i < kn.length; i++) if (board[kn[i]] === np) return true;
    return false;
  }
  const inCheck = (c = side) => (c === side ? chk : (kingSq[c] >= 0 && attacked(kingSq[c], c ^ 1)));

  // ---------- move generation (pseudo-legal; the king-safety and pawn-drop-mate tests come after make) ----------
  function gen(list, capsOnly) {
    let n = 0;
    const c = side;
    const add = (from, to, t, q) => {
      const cap = q ? F_CAP : 0;
      if (PROMOTABLE[t]) {
        if (ZONE[c][from] || ZONE[c][to]) list[n++] = from | (to << 7) | F_PROMO | cap;
        if ((t === P || t === L) && LAST1[c][to]) return;
        if (t === N && LAST2[c][to]) return;
      }
      list[n++] = from | (to << 7) | cap;
    };
    let pawnFiles = 0;
    for (let s = 0; s < 81; s++) {
      const p = board[s];
      if (!p || (p >> 4) !== c) continue;
      const t = p & 15;
      if (t === P) pawnFiles |= 1 << F_OF[s];
      const st = STEPS[c][t][s];
      for (let i = 0; i < st.length; i++) { const to = st[i], q = board[to]; if (q && (q >> 4) === c) continue; if (capsOnly && !q) continue; add(s, to, t, q); }
      const rays = RAYS[c][t][s];
      for (let i = 0; i < rays.length; i++) {
        const ray = rays[i];
        for (let k = 0; k < ray.length; k++) {
          const to = ray[k], q = board[to];
          if (!q) { if (!capsOnly) add(s, to, t, 0); continue; }
          if ((q >> 4) !== c) add(s, to, t, q);
          break;
        }
      }
    }
    if (!capsOnly) {
      let any = false;
      for (let t = 1; t <= 7; t++) if (hand[c * 8 + t]) { any = true; break; }
      if (any) {
        for (let t = 1; t <= 7; t++) {
          if (!hand[c * 8 + t]) continue;
          for (let s = 0; s < 81; s++) {
            if (board[s]) continue;
            if (t === P) { if (LAST1[c][s] || ((pawnFiles >> F_OF[s]) & 1)) continue; }
            else if (t === L) { if (LAST1[c][s]) continue; }
            else if (t === N) { if (LAST2[c][s]) continue; }
            list[n++] = (81 + t) | (s << 7);
          }
        }
      }
    }
    return n;
  }

  // ---------- make / unmake ----------
  function make(m) {
    uM[un] = m; uPrevChk[un] = chk ? 1 : 0; uPrevIrrev[un] = irrev; uSide[un] = side;
    if (m === DECLARE) { declared = side; uCap[un] = 0; uPiece[un] = 0; }
    else {
      const c = side, from = m & 127, to = (m >> 7) & 127, q = board[to];
      let p;
      if (from > 81) {
        const t = from - 81, hi = c * 8 + t, n = hand[hi];
        p = c * 16 + t;
        h1 ^= ZH1[hi * 40 + n] ^ ZH1[hi * 40 + n - 1]; h2 ^= ZH2[hi * 40 + n] ^ ZH2[hi * 40 + n - 1];
        hand[hi] = n - 1; irrev = un + 1;
      } else {
        p = board[from]; board[from] = 0;
        h1 ^= Z1[p * 81 + from]; h2 ^= Z2[p * 81 + from];
        const t = p & 15;
        if (t === P || t === L || t === N) irrev = un + 1;
      }
      uCap[un] = q; uPiece[un] = p;
      let np = p;
      if (m & F_PROMO) { np = c * 16 + PROMOTE_TO[p & 15]; irrev = un + 1; }
      if (q) {
        h1 ^= Z1[q * 81 + to]; h2 ^= Z2[q * 81 + to];
        const hi = c * 8 + UNPRO[q & 15], n = hand[hi];
        h1 ^= ZH1[hi * 40 + n] ^ ZH1[hi * 40 + n + 1]; h2 ^= ZH2[hi * 40 + n] ^ ZH2[hi * 40 + n + 1];
        hand[hi] = n + 1; irrev = un + 1;
      }
      board[to] = np; h1 ^= Z1[np * 81 + to]; h2 ^= Z2[np * 81 + to];
      if ((np & 15) === K) kingSq[c] = to;
    }
    side ^= 1; h1 ^= ZS1; h2 ^= ZS2;
    un++;
    hk1[un] = h1; hk2[un] = h2;
    chk = m !== DECLARE && kingSq[side] >= 0 && attacked(kingSq[side], side ^ 1);
    uChk[un - 1] = chk ? 1 : 0;
  }
  function unmake() {
    un--;
    const m = uM[un];
    side ^= 1; h1 = hk1[un]; h2 = hk2[un]; irrev = uPrevIrrev[un]; chk = uPrevChk[un] === 1;
    if (m === DECLARE) { declared = -1; return; }
    const c = side, from = m & 127, to = (m >> 7) & 127, q = uCap[un], p = uPiece[un];
    board[to] = q;
    if (from > 81) hand[c * 8 + from - 81]++;
    else { board[from] = p; if ((p & 15) === K) kingSq[c] = from; }
    if (q) hand[c * 8 + UNPRO[q & 15]]--;
  }
  const SCR = new Int32Array(768);
  // does the side to move have a move that leaves its king safe? (pawn-drop mate among the replies isn't tested)
  function hasLegalMove() {
    const mover = side, n = gen(SCR, false);
    for (let i = 0; i < n; i++) {
      const m = SCR[i];
      make(m);
      const ok = !(kingSq[mover] >= 0 && attacked(kingSq[mover], mover ^ 1));
      unmake();
      if (ok) return true;
    }
    return false;
  }
  // after make(m) by `mover`: is m a legal move (king safe, no pawn-drop mate)?
  function legalAfter(m, mover) {
    if (kingSq[mover] >= 0 && attacked(kingSq[mover], mover ^ 1)) return false;
    if (chk && isDrop(m) && (m & 127) === 82 && !hasLegalMove()) return false; // uchifuzume
    return true;
  }
  function canDeclare(c = side) {
    const ks = kingSq[c];
    if (ks < 0 || !ZONE[c][ks] || inCheck(c)) return false;
    let n = 0, pts = 0;
    for (let s = 0; s < 81; s++) {
      const p = board[s];
      if (!p || (p >> 4) !== c || !ZONE[c][s] || (p & 15) === K) continue;
      n++; const t = p & 15; pts += t === B || t === R || t === PB || t === PR ? 5 : 1;
    }
    for (let t = 1; t <= 7; t++) pts += hand[c * 8 + t] * (t === B || t === R ? 5 : 1);
    return n >= 10 && pts >= (c === SENTE ? 28 : 27);
  }
  function legalMoves() {
    const list = new Int32Array(768), n = gen(list, false), out = [], mover = side;
    for (let i = 0; i < n; i++) { make(list[i]); if (legalAfter(list[i], mover)) out.push(list[i]); unmake(); }
    if (canDeclare(mover)) out.push(DECLARE);
    return out;
  }
  function repCount() {
    let c = 0;
    for (let i = un - 2; i >= irrev && i >= 0; i -= 2) if (hk1[i] === h1 && hk2[i] === h2) c++;
    return c;
  }
  let loser = -1; // set by status(): the side that lost (-1 draw)
  // '' while the game goes on; 'mate' (side to move lost), 'declare' (the declarer won), 'perpetual' (the checker lost),
  // 'draw:repetition', 'draw:limit'
  function status() {
    loser = -1;
    if (declared >= 0) { loser = declared ^ 1; return 'declare'; }
    if (!hasLegalMove()) { loser = side; return 'mate'; }
    if (repCount() >= 3) {
      let j0 = un;
      for (let i = un - 2; i >= irrev && i >= 0; i -= 2) if (hk1[i] === h1 && hk2[i] === h2) j0 = i;
      const all = [true, true], cnt = [0, 0];
      for (let k = j0; k < un; k++) { cnt[uSide[k]]++; if (!uChk[k]) all[uSide[k]] = false; }
      const p0 = cnt[0] > 0 && all[0], p1 = cnt[1] > 0 && all[1];
      if (p0 !== p1) { loser = p0 ? 0 : 1; return 'perpetual'; }
      return 'draw:repetition';
    }
    if (un >= PLY_LIMIT) return 'draw:limit';
    return '';
  }

  // ---------- evaluation ----------
  // Linear in the parameter array PV (so the janggi-style Texel tuning works): material (board and hand), piece-square
  // tables by own-side rank and folded file, what stands near each king (own and enemy pieces, by type and distance),
  // the king's empty neighbours, tempo. Sente's view internally.
  const PDEF = [], PINIT = [];
  let NPAR = 0;
  function prm(name, init) { const o = NPAR; PDEF.push([name, o, init.length]); for (const v of init) PINIT.push(v); NPAR += init.length; return o; }
  const O = {
    mat: prm('material on the board', [0, 100, 320, 350, 520, 580, 880, 1040, 0, 540, 560, 570, 580, 1000, 1200]),
    hand: prm('material in hand', [0, 115, 350, 380, 570, 640, 960, 1130]),
    pst: prm('piece squares', new Array(14 * 45).fill(0)),
    ksD: prm('own near king', new Array(30).fill(0)),
    ksA: prm('enemy near king', new Array(30).fill(0)),
    esc: prm('empty next to king', new Array(9).fill(0)),
    tempo: prm('tempo', [10]),
  };
  const TUNED = null; // tuned-params
  const PV = Int32Array.from(TUNED && TUNED.length === NPAR ? TUNED : PINIT);
  if (opts.params) PV.set(opts.params);
  let TR = null;
  const tr = (k, c) => { if (TR) TR[k] += c; };
  function evaluate() {
    let v = 0;
    for (let s = 0; s < 81; s++) {
      const p = board[s];
      if (!p) continue;
      const c = p >> 4, t = p & 15, sg = c ? -1 : 1, r = c ? 8 - R_OF[s] : R_OF[s], f = F_OF[s] > 4 ? 8 - F_OF[s] : F_OF[s];
      const k = O.pst + (t - 1) * 45 + r * 5 + f;
      v += sg * (PV[O.mat + t] + PV[k]); tr(O.mat + t, sg); tr(k, sg);
    }
    for (let c = 0; c < 2; c++) for (let t = 1; t <= 7; t++) {
      const n = hand[c * 8 + t];
      if (n) { const sg = c ? -1 : 1; v += sg * n * PV[O.hand + t]; tr(O.hand + t, sg * n); }
    }
    for (let c = 0; c < 2; c++) {
      const ks = kingSq[c];
      if (ks < 0) continue;
      const sg = c ? -1 : 1, kr = R_OF[ks], kf = F_OF[ks];
      let esc = 0;
      for (let dr = -2; dr <= 2; dr++) for (let df = -2; df <= 2; df++) {
        if (!dr && !df) continue;
        const rr = kr + dr, ff = kf + df;
        if (rr < 0 || rr > 8 || ff < 0 || ff > 8) continue;
        const d = Math.max(Math.abs(dr), Math.abs(df)), q = board[rr * 9 + ff];
        if (q) { const k = ((q >> 4) === c ? O.ksD : O.ksA) + (q & 15) * 2 + d - 1; v += sg * PV[k]; tr(k, sg); }
        else if (d === 1) esc++;
      }
      v += sg * PV[O.esc + esc]; tr(O.esc + esc, sg);
    }
    if (TR) TR[O.tempo] += side === SENTE ? 1 : -1;
    return (side === SENTE ? v : -v) + PV[O.tempo];
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
  const MV = [], SC = [], QT = [];
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(768)); SC.push(new Int32Array(768)); QT.push(new Int32Array(768)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(32 * 81);
  const LMR = [];
  for (let d = 0; d < 64; d++) { LMR.push(new Int8Array(64)); for (let i = 1; i < 64; i++) LMR[d][i] = d && i ? Math.floor(0.6 + Math.log(d) * Math.log(i) / 2.2) : 0; }
  const W = Object.assign({ rfp: 1, fut: 1, lmp: 1, nul: 1, iid: 1, asp: 1 }, opts.weights || {});
  const RFP_MARGIN = 120, FUT_MARGIN = [0, 150, 280, 420], LMP = [0, 8, 14, 22, 34];
  const VICTIM = [0, 100, 320, 350, 520, 580, 880, 1040, 5000, 540, 560, 570, 580, 1000, 1200];
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0, excluded = null;
  function timeUp() {
    if ((nodes & 2047) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  const histIdx = (m) => (isDrop(m) ? (side * 16 + (m & 127) - 81) : board[m & 127]) * 81 + ((m >> 7) & 127);
  function score(n, p, ttMove) {
    const ms = MV[p], sc = SC[p];
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      let v;
      if (m === ttMove) v = 1 << 30;
      else if (m & F_CAP) v = (1 << 28) + VICTIM[board[(m >> 7) & 127] & 15] * 8 - (board[m & 127] & 15) + (m & F_PROMO ? 300 : 0);
      else if (m & F_PROMO) v = (1 << 27) + 100;
      else if (m === KIL[p * 2]) v = 1 << 26;
      else if (m === KIL[p * 2 + 1]) v = (1 << 26) - 1;
      else v = HIST[histIdx(m)];
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
  const histAdd = (i, bonus) => { HIST[i] += bonus - Math.trunc(HIST[i] * Math.abs(bonus) / 16384); };
  function qsearch(alpha, beta, p, qd) {
    nodes++;
    if (timeUp()) return 0;
    if (p >= MAXPLY) return evaluate();
    const check = chk, full = check && qd < 4;
    let best = -INF, n;
    if (full) n = gen(MV[p], false);
    else {
      const stand = evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
      n = gen(MV[p], true);
    }
    score(n, p, 0);
    let legal = 0;
    const mover = side;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      if (!full && best + VICTIM[board[(m >> 7) & 127] & 15] + 250 < alpha) continue; // delta pruning
      make(m);
      if (!legalAfter(m, mover)) { unmake(); continue; }
      legal++; ply++;
      const s = -qsearch(-beta, -alpha, p + 1, qd + 1);
      ply--; unmake();
      if (stopped) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (full && !legal) return -(MATE - p);
    return best;
  }
  function search(depth, alpha, beta, p, pv, nullOk) {
    if (p > 0) {
      if (repCount() >= 1) return 0;
      if (un >= PLY_LIMIT) return 0;
      if (alpha < -(MATE - p)) alpha = -(MATE - p);
      if (beta > MATE - p - 1) beta = MATE - p - 1;
      if (alpha >= beta) return alpha;
    }
    const check = chk;
    if (check) depth++;
    if (depth <= 0) return qsearch(alpha, beta, p, 0);
    nodes++;
    if (timeUp()) return 0;
    if (p >= MAXPLY) return evaluate();
    const idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pv && p > 0 && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    const ev = check ? -INF : evaluate();
    if (W.rfp && !pv && !check && depth <= 6 && Math.abs(beta) < MATE_BOUND && ev - RFP_MARGIN * depth >= beta) return ev;
    if (W.nul && !pv && !check && nullOk && depth >= 3 && ev >= beta) {
      // a free move for the opponent (hands stay): enough to cut when still above beta
      const savedSide = side, savedH1 = h1, savedH2 = h2, savedChk = chk, savedIrrev = irrev;
      uM[un] = 0; uPrevChk[un] = chk ? 1 : 0; uPrevIrrev[un] = irrev; uSide[un] = side; uChk[un] = 0;
      side ^= 1; h1 ^= ZS1; h2 ^= ZS2; un++; hk1[un] = h1; hk2[un] = h2; irrev = un;
      chk = kingSq[side] >= 0 && attacked(kingSq[side], side ^ 1);
      ply++;
      const s = -search(depth - 1 - (2 + (depth >> 2)), -beta, -beta + 1, p + 1, false, false);
      ply--;
      un--; side = savedSide; h1 = savedH1; h2 = savedH2; chk = savedChk; irrev = savedIrrev;
      if (stopped) return 0;
      if (s >= beta) return s >= MATE_BOUND ? beta : s;
    }
    if (W.iid && pv && !ttMove && depth >= 6) {
      search(depth - 3, alpha, beta, p, true, false);
      if (stopped) return 0;
      if (tFlag[idx] && tKey[idx] === h2) ttMove = tMove[idx];
    }
    const ms = MV[p], n = gen(ms, false);
    score(n, p, ttMove);
    const futile = W.fut && !pv && !check && depth <= 3 && ev + FUT_MARGIN[depth] <= alpha;
    const a0 = alpha, qt = QT[p], mover = side;
    let best = -INF, bestMove = 0, legal = 0, quiets = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      if (p === 0 && excluded && excluded.includes(m)) continue;
      const quiet = !(m & F_CAP) && !(m & F_PROMO), hi = histIdx(m);
      make(m);
      if (!legalAfter(m, mover)) { unmake(); continue; }
      legal++;
      const gives = chk;
      if (quiet && !gives && legal > 1 && best > -MATE_BOUND) {
        if (futile || (W.lmp && !pv && !check && depth <= 4 && quiets >= LMP[depth])) { unmake(); quiets++; continue; }
      }
      if (quiet) qt[quiets++] = m;
      ply++;
      let s;
      if (legal === 1) s = -search(depth - 1, -beta, -alpha, p + 1, pv, true);
      else {
        let r = 0;
        if (depth >= 3 && quiet && !gives && !check && m !== KIL[p * 2] && m !== KIL[p * 2 + 1]) {
          r = LMR[Math.min(depth, 63)][Math.min(legal, 63)];
          if (pv) r--;
          if (HIST[hi] > 4000) r--;
          if (r < 0) r = 0;
          if (r > depth - 2) r = depth - 2;
        }
        s = -search(depth - 1 - r, -alpha - 1, -alpha, p + 1, false, true);
        if (s > alpha && r) s = -search(depth - 1, -alpha - 1, -alpha, p + 1, false, true);
        if (s > alpha && s < beta) s = -search(depth - 1, -beta, -alpha, p + 1, true, true);
      }
      ply--; unmake();
      if (stopped) return 0;
      if (s > best) { best = s; bestMove = m; if (p === 0) rootBest = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (quiet) {
          if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
          const bonus = Math.min(depth * depth * 16, 1600);
          histAdd(hi, bonus);
          for (let j = 0; j < quiets - 1; j++) histAdd(histIdxOf(qt[j], mover), -bonus);
        }
        break;
      }
    }
    if (!legal) return -(MATE - p);
    if (best === -INF) best = alpha;
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // history index of a move of `c` made in the position that was current when it was generated (board unchanged by now)
  function histIdxOf(m, c) { return (isDrop(m) ? (c * 16 + (m & 127) - 81) : board[m & 127]) * 81 + ((m >> 7) & 127); }
  // cfg: {time, depth, nodes, soft, exclude}. Returns {move, score, depth, nodes, ms}; score from the side to move.
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
    excluded = cfg.exclude && cfg.exclude.length ? cfg.exclude : null;
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (canDeclare(side)) { info.move = DECLARE; info.score = MATE - 1; return info; }
    const legal = legalMoves().filter((m) => m !== DECLARE && (!excluded || !excluded.includes(m)));
    if (!legal.length) { info.score = -MATE; return info; }
    if (legal.length === 1) { info.move = legal[0]; info.score = evaluate(); info.ms = Date.now() - t0; return info; }
    let best = legal[0], prev = 0;
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      let s, delta = 40, lo = -INF, hi = INF;
      if (W.asp && d >= 5 && Math.abs(prev) < MATE_BOUND) { lo = prev - delta; hi = prev + delta; }
      for (;;) {
        s = search(d, lo, hi, 0, true, false);
        if (stopped) break;
        if (s <= lo) { lo = Math.max(-INF, lo - delta); delta *= 2; if (delta > 600) lo = -INF; continue; }
        if (s >= hi) { hi = Math.min(INF, hi + delta); delta *= 2; if (delta > 600) hi = INF; if (rootBest) best = rootBest; continue; }
        break;
      }
      if (stopped) { if (rootBest && d > 1 && legal.includes(rootBest)) best = rootBest; break; }
      if (rootBest) best = rootBest;
      prev = s;
      info.depth = d; info.score = s;
      if (Math.abs(s) >= MATE_BOUND && d >= 2 && MATE - Math.abs(s) < d) break;
      if (soft && Date.now() - t0 >= soft) break;
      if (maxNodes && nodes >= maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page and tests ----------
  function perft(d) {
    const list = new Int32Array(768), n = gen(list, false), mover = side;
    let total = 0;
    for (let i = 0; i < n; i++) {
      make(list[i]);
      if (legalAfter(list[i], mover)) total += d <= 1 ? 1 : perft(d - 1);
      unmake();
    }
    return total;
  }
  function features() { // evaluation as Σ coef × PV[idx], sente's view
    TR = new Float64Array(NPAR);
    const v = evaluate(), t = TR;
    TR = null;
    const idx = [], coef = [];
    for (let k = 0; k < NPAR; k++) if (t[k]) { idx.push(k); coef.push(t[k]); }
    return { idx, coef, value: side === SENTE ? v : -v };
  }
  function qscore() { nodes = 0; stopped = false; deadline = 0; maxNodes = 0; ply = 0; return qsearch(-INF, INF, 0, 0); }

  setFen(START);
  return {
    SENTE, GOTE, P, L, N, S, G, B, R, K, PP, PL, PN, PS, PB, PR, MATE, MATE_BOUND, DECLARE, PLY_LIMIT, UNPRO, PROMOTE_TO,
    setStart() { setFen(START); }, setFen, fen, legalMoves, play: make, undo: unmake, think, evaluate, qscore, features, perft, status, inCheck, canDeclare, ttClear,
    uci, sqName, mFrom, mTo, isDrop, isPromo, isCap, hand: (c, t) => hand[c * 8 + t], PDEF, params: () => PV.slice(), repCount,
    get loser() { return loser; }, get side() { return side; }, get board() { return board; }, get kings() { return kingSq.slice(); }, get plies() { return un; },
  };
}
if (typeof module !== 'undefined') module.exports = { ShogiEngine };

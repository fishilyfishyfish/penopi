// LOA engine, copied verbatim from loa-turk/index.html (LoaEngine + self-play tuned weights).
// Loaded as a plain script; the page builds its Web Worker from LoaEngine.toString().
/* =====================================================================
   LOA (Lines of Action) engine
   Rules (MSO / Computer Olympiad set, as on Winands' rules page):
     - 8x8, black on top+bottom rows, white on left+right columns, black moves first
     - move along a line exactly as many squares as there are pieces on that line
     - may jump own pieces, may not jump enemy pieces, capture by landing
     - connect all own pieces (8-neighbourhood) to win; single piece = connected
     - a move that connects both sides at once = draw
     - no legal move = pass
     - same position with same side to move a 3rd time = draw
   ===================================================================== */
function LoaEngine(opts) {
  "use strict";
  opts = opts || {};
  const WIN = 30000, MATE_BOUND = 29000, INF = 32000, MAXPLY = 128;
  const NF = 24; // features per side

  /* ---------------- geometry ---------------- */
  const DR = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, -1, 0, 0, 1, -1, -1, 1];
  const LINES = new Int8Array(256);
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, c = s & 7;
    LINES[s * 4] = r; LINES[s * 4 + 1] = 8 + c;
    LINES[s * 4 + 2] = 16 + (r - c + 7); LINES[s * 4 + 3] = 31 + (r + c);
  }
  const RAY = new Int8Array(64 * 8 * 8).fill(-1), RLEN = new Int8Array(512);
  for (let s = 0; s < 64; s++) for (let d = 0; d < 8; d++) {
    let r = s >> 3, c = s & 7, k = 0;
    for (;;) {
      r += DR[d]; c += DC[d];
      if (r < 0 || r > 7 || c < 0 || c > 7) break;
      RAY[(s * 8 + d) * 8 + k] = r * 8 + c; k++;
    }
    RLEN[s * 8 + d] = k;
  }
  const NBS = new Int16Array(65), NB = new Int8Array(64 * 8);
  { let k = 0;
    for (let s = 0; s < 64; s++) {
      NBS[s] = k;
      const r = s >> 3, c = s & 7;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) NB[k++] = rr * 8 + cc;
      }
    }
    NBS[64] = k; }
  // square classes (8-fold symmetry) for the piece-square table
  const CLS = new Int8Array(64), RING = new Int8Array(64);
  { const map = {};
    const order = ["0,0", "0,1", "0,2", "0,3", "1,1", "1,2", "1,3", "2,2", "2,3", "3,3"];
    order.forEach((k, i) => (map[k] = i));
    for (let s = 0; s < 64; s++) {
      const r = s >> 3, c = s & 7;
      let a = Math.min(r, 7 - r), b = Math.min(c, 7 - c);
      if (a > b) { const t = a; a = b; b = t; }
      CLS[s] = map[a + "," + b]; RING[s] = a;
    } }
  const MINSUM = new Int16Array(16);
  for (let n = 0; n < 16; n++) MINSUM[n] = n <= 1 ? 0 : n <= 9 ? n - 1 : 8 + 2 * (n - 9);
  const CHEB = new Int8Array(64 * 64);
  for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++)
    CHEB[a * 64 + b] = Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));

  /* ---------------- zobrist ---------------- */
  let seed = 0x9e3779b9 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(192), Z2 = new Int32Array(192);
  for (let i = 0; i < 192; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();

  /* ---------------- state ---------------- */
  const board = new Int8Array(64);
  const plist = [null, new Int8Array(16), new Int8Array(16)];
  const pcount = new Int8Array(3);
  const pidx = new Int8Array(64);
  const lineCnt = new Int8Array(46);
  let stm = 1, h1 = 0, h2 = 0, posId = 1;
  const HMAX = 4096;
  const HIST1 = new Int32Array(HMAX), HIST2 = new Int32Array(HMAX), HREV = new Int16Array(HMAX);
  let hp = 0;

  function clearBoard() {
    board.fill(0); pcount.fill(0); lineCnt.fill(0); h1 = 0; h2 = 0;
  }
  function addPiece(s, p) {
    board[s] = p; pidx[s] = pcount[p]; plist[p][pcount[p]++] = s;
    for (let a = 0; a < 4; a++) lineCnt[LINES[s * 4 + a]]++;
    h1 ^= Z1[p * 64 + s]; h2 ^= Z2[p * 64 + s];
  }
  function setPosition(arr, side) {
    clearBoard(); posId++;
    for (let s = 0; s < 64; s++) if (arr[s]) addPiece(s, arr[s]);
    stm = side;
    if (side === 2) { h1 ^= ZS1; h2 ^= ZS2; }
    hp = 0; HIST1[0] = h1; HIST2[0] = h2; HREV[0] = 0;
  }
  function startArray() {
    const b = new Int8Array(64);
    for (let c = 1; c <= 6; c++) { b[c] = 1; b[56 + c] = 1; }
    for (let r = 1; r <= 6; r++) { b[r * 8] = 2; b[r * 8 + 7] = 2; }
    return b;
  }

  // move encoding: from | to<<6 | capture<<12 ; PASS = 8191 is not used as a board move
  const PASS = 8191;
  function make(m) {
    const f = m & 63, t = (m >> 6) & 63, p = board[f], o = 3 - p;
    if (m & 4096) {
      const i = pidx[t], last = plist[o][--pcount[o]];
      plist[o][i] = last; pidx[last] = i;
      h1 ^= Z1[o * 64 + t]; h2 ^= Z2[o * 64 + t];
    } else {
      lineCnt[LINES[t * 4]]++; lineCnt[LINES[t * 4 + 1]]++; lineCnt[LINES[t * 4 + 2]]++; lineCnt[LINES[t * 4 + 3]]++;
    }
    lineCnt[LINES[f * 4]]--; lineCnt[LINES[f * 4 + 1]]--; lineCnt[LINES[f * 4 + 2]]--; lineCnt[LINES[f * 4 + 3]]--;
    board[f] = 0; board[t] = p;
    const i = pidx[f]; plist[p][i] = t; pidx[t] = i;
    h1 ^= Z1[p * 64 + f] ^ Z1[p * 64 + t] ^ ZS1;
    h2 ^= Z2[p * 64 + f] ^ Z2[p * 64 + t] ^ ZS2;
    stm = o; posId++;
    hp++; HIST1[hp] = h1; HIST2[hp] = h2; HREV[hp] = (m & 4096) ? hp : HREV[hp - 1];
  }
  function unmake(m) {
    hp--;
    const f = m & 63, t = (m >> 6) & 63, p = board[t], o = 3 - p;
    board[f] = p;
    const i = pidx[t]; plist[p][i] = f; pidx[f] = i;
    lineCnt[LINES[f * 4]]++; lineCnt[LINES[f * 4 + 1]]++; lineCnt[LINES[f * 4 + 2]]++; lineCnt[LINES[f * 4 + 3]]++;
    if (m & 4096) {
      board[t] = o; pidx[t] = pcount[o]; plist[o][pcount[o]++] = t;
      h1 ^= Z1[o * 64 + t]; h2 ^= Z2[o * 64 + t];
    } else {
      board[t] = 0;
      lineCnt[LINES[t * 4]]--; lineCnt[LINES[t * 4 + 1]]--; lineCnt[LINES[t * 4 + 2]]--; lineCnt[LINES[t * 4 + 3]]--;
    }
    h1 ^= Z1[p * 64 + f] ^ Z1[p * 64 + t] ^ ZS1;
    h2 ^= Z2[p * 64 + f] ^ Z2[p * 64 + t] ^ ZS2;
    stm = p; posId++;
  }
  function makePass() {
    h1 ^= ZS1; h2 ^= ZS2; stm = 3 - stm;
    hp++; HIST1[hp] = h1; HIST2[hp] = h2; HREV[hp] = hp;
  }
  function unmakePass() { hp--; h1 ^= ZS1; h2 ^= ZS2; stm = 3 - stm; }

  function genMoves(side, out, n0) {
    let n = n0;
    const opp = 3 - side, pl = plist[side], cnt = pcount[side];
    for (let i = 0; i < cnt; i++) {
      const s = pl[i], s4 = s * 4, s8 = s * 8;
      for (let a = 0; a < 4; a++) {
        const k = lineCnt[LINES[s4 + a]];
        for (let d = 2 * a; d < 2 * a + 2; d++) {
          if (k > RLEN[s8 + d]) continue;
          const base = (s8 + d) * 8, t = RAY[base + k - 1], bt = board[t];
          if (bt === side) continue;
          let ok = true;
          for (let j = 0; j < k - 1; j++) if (board[RAY[base + j]] === opp) { ok = false; break; }
          if (ok) out[n++] = s | (t << 6) | (bt ? 4096 : 0);
        }
      }
    }
    return n;
  }

  /* ---------------- connectivity ---------------- */
  const STAMP = new Int32Array(64); let stampId = 1;
  const STK = new Int8Array(64);
  const LAB = new Int8Array(64), GSIZE = new Int8Array(48), LABTAG = new Int32Array(3), LABG = new Int8Array(3);
  function bump() { if (++stampId > 2000000000) { STAMP.fill(0); stampId = 1; } return stampId; }
  function connected(side) {
    const n = pcount[side];
    if (n <= 1) return true;
    const st = bump(), pl = plist[side];
    let sp = 0, seen = 1;
    STK[sp++] = pl[0]; STAMP[pl[0]] = st;
    while (sp) {
      const x = STK[--sp];
      for (let j = NBS[x], e = NBS[x + 1]; j < e; j++) {
        const y = NB[j];
        if (board[y] === side && STAMP[y] !== st) {
          STAMP[y] = st; STK[sp++] = y;
          if (++seen === n) return true;
        }
      }
    }
    return false;
  }
  // labels groups of side into LAB / GSIZE, returns group count
  function label(side) {
    if (LABTAG[side] === posId) return LABG[side];
    const n = pcount[side], pl = plist[side], st = bump(), gb = side * 16;
    let g = 0;
    for (let i = 0; i < n; i++) {
      const s0 = pl[i];
      if (STAMP[s0] === st) continue;
      let sp = 0, size = 1;
      STK[sp++] = s0; STAMP[s0] = st; LAB[s0] = g;
      while (sp) {
        const x = STK[--sp];
        for (let j = NBS[x], e = NBS[x + 1]; j < e; j++) {
          const y = NB[j];
          if (board[y] === side && STAMP[y] !== st) { STAMP[y] = st; LAB[y] = g; STK[sp++] = y; size++; }
        }
      }
      GSIZE[gb + g++] = size;
    }
    LABTAG[side] = posId; LABG[side] = g;
    return g;
  }
  // result after a move made by `mover`: 1 mover wins, -1 mover loses, 2 draw, 0 nothing
  function resultAfter(mover, wasCapture) {
    const me = connected(mover);
    const op = wasCapture ? connected(3 - mover) : false;
    if (me && op) return 2;
    if (me) return 1;
    if (op) return -1;
    return 0;
  }
  // can `side` win with one move right now (as if it were side's turn)?
  // Filter: the landing square must touch every group except (possibly) the mover's own singleton group.
  const ADJ = new Int32Array(64), ADJS = new Int32Array(64), GOOD = new Int32Array(64);
  let adjStamp = 0;
  function canWinNow(side) {
    const n = pcount[side];
    if (n <= 1) return true;
    const g = label(side);
    if (g === 1) return true;
    if (g > 5) return false;
    const full = (1 << g) - 1, gb = side * 16, pl = plist[side];
    const st = ++adjStamp;
    // OR of neighbouring group bits for every square
    for (let i = 0; i < n; i++) {
      const s = pl[i], bit = 1 << LAB[s];
      for (let j = NBS[s], e = NBS[s + 1]; j < e; j++) {
        const t = NB[j];
        if (ADJS[t] !== st) { ADJS[t] = st; ADJ[t] = bit; } else ADJ[t] |= bit;
      }
    }
    // singleton groups mask
    let single = 0;
    for (let k = 0; k < g; k++) if (GSIZE[gb + k] === 1) single |= 1 << k;
    // landing squares that could work for some mover
    let any = false;
    for (let i = 0; i < n; i++) {
      const s = pl[i];
      for (let j = NBS[s], e = NBS[s + 1]; j < e; j++) {
        const t = NB[j];
        if (board[t] === side || GOOD[t] === st) continue;
        const m = ADJ[t], miss = full & ~m;
        if (miss === 0 || ((miss & (miss - 1)) === 0 && (miss & single))) { GOOD[t] = st; any = true; }
      }
    }
    if (!any) return false;
    const opp = 3 - side;
    for (let i = 0; i < n; i++) {
      const f = pl[i], f4 = f * 4, f8 = f * 8;
      for (let a = 0; a < 4; a++) {
        const k = lineCnt[LINES[f4 + a]];
        for (let d = 2 * a; d < 2 * a + 2; d++) {
          if (k > RLEN[f8 + d]) continue;
          const base = (f8 + d) * 8, t = RAY[base + k - 1];
          if (GOOD[t] !== st) continue;
          const bt = board[t];
          if (bt === side) continue;
          // exact neighbour test without the mover
          const need = GSIZE[gb + LAB[f]] === 1 ? full & ~(1 << LAB[f]) : full;
          let mask = 0;
          for (let j = NBS[t], e = NBS[t + 1]; j < e; j++) {
            const y = NB[j];
            if (y !== f && board[y] === side) mask |= 1 << LAB[y];
          }
          if ((mask & need) !== need) continue;
          let ok = true;
          for (let j = 0; j < k - 1; j++) if (board[RAY[base + j]] === opp) { ok = false; break; }
          if (!ok) continue;
          const m = f | (t << 6) | (bt ? 4096 : 0);
          const saveStm = stm, savePos = posId;
          make(m);
          const r = resultAfter(side, bt !== 0);
          unmake(m);
          stm = saveStm;
          // same position again: keep the cached labels valid
          if (LABTAG[1] === savePos) LABTAG[1] = posId;
          if (LABTAG[2] === savePos) LABTAG[2] = posId;
          if (r === 1) return true;
        }
      }
    }
    return false;
  }

  /* ---------------- evaluation ---------------- */
  const QW = new Int8Array(81), QS = new Int32Array(81);
  const MBUF = new Int32Array(256);
  let useMobility = true;
  // writes NF raw features for `side` into F at offset off
  function features(side, F, off) {
    for (let i = 0; i < NF; i++) F[off + i] = 0;
    const n = pcount[side], pl = plist[side];
    if (n === 0) return;
    let sr = 0, sc = 0, minR = 9, maxR = -1, minC = 9, maxC = -1;
    for (let i = 0; i < n; i++) {
      const s = pl[i], r = s >> 3, c = s & 7;
      sr += r; sc += c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      F[off + CLS[s]] += 1;
    }
    const comR = Math.round(sr / n), comC = Math.round(sc / n), com = comR * 8 + comC;
    let sum = 0, mx = 0, far = 0;
    for (let i = 0; i < n; i++) {
      const dd = CHEB[pl[i] * 64 + com];
      sum += dd; if (dd > mx) mx = dd; if (dd >= 3) far++;
    }
    const conc = sum - MINSUM[n];
    F[off + 22] = mx; F[off + 23] = far;
    F[off + 10] = conc;
    F[off + 11] = conc / n;
    const g = label(side);
    F[off + 12] = g - 1;
    F[off + 21] = (g - 1) * (g - 1);
    // neighbours, isolated, quads
    let iso = 0, conn = 0, quads = 0;
    const st = bump();
    for (let i = 0; i < n; i++) {
      const s = pl[i], r = s >> 3, c = s & 7;
      let nb = 0;
      for (let j = NBS[s], e = NBS[s + 1]; j < e; j++) if (board[NB[j]] === side) nb++;
      conn += nb; if (!nb) iso++;
      // windows with top-left (r-1..r, c-1..c), index (wr+1)*9+(wc+1)
      const w0 = r * 9 + c; // window (r-1,c-1)
      for (let q = 0; q < 4; q++) {
        const w = w0 + (q & 1) + (q >> 1) * 9;
        if (QS[w] !== st) { QS[w] = st; QW[w] = 0; }
        if (++QW[w] === 3) quads++;
      }
    }
    F[off + 13] = iso;
    F[off + 14] = conn / 2;
    F[off + 15] = quads;
    F[off + 16] = (maxR - minR + 1) * (maxC - minC + 1) - n;
    F[off + 17] = Math.max(Math.abs(sr / n - 3.5), Math.abs(sc / n - 3.5));
    if (useMobility) {
      const m = genMoves(side, MBUF, 0);
      let caps = 0, edge = 0;
      for (let i = 0; i < m; i++) {
        const mv = MBUF[i];
        if (mv & 4096) caps++;
        else if (RING[(mv >> 6) & 63] === 0) edge++;
      }
      F[off + 18] = m; F[off + 19] = caps; F[off + 20] = edge;
    }
  }
  const FEAT_NAMES = ["pst_corner", "pst_0_1", "pst_0_2", "pst_0_3", "pst_1_1", "pst_1_2", "pst_1_3", "pst_2_2",
    "pst_2_3", "pst_center", "conc", "conc_per", "groups", "isolated", "conn_pairs", "quads", "box_holes",
    "com_offcenter", "mobility", "cap_moves", "edge_moves", "groups_sq", "max_dist", "far_pieces"];

  // weights: WO = opening (24 pieces), WE = ending; tempo
  let WO = new Float64Array(NF), WE = new Float64Array(NF), TEMPO_O = 0, TEMPO_E = 0;
  let evalMode = "full";
  // optional small neural correction on top of the linear eval (antisymmetric by construction)
  let MLP = null;
  const NA = new Float64Array(NF), NBF = new Float64Array(NF);
  function setWeights(w) {
    if (w.mlp) {
      const m = w.mlp, H = m.H;
      MLP = { H, mu: Float64Array.from(m.mu), isd: Float64Array.from(m.sd.map((x) => 1 / x)),
              W1: Float64Array.from(m.W1), b1: Float64Array.from(m.b1), w2: Float64Array.from(m.w2),
              ha: new Float64Array(H), hb: new Float64Array(H) };
    } else if (w.WO) MLP = null;
    const pad = (a) => { const o = new Float64Array(NF); for (let i = 0; i < Math.min(NF, a.length); i++) o[i] = a[i]; return o; };
    if (w.WO) WO = pad(w.WO);
    if (w.WE) WE = pad(w.WE);
    if (w.TEMPO_O !== undefined) TEMPO_O = w.TEMPO_O;
    if (w.TEMPO_E !== undefined) TEMPO_E = w.TEMPO_E;
  }
  // hand-made starting weights (before tuning)
  (function initWeights() {
    const w = new Float64Array(NF);
    for (let s = 0; s < 10; s++) w[s] = 0;
    w[1] = 4; w[2] = 8; w[3] = 8; w[4] = 10; w[5] = 14; w[6] = 16; w[7] = 20; w[8] = 22; w[9] = 24;
    w[10] = -14; w[11] = -40; w[12] = -40; w[13] = -25; w[14] = 4; w[15] = 12; w[16] = -2; w[17] = -10;
    w[18] = 2; w[19] = 1; w[20] = -1; w[21] = -4;
    WO = Float64Array.from(w); WE = Float64Array.from(w); TEMPO_O = 10; TEMPO_E = 20;
  })();

  const FS = new Float64Array(NF * 2);
  function evaluate() {
    const p = stm, o = 3 - p;
    if (evalMode === "old") {
      // the previous engine's style: concentration, groups, centre
      return oldSide(p) - oldSide(o);
    }
    features(p, FS, 0); features(o, FS, NF);
    const tot = pcount[1] + pcount[2], ph = tot >= 24 ? 1 : tot <= 10 ? 0 : (tot - 10) / 14;
    let v = TEMPO_E + (TEMPO_O - TEMPO_E) * ph;
    for (let i = 0; i < NF; i++) v += (FS[i] - FS[NF + i]) * (WE[i] + (WO[i] - WE[i]) * ph);
    if (MLP && P.useMlp !== false) v += mlpEval(ph);
    v = Math.round(v);
    return v > 20000 ? 20000 : v < -20000 ? -20000 : v;
  }
  // h(x) for x = [a, b, ph] with W1 stored row-major (2NF+1) x H ; returns 300 * (w2.relu(h(a,b)) - w2.relu(h(b,a)))
  function mlpEval(ph) {
    const M = MLP, H = M.H, W1 = M.W1, mu = M.mu, isd = M.isd, ha = M.ha, hb = M.hb;
    for (let i = 0; i < NF; i++) { NA[i] = (FS[i] - mu[i]) * isd[i]; NBF[i] = (FS[NF + i] - mu[i]) * isd[i]; }
    const pr = 2 * NF * H;
    for (let j = 0; j < H; j++) { const c = M.b1[j] + W1[pr + j] * ph; ha[j] = c; hb[j] = c; }
    for (let i = 0; i < NF; i++) {
      const a = NA[i], b = NBF[i], ra = i * H, rb = (NF + i) * H;
      if (a === 0 && b === 0) continue;
      for (let j = 0; j < H; j++) {
        const wa = W1[ra + j], wb = W1[rb + j];
        ha[j] += a * wa + b * wb;
        hb[j] += b * wa + a * wb;
      }
    }
    let out = 0;
    for (let j = 0; j < H; j++) {
      const x = ha[j] > 0 ? ha[j] : 0, y = hb[j] > 0 ? hb[j] : 0;
      out += (x - y) * M.w2[j];
    }
    return 300 * out;
  }
  function oldSide(p) {
    const n = pcount[p], pl = plist[p];
    if (!n) return 0;
    let sr = 0, sc = 0, cen = 0;
    for (let i = 0; i < n; i++) { sr += pl[i] >> 3; sc += pl[i] & 7; cen += RING[pl[i]] * 2; }
    const com = Math.round(sr / n) * 8 + Math.round(sc / n);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += CHEB[pl[i] * 64 + com];
    return -32 * (sum - MINSUM[n]) - 110 * (label(p) - 1) + 3 * cen;
  }
  // both sides' raw features (for training other model shapes)
  function sideFeatures() {
    features(stm, FS, 0); features(3 - stm, FS, NF);
    return { me: Array.from(FS.subarray(0, NF)), op: Array.from(FS.subarray(NF, 2 * NF)), tot: pcount[1] + pcount[2] };
  }
  // feature vector for tuning: [diff features..., phase] from side-to-move view
  function featureVector() {
    features(stm, FS, 0); features(3 - stm, FS, NF);
    const out = new Float64Array(NF + 1);
    for (let i = 0; i < NF; i++) out[i] = FS[i] - FS[NF + i];
    out[NF] = (pcount[1] + pcount[2]) / 24;
    return out;
  }

  /* ---------------- transposition table ---------------- */
  const TT_BITS = opts.ttBits || 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const TK = new Int32Array(TT_SIZE), TV = new Int32Array(TT_SIZE); // TV = check hash h1
  const TM = new Int16Array(TT_SIZE), TSC = new Int16Array(TT_SIZE);
  const TD = new Int8Array(TT_SIZE), TF = new Int8Array(TT_SIZE), TG = new Int8Array(TT_SIZE);
  let gen = 0;
  const EXACT = 1, LOWER = 2, UPPER = 3;
  let ttHitMove = 0, ttHitScore = 0, ttHitDepth = -1, ttHitFlag = 0;
  function ttProbe(ply) {
    const b = h1 & TT_MASK & ~1;
    for (let i = b; i < b + 2; i++) {
      if (TF[i] && TK[i] === h2 && TV[i] === h1) {
        ttHitMove = TM[i]; ttHitDepth = TD[i]; ttHitFlag = TF[i];
        let s = TSC[i];
        if (s >= MATE_BOUND) s -= ply; else if (s <= -MATE_BOUND) s += ply;
        ttHitScore = s;
        return true;
      }
    }
    ttHitMove = 0; ttHitDepth = -1; ttHitFlag = 0;
    return false;
  }
  function ttStore(ply, depth, flag, score, move) {
    const b = h1 & TT_MASK & ~1;
    let i;
    if (TF[b] && TK[b] === h2 && TV[b] === h1) i = b;
    else if (TF[b + 1] && TK[b + 1] === h2 && TV[b + 1] === h1) i = b + 1;
    else if (!TF[b] || TG[b] !== gen || TD[b] <= depth) i = b;
    else i = b + 1;
    if (score >= MATE_BOUND) score += ply; else if (score <= -MATE_BOUND) score -= ply;
    if (TK[i] === h2 && TV[i] === h1 && !move) move = TM[i];
    TK[i] = h2; TV[i] = h1; TM[i] = move; TSC[i] = score; TD[i] = depth; TF[i] = flag; TG[i] = gen;
  }
  function ttClear() { TF.fill(0); }

  /* ---------------- search ---------------- */
  const MV = [], SC = [];
  for (let i = 0; i < MAXPLY + 2; i++) { MV.push(new Int32Array(256)); SC.push(new Int32Array(256)); }
  const KIL = new Int32Array((MAXPLY + 2) * 2);
  const HISTO = new Int32Array(3 * 4096);
  const PVT = new Int32Array((MAXPLY + 2) * (MAXPLY + 2)), PVL = new Int32Array(MAXPLY + 2);
  const LMR = [];
  for (let d = 0; d < 64; d++) { LMR.push(new Int8Array(256));
    for (let i = 0; i < 256; i++) LMR[d][i] = d < 2 || i < 2 ? 0 : Math.floor(0.6 + Math.log(d) * Math.log(i) / 2.3); }

  let nodes = 0, stopped = false, deadline = 0, maxNodes = 0, selDepth = 0;
  let P = {}; // search parameters / feature switches
  const DEFAULTS = { nullMove: true, lmr: true, killers: true, qThreat: true, threatExt: true,
                     winCheck: true, mobility: false, evalMode: "full", aspiration: true, qMax: 4 };

  function isRep() {
    for (let j = hp - 2; j >= HREV[hp]; j -= 2) if (HIST1[j] === h1 && HIST2[j] === h2) return true;
    return false;
  }
  function checkStop() {
    if (maxNodes && nodes >= maxNodes) stopped = true;
    else if (deadline && Date.now() >= deadline) stopped = true;
  }

  function orderMoves(n, ply, ttMove) {
    const ms = MV[ply], sc = SC[ply], side = stm, hb = side * 4096;
    // own centre of mass (used for "move towards the group")
    const pl = plist[side], cnt = pcount[side];
    let sr = 0, scc = 0;
    for (let i = 0; i < cnt; i++) { sr += pl[i] >> 3; scc += pl[i] & 7; }
    const com = Math.round(sr / cnt) * 8 + Math.round(scc / cnt);
    const k1 = KIL[ply * 2], k2 = KIL[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      if (m === ttMove) { sc[i] = 1 << 30; continue; }
      if (P.killers && (m === k1)) { sc[i] = (1 << 29); continue; }
      if (P.killers && (m === k2)) { sc[i] = (1 << 29) - 1; continue; }
      const f = m & 63, t = (m >> 6) & 63;
      let v = (CHEB[f * 64 + com] - CHEB[t * 64 + com]) * 400 + (RING[t] - RING[f]) * 150;
      if (m & 4096) v += 600;
      sc[i] = v + HISTO[hb + (m & 4095)];
    }
  }
  function pickNext(i, n, ply) {
    const ms = MV[ply], sc = SC[ply];
    let b = i, bv = sc[i];
    for (let j = i + 1; j < n; j++) if (sc[j] > bv) { bv = sc[j]; b = j; }
    if (b !== i) { const t = ms[i]; ms[i] = ms[b]; ms[b] = t; const u = sc[i]; sc[i] = sc[b]; sc[b] = u; }
    return ms[i];
  }
  function histUpdate(side, m, bonus) {
    const i = side * 4096 + (m & 4095);
    HISTO[i] += bonus - Math.trunc(HISTO[i] * Math.abs(bonus) / 16384);
  }

  function qsearch(alpha, beta, ply, qd) {
    nodes++;
    if ((nodes & 1023) === 0) checkStop();
    if (stopped) return 0;
    if (ply > selDepth) selDepth = ply;
    PVL[ply] = 0;
    if (ply >= MAXPLY - 1) return evaluate();
    if (canWinNow(stm)) return WIN - ply - 1;
    const threat = P.qThreat && canWinNow(3 - stm);
    if (!threat) return evaluate();
    if (qd >= P.qMax) return evaluate() - 400; // unresolved threat: assume it costs something
    // opponent threatens to connect: try every move that might stop it
    const ms = MV[ply];
    const n = genMoves(stm, ms, 0);
    if (!n) return -WIN + ply + 2;
    let best = -WIN + ply + 2;
    for (let i = 0; i < n; i++) {
      const m = ms[i], me = stm;
      make(m);
      const r = resultAfter(me, (m & 4096) !== 0);
      let s;
      if (r === 1) s = WIN - ply - 1;
      else if (r === -1) s = -WIN + ply + 1;
      else if (r === 2) s = 0;
      else s = -qsearch(-beta, -alpha, ply + 1, qd + 1);
      unmake(m);
      if (stopped) return 0;
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          PVT[ply * (MAXPLY + 2)] = m;
          const cl = PVL[ply + 1];
          for (let j = 0; j < cl; j++) PVT[ply * (MAXPLY + 2) + 1 + j] = PVT[(ply + 1) * (MAXPLY + 2) + j];
          PVL[ply] = cl + 1;
          if (s >= beta) break;
        }
      }
    }
    return best;
  }

  function search(depth, alpha, beta, ply, isPV, canNull, lastPass) {
    PVL[ply] = 0;
    if (ply > 0) {
      if (isRep()) return 0;
      // mate distance pruning
      const ma = -WIN + ply, mb = WIN - ply - 1;
      if (alpha < ma) alpha = ma;
      if (beta > mb) beta = mb;
      if (alpha >= beta) return alpha;
    }
    if (depth <= 0) return qsearch(alpha, beta, ply, 0);
    nodes++;
    if ((nodes & 1023) === 0) checkStop();
    if (stopped) return 0;
    if (ply > selDepth) selDepth = ply;
    if (ply >= MAXPLY - 1) return evaluate();

    let ttMove = 0;
    if (ttProbe(ply)) {
      ttMove = ttHitMove;
      if (!isPV && ttHitDepth >= depth) {
        const s = ttHitScore;
        if (ttHitFlag === EXACT || (ttHitFlag === LOWER && s >= beta) || (ttHitFlag === UPPER && s <= alpha)) return s;
      }
    }
    if (P.winCheck && canWinNow(stm)) return WIN - ply - 1;

    const inThreat = (P.threatExt || P.nullMove) ? canWinNow(3 - stm) : false;
    if (inThreat && P.threatExt && ply < 2 * rootDepth + 4) depth++;

    // null move
    if (P.nullMove && !isPV && canNull && !inThreat && depth >= 3 && beta < MATE_BOUND && beta > -MATE_BOUND) {
      const ev = evaluate();
      if (ev >= beta) {
        const R = 3 + (depth >> 2);
        makePass();
        const s = -search(depth - 1 - R, -beta, -beta + 1, ply + 1, false, false, false);
        unmakePass();
        if (stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    const ms = MV[ply];
    const n = genMoves(stm, ms, 0);
    if (n === 0) {
      if (lastPass) return 0; // nobody can move
      makePass();
      const s = -search(depth - 1, -beta, -alpha, ply + 1, isPV, false, true);
      unmakePass();
      return s;
    }
    orderMoves(n, ply, ttMove);
    const a0 = alpha, side = stm;
    let best = -INF, bestMove = 0, searched = 0;
    let qn = 0;
    const QB = QBUF[ply];
    for (let i = 0; i < n; i++) {
      const m = pickNext(i, n, ply);
      make(m);
      const r = resultAfter(side, (m & 4096) !== 0);
      let s;
      if (r === 1) s = WIN - ply - 1;
      else if (r === -1) s = -WIN + ply + 1;
      else if (r === 2) s = 0;
      else {
        const quiet = !(m & 4096) && m !== ttMove && SC[ply][i] < (1 << 29) - 1;
        let red = 0;
        if (P.lmr && depth >= 3 && searched >= 3 && quiet && !inThreat) {
          red = LMR[Math.min(depth, 63)][Math.min(i, 255)];
          if (isPV) red = Math.max(0, red - 1);
          if (red > depth - 2) red = depth - 2;
        }
        if (searched === 0) s = -search(depth - 1, -beta, -alpha, ply + 1, isPV, true, false);
        else {
          s = -search(depth - 1 - red, -alpha - 1, -alpha, ply + 1, false, true, false);
          if (s > alpha && red > 0) s = -search(depth - 1, -alpha - 1, -alpha, ply + 1, false, true, false);
          if (s > alpha && s < beta) s = -search(depth - 1, -beta, -alpha, ply + 1, true, true, false);
        }
      }
      unmake(m);
      if (stopped) return 0;
      searched++;
      if (s > best) {
        best = s; bestMove = m;
        if (s > alpha) {
          alpha = s;
          const row = ply * (MAXPLY + 2), nrow = (ply + 1) * (MAXPLY + 2);
          PVT[row] = m;
          const cl = PVL[ply + 1];
          for (let j = 0; j < cl; j++) PVT[row + 1 + j] = PVT[nrow + j];
          PVL[ply] = cl + 1;
          if (s >= beta) {
            if (!(m & 4096)) {
              if (P.killers && KIL[ply * 2] !== m) { KIL[ply * 2 + 1] = KIL[ply * 2]; KIL[ply * 2] = m; }
              histUpdate(side, m, depth * depth);
              for (let j = 0; j < qn; j++) histUpdate(side, QB[j], -depth * depth);
            }
            break;
          }
        }
      }
      if (!(m & 4096) && qn < 255) QB[qn++] = m;
    }
    ttStore(ply, depth, best <= a0 ? UPPER : best >= beta ? LOWER : EXACT, best, bestMove);
    return best;
  }
  const QBUF = [];
  for (let i = 0; i < MAXPLY + 2; i++) QBUF.push(new Int32Array(256));

  let rootDepth = 0;
  // root search with iterative deepening; returns info object
  function think(cfg) {
    cfg = cfg || {};
    P = Object.assign({}, DEFAULTS, cfg.params || {});
    useMobility = P.mobility;
    evalMode = P.evalMode;
    const t0 = Date.now();
    const timeMs = cfg.time || 0;
    maxNodes = cfg.nodes || 0;
    deadline = timeMs ? t0 + timeMs : 0;
    const softMs = timeMs ? timeMs * (cfg.soft || 0.5) : 0;
    const maxDepth = cfg.depth || 64;
    nodes = 0; stopped = false; selDepth = 0;
    gen = (gen + 1) & 127;
    if (cfg.clearTT) ttClear();
    if (!cfg.keepHistory) { HISTO.fill(0); KIL.fill(0); }
    else for (let i = 0; i < HISTO.length; i++) HISTO[i] >>= 2;

    const root = new Int32Array(256);
    let n = genMoves(stm, root, 0);
    if (cfg.avoid && cfg.avoid.length) { // leave these root moves out (unless nothing else is left)
      let k = 0;
      for (let i = 0; i < n; i++) if (!cfg.avoid.includes(root[i])) root[k++] = root[i];
      if (k) n = k;
    }
    const info = { move: -1, score: 0, depth: 0, pv: [], nodes: 0, ms: 0, sel: 0, side: stm, iters: [] };
    if (n === 0) { info.move = PASS; info.ms = Date.now() - t0; return info; }
    // immediate wins
    const side = stm;
    for (let i = 0; i < n; i++) {
      make(root[i]); const r = resultAfter(side, (root[i] & 4096) !== 0); unmake(root[i]);
      if (r === 1) { info.move = root[i]; info.score = WIN - 1; info.depth = 1; info.pv = [root[i]]; info.lines = [{ move: root[i], score: WIN - 1, pv: [root[i]] }]; info.ms = Date.now() - t0; return info; }
    }
    if (n === 1 && !cfg.analysis && !(cfg.multi > 1)) { info.move = root[0]; info.depth = 0; info.pv = [root[0]]; info.ms = Date.now() - t0; return info; }

    const rs = new Int32Array(n); // ordering scores
    { const ms = MV[0]; for (let i = 0; i < n; i++) ms[i] = root[i];
      orderMoves(n, 0, 0);
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => SC[0][b] - SC[0][a]);
      for (let i = 0; i < n; i++) { root[i] = ms[idx[i]]; rs[i] = n - i; } }
    if (cfg.multi > 1) return thinkMulti(cfg, root, n, rs, t0, softMs, maxDepth, info);
    let bestMove = root[0], bestScore = -INF, prevScore = 0, stable = 0, lastPV = [root[0]];
    for (let d = 1; d <= maxDepth; d++) {
      rootDepth = d;
      let alpha, beta, delta = 40;
      if (P.aspiration && d >= 4 && Math.abs(prevScore) < MATE_BOUND) { alpha = prevScore - delta; beta = prevScore + delta; }
      else { alpha = -INF; beta = INF; }
      let iterBest = 0, iterScore = -INF, iterPV = null;
      for (;;) {
        // order: previous best first, then by last iteration's node counts
        const r = rootIter(d, alpha, beta, root, n, rs, bestMove);
        if (stopped) {
          // keep partial result if it found a better move than before after searching the first
          if (r.completedFirst && r.move) { iterBest = r.move; iterScore = r.score; iterPV = r.pv; }
          break;
        }
        if (r.score <= alpha) { alpha = Math.max(-INF, alpha - delta); delta *= 2; if (delta > 1000) alpha = -INF; continue; }
        if (r.score >= beta) { beta = Math.min(INF, beta + delta); delta *= 2; if (delta > 1000) beta = INF; continue; }
        iterBest = r.move; iterScore = r.score; iterPV = r.pv;
        break;
      }
      if (iterBest) {
        if (iterBest === bestMove) stable++; else stable = 0;
        bestMove = iterBest; bestScore = iterScore; prevScore = iterScore; lastPV = iterPV;
        if (!stopped) info.depth = d;
      }
      if (stopped) break;
      const el = Date.now() - t0;
      info.iters.push({ d, score: bestScore, ms: el, nodes });
      if (cfg.onInfo) cfg.onInfo({ depth: d, score: bestScore, pv: lastPV.slice(), nodes, ms: el, sel: selDepth });
      if (Math.abs(bestScore) >= MATE_BOUND && d >= 2 && WIN - Math.abs(bestScore) <= d) break;
      if (softMs) {
        let lim = softMs;
        if (stable >= 3) lim *= 0.6;
        if (el >= lim) break;
      }
      if (maxNodes && nodes >= maxNodes * 0.6) break;
    }
    info.move = bestMove; info.score = bestScore === -INF ? 0 : bestScore; info.pv = lastPV;
    info.nodes = nodes; info.ms = Date.now() - t0; info.sel = selDepth;
    return info;
  }

  // ---- analysis: exact scores and lines for the best k root moves ----
  function thinkMulti(cfg, root, n, rs, t0, softMs, maxDepth, info) {
    const k = Math.min(cfg.multi, n);
    let lines = null;
    for (let d = 1; d <= maxDepth; d++) {
      rootDepth = d;
      if (lines) { // previous best lines first, then the rest by effort spent on them
        const top = lines.map((x) => x.move), rest = [];
        for (let i = 0; i < n; i++) if (!top.includes(root[i])) rest.push([root[i], rs[i]]);
        rest.sort((a, b) => b[1] - a[1]);
        let j = 0;
        for (const m of top) { root[j] = m; rs[j] = 2e9; j++; }
        for (const [m, v] of rest) { root[j] = m; rs[j] = v; j++; }
      }
      const res = rootIterMulti(d, root, n, rs, k);
      if (stopped) { if (!lines && res.length) lines = res; break; }
      lines = res; info.depth = d;
      const el = Date.now() - t0;
      if (cfg.onInfo) cfg.onInfo({ depth: d, score: lines[0].score, pv: lines[0].pv.slice(), nodes, ms: el, sel: selDepth,
                                   lines: lines.map((x) => ({ move: x.move, score: x.score, pv: x.pv.slice() })) });
      if (Math.abs(lines[0].score) >= MATE_BOUND && WIN - Math.abs(lines[0].score) <= d) break;
      if (softMs && el >= softMs) break;
      if (maxNodes && nodes >= maxNodes * 0.6) break;
    }
    lines = lines || [];
    info.lines = lines;
    info.move = lines.length ? lines[0].move : root[0];
    info.score = lines.length ? lines[0].score : 0;
    info.pv = lines.length ? lines[0].pv : [info.move];
    info.nodes = nodes; info.ms = Date.now() - t0; info.sel = selDepth;
    return info;
  }
  function rootIterMulti(d, root, n, rs, k) {
    const side = stm, res = [];
    let kth = -INF;
    for (let i = 0; i < n; i++) {
      const m = root[i], n0 = nodes;
      make(m);
      const r = resultAfter(side, (m & 4096) !== 0);
      let s, exact = false, pv = null;
      if (r !== 0) { s = r === 1 ? WIN - 1 : r === -1 ? -WIN + 1 : 0; exact = true; pv = [m]; }
      else {
        if (res.length < k) { s = -search(d - 1, -INF, INF, 1, true, true, false); exact = true; }
        else {
          s = -search(d - 1, -kth - 1, -kth, 1, false, true, false);
          if (s > kth && !stopped) { s = -search(d - 1, -INF, INF, 1, true, true, false); exact = true; }
        }
        if (exact && !stopped) { pv = [m]; for (let j = 0; j < PVL[1]; j++) pv.push(PVT[(MAXPLY + 2) + j]); }
      }
      unmake(m);
      if (stopped) break;
      rs[i] = Math.min(2e9, nodes - n0);
      if (exact) {
        res.push({ move: m, score: s, pv });
        res.sort((a, b) => b.score - a.score);
        if (res.length > k) res.length = k;
        if (res.length >= k) kth = res[k - 1].score;
      }
    }
    return res;
  }

  // ---- human-like play for the weaker levels ----
  // Reads only cfg.depth plies, overlooks some quiet moves, judges with noise, likes captures a little,
  // and on some turns misses its own immediate connection or the opponent's (cfg.missWin / cfg.blind).
  function thinkHuman(cfg) {
    const t0 = Date.now(), side = stm, op = 3 - side, rand = cfg.rand || Math.random;
    P = Object.assign({}, DEFAULTS); useMobility = P.mobility; evalMode = P.evalMode;
    const root = new Int32Array(256), n = genMoves(side, root, 0);
    if (n === 0) return { move: PASS, score: 0, depth: 0, pv: [], nodes: 0, ms: 0, side };
    const wins = [], facts = new Map();
    for (let i = 0; i < n; i++) {
      const m = root[i];
      make(m);
      const r = resultAfter(side, (m & 4096) !== 0);
      if (r === 1) wins.push(m);
      // what the move looks like at a glance: the position right after it, without the opponent's reply
      else facts.set(m, { allowsWin: r === 0 && canWinNow(op), glance: r === 0 ? -evaluate() : r === 2 ? 0 : -WIN + 1 });
      unmake(m);
    }
    if (wins.length && (rand() >= (cfg.missWin || 0) || wins.length === n))
      return { move: wins[0], score: WIN - 1, depth: 1, pv: [wins[0]], nodes: 0, ms: Date.now() - t0, side };
    const blind = rand() < (cfg.blind || 0); // this turn the opponent's next-move connection goes unseen
    const info = think({ depth: cfg.depth || 1, time: cfg.time || 3000, soft: 1, multi: 256, keepHistory: true, avoid: wins });
    const lines = info.lines && info.lines.length ? info.lines : [{ move: info.move, score: info.score, pv: [info.move] }];
    const prob = (s) => (s >= MATE_BOUND ? 1 : s <= -MATE_BOUND ? 0 : 1 / (1 + Math.exp(-s / 300)));
    const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
    let pick = null, pickV = -Infinity;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], f = facts.get(l.move);
      // quiet moves sometimes never get looked at; captures always catch the eye
      if (i > 0 && !(l.move & 4096) && rand() < (cfg.overlook || 0)) continue;
      let v = blind && f && f.allowsWin ? prob(f.glance) : prob(l.score);
      if (l.move & 4096) v += cfg.capBias || 0;
      v += gauss() * (cfg.noise || 0);
      if (v > pickV) { pickV = v; pick = l; }
    }
    if (!pick) pick = lines[0];
    return { move: pick.move, score: lines[0].score, depth: info.depth, pv: pick.pv, nodes: info.nodes, ms: Date.now() - t0, side,
             chosen: pick.score, best: lines[0].move };
  }

  // ---- plain-language facts about one move (for explanations) ----
  function concOf(side) {
    const n = pcount[side], pl = plist[side];
    if (n <= 1) return 0;
    let sr = 0, sc = 0;
    for (let i = 0; i < n; i++) { sr += pl[i] >> 3; sc += pl[i] & 7; }
    const com = Math.round(sr / n) * 8 + Math.round(sc / n);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += CHEB[pl[i] * 64 + com];
    return sum - MINSUM[n];
  }
  function describe(m) {
    const me = stm, op = 3 - me;
    const out = { capture: (m & 4096) !== 0, groupsBefore: label(me), concBefore: concOf(me),
                  oppGroupsBefore: label(op), oppThreatBefore: canWinNow(op),
                  ringFrom: RING[m & 63], ringTo: RING[(m >> 6) & 63] };
    make(m);
    out.result = resultAfter(me, out.capture);
    out.groupsAfter = label(me); out.concAfter = concOf(me); out.oppGroupsAfter = label(op);
    out.threat = out.result === 0 ? canWinNow(me) : false;      // I can connect next turn
    out.allowsWin = out.result === 0 ? canWinNow(op) : false;   // opponent can connect right away
    unmake(m);
    out.blocks = out.oppThreatBefore && !out.allowsWin && out.result === 0;
    return out;
  }

  function rootIter(d, alpha, beta, root, n, rs, prevBest) {
    // sort root moves: previous best first, then by rs (descending)
    for (let i = 0; i < n; i++) if (root[i] === prevBest) { const t = root[0]; root[0] = root[i]; root[i] = t; const u = rs[0]; rs[0] = rs[i]; rs[i] = u; break; }
    for (let i = 2; i < n; i++) { const m = root[i], v = rs[i]; let j = i - 1;
      while (j >= 1 && rs[j] < v) { root[j + 1] = root[j]; rs[j + 1] = rs[j]; j--; }
      root[j + 1] = m; rs[j + 1] = v; }
    const side = stm;
    let best = -INF, bestMove = 0, pv = null, raised = false, completedFirst = false;
    const a0 = alpha;
    for (let i = 0; i < n; i++) {
      const m = root[i], n0 = nodes;
      make(m);
      const r = resultAfter(side, (m & 4096) !== 0);
      let s;
      if (r === 1) s = WIN - 1;
      else if (r === -1) s = -WIN + 1;
      else if (r === 2) s = 0;
      else if (i === 0) s = -search(d - 1, -beta, -alpha, 1, true, true, false);
      else {
        s = -search(d - 1, -alpha - 1, -alpha, 1, false, true, false);
        if (s > alpha && s < beta && !stopped) s = -search(d - 1, -beta, -alpha, 1, true, true, false);
      }
      unmake(m);
      if (stopped) break;
      rs[i] = Math.min(2e9, nodes - n0);
      if (i === 0) completedFirst = true;
      if (s > best) {
        best = s; bestMove = m;
        if (s > alpha) {
          alpha = s; if (i > 0) raised = true;
          pv = [m];
          for (let j = 0; j < PVL[1]; j++) pv.push(PVT[(MAXPLY + 2) + j]);
          if (s >= beta) break;
        }
      }
    }
    if (bestMove && !pv) pv = [bestMove];
    return { move: bestMove, score: best, pv, raised: raised || completedFirst, completedFirst };
  }

  /* ---------------- game helpers ---------------- */
  function legalMoves() { const o = new Int32Array(256); const n = genMoves(stm, o, 0); return Array.from(o.subarray(0, n)); }
  function play(m) { if (m === PASS) makePass(); else make(m); }
  function snapshot() { return { board: Array.from(board), stm }; }

  return {
    WIN, MATE_BOUND, PASS, NF, FEAT_NAMES,
    startArray, setPosition,
    setStart() { setPosition(startArray(), 1); },
    play, legalMoves, snapshot, think, thinkHuman, evaluate: () => { P = Object.assign({}, DEFAULTS); return evaluate(); },
    resultAfter, connected, canWinNow, featureVector, sideFeatures, setWeights, describe,
    getWeights: () => ({ WO: Array.from(WO), WE: Array.from(WE), TEMPO_O, TEMPO_E }),
    setParams(p) { P = Object.assign({}, DEFAULTS, p || {}); useMobility = P.mobility; evalMode = P.evalMode; },
    get stm() { return stm; }, get hash() { return [h1, h2]; }, get board() { return board; },
    pieceCount: (p) => pcount[p], ttClear,
    // internals for testing
    _genMoves: genMoves, _make: make, _unmake: unmake, _label: label, _lineCnt: lineCnt,
    moveStr(m) {
      if (m === PASS) return "pass";
      const sq = (s) => "abcdefgh"[s & 7] + (8 - (s >> 3));
      return sq(m & 63) + (m & 4096 ? "x" : "-") + sq((m >> 6) & 63);
    },
  };
}


const TUNED_WEIGHTS = {"WO": [89.737, 149.847, 185.339, 169.995, 194.812, 242.639, 255.31, 192.251, 226.532, 212.064, -35.407, 444.782, 26.218, -20.638, -8.095, -15.068, -1.352, 128.492, 0.0, 0.0, 0.0, 1.309, -24.138, -6.367], "WE": [-22.052, -73.962, 82.505, 124.591, 120.61, 174.463, 236.87, 329.321, 341.43, 397.136, -101.975, -123.728, -275.281, 49.802, 84.557, -45.242, -4.577, 304.686, 0.0, 0.0, 0.0, 25.145, 20.757, 12.19], "TEMPO_O": 56.233, "TEMPO_E": 205.451};

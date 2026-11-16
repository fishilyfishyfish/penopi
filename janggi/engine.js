// Janggi (Korean chess) engine, written for this site: alpha-beta in plain JS. Loaded on the page (rules) and in
// worker.js (thinking), like the chess engine.
//
// Rules as played here (see CLAUDE.md "장기 엔진"): 9×10 board, 초 (Cho, bottom) moves first. 궁·사 stay in their
// palace and move one step along its lines (diagonals too). 차: rook moves, plus along palace diagonals. 포: moves or
// captures by jumping exactly one piece (never a 포, and it can't capture a 포), palace diagonals too. 마: one step
// straight then one diagonal outward (blocked by a piece on the straight step). 상: one straight then two diagonal
// (blocked on either step). 졸/병: one step forward or sideways, and forward along the diagonals inside the enemy
// palace. A move may not leave one's own 궁 attacked. One may pass (한수 쉼) when not in check.
// Checkmate wins. When the two 궁 face each other on an open file (빅장), the side to move must break it or pass;
// passing then ends the game by counting points (차13 포7 마5 상3 사3 졸2, 한 +1.5 so there is no draw), as Fairy-
// Stockfish's "janggi" does. Counting also ends the game when both pass in a row, a position repeats a third
// time, or 200 moves (plies) are played.
//
// Squares: s = rank*9 + file, rank 0 = Cho's back rank (rank 1 in notation), file 0 = a. Pieces: colour (0 Cho,
// 8 Han) | type (1 졸, 2 사, 3 상, 4 마, 5 포, 6 차, 7 궁). Moves: from | to<<7 | 1<<14 if a capture; PASS = 1<<15.
function JanggiEngine(opts) {
  opts = opts || {};
  const CHO = 0, HAN = 8;
  const SOL = 1, GUA = 2, ELE = 3, HOR = 4, CAN = 5, CHA = 6, GEN = 7;
  const MATE = 100000, MATE_BOUND = MATE - 1000, INF = MATE + 1, COUNT_WIN = 50000;
  const MAXPLY = 96, PLY_LIMIT = 200;
  const FLAG_CAP = 1 << 14, PASS = 1 << 15;
  const mFrom = (m) => m & 127, mTo = (m) => (m >> 7) & 127;
  const isCap = (m) => (m & FLAG_CAP) !== 0;
  const rankOf = (s) => (s / 9) | 0, fileOf = (s) => s % 9;
  const sq = (r, f) => r * 9 + f;
  const onB = (r, f) => r >= 0 && r < 10 && f >= 0 && f < 9;
  const POINTS = [0, 2, 3, 3, 5, 7, 13, 0]; // counting values, in whole points (한 gets +1.5 on top)

  // ---------- tables ----------
  const inPalace = (r, f, c) => f >= 3 && f <= 5 && (c === CHO ? r <= 2 : r >= 7);
  const PALACE = new Int8Array(90); // 1 Cho's palace, 2 Han's
  for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) PALACE[sq(r, f)] = inPalace(r, f, CHO) ? 1 : inPalace(r, f, HAN) ? 2 : 0;
  // palace diagonal links: centre ↔ corners
  const PDIAG = Array.from({ length: 90 }, () => []);
  for (const cr of [1, 8]) {
    const c = sq(cr, 4);
    for (const [dr, df] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const k = sq(cr + dr, 4 + df); PDIAG[c].push(k); PDIAG[k].push(c); }
  }
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 궁·사: one step along palace lines, inside its own palace
  const KMOVES = [[], []];
  for (const ci of [0, 1]) for (let s = 0; s < 90; s++) {
    const r = rankOf(s), f = fileOf(s), out = [];
    if (PALACE[s] === ci + 1) {
      for (const [dr, df] of ORTH) if (onB(r + dr, f + df) && PALACE[sq(r + dr, f + df)] === ci + 1) out.push(sq(r + dr, f + df));
      for (const t of PDIAG[s]) out.push(t);
    }
    KMOVES[ci].push(out);
  }
  // 졸/병: forward or sideways; forward along the diagonals in the enemy palace
  const SMOVES = [[], []];
  for (const ci of [0, 1]) for (let s = 0; s < 90; s++) {
    const r = rankOf(s), f = fileOf(s), fw = ci === 0 ? 1 : -1, out = [];
    if (onB(r + fw, f)) out.push(sq(r + fw, f));
    if (onB(r, f - 1)) out.push(sq(r, f - 1));
    if (onB(r, f + 1)) out.push(sq(r, f + 1));
    if (PALACE[s] === 2 - ci) for (const t of PDIAG[s]) if (rankOf(t) === r + fw) out.push(t);
    SMOVES[ci].push(out);
  }
  // 마: [leg, target] pairs. 상: [leg1, leg2, target]
  const HMOVES = [], EMOVES = [];
  for (let s = 0; s < 90; s++) {
    const r = rankOf(s), f = fileOf(s), hm = [], em = [];
    for (const [dr, df] of ORTH) {
      if (!onB(r + dr, f + df)) continue;
      const leg = sq(r + dr, f + df);
      for (const p of [1, -1]) {
        const [pr, pf] = dr ? [0, p] : [p, 0]; // perpendicular
        if (onB(r + 2 * dr + pr, f + 2 * df + pf)) hm.push([leg, sq(r + 2 * dr + pr, f + 2 * df + pf)]);
        if (onB(r + 3 * dr + 2 * pr, f + 3 * df + 2 * pf)) em.push([leg, sq(r + 2 * dr + pr, f + 2 * df + pf), sq(r + 3 * dr + 2 * pr, f + 3 * df + 2 * pf)]);
      }
    }
    HMOVES.push(hm); EMOVES.push(em);
  }
  // 차·포 rays: the four straight lines, plus palace diagonals (from a corner: centre then the far corner; from the
  // centre: each corner)
  const RAYS = [];
  for (let s = 0; s < 90; s++) {
    const r = rankOf(s), f = fileOf(s), rays = [];
    for (const [dr, df] of ORTH) {
      const ray = [];
      for (let k = 1; onB(r + k * dr, f + k * df); k++) ray.push(sq(r + k * dr, f + k * df));
      if (ray.length) rays.push(ray);
    }
    if (PALACE[s]) {
      const cr = PALACE[s] === 1 ? 1 : 8, c = sq(cr, 4);
      if (s === c) for (const k of PDIAG[s]) rays.push([k]);
      else if (PDIAG[s].length) rays.push([c, sq(2 * cr - r, 8 - f)]);
    }
    RAYS.push(rays);
  }
  // reverse leaper tables for attack tests: who could land on t
  const HREV = Array.from({ length: 90 }, () => []), EREV = Array.from({ length: 90 }, () => []);
  const SREV = [Array.from({ length: 90 }, () => []), Array.from({ length: 90 }, () => [])];
  for (let s = 0; s < 90; s++) {
    for (const [leg, t] of HMOVES[s]) HREV[t].push(s, leg);
    for (const [a, b, t] of EMOVES[s]) EREV[t].push(s, a, b);
    for (const ci of [0, 1]) for (const t of SMOVES[ci][s]) SREV[ci][t].push(s);
  }

  // ---------- state ----------
  const board = new Int8Array(90);
  const kingSq = [0, 0];
  let side = CHO, h1 = 0, h2 = 0, passes = 0, irrev = 0, un = 0;
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZP1 = new Int32Array(16 * 90), ZP2 = new Int32Array(16 * 90);
  for (let i = 0; i < ZP1.length; i++) { ZP1[i] = rnd(); ZP2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  const H_SIZE = 1024;
  const hk1 = new Int32Array(H_SIZE), hk2 = new Int32Array(H_SIZE);
  const uM = new Int32Array(H_SIZE), uCap = new Int8Array(H_SIZE), uPass = new Int16Array(H_SIZE), uIrrev = new Int16Array(H_SIZE);
  const uFace = new Int8Array(H_SIZE);
  const count = new Int8Array(16);

  function rehash() {
    h1 = 0; h2 = 0;
    count.fill(0);
    for (let s = 0; s < 90; s++) { const p = board[s]; if (p) { h1 ^= ZP1[p * 90 + s]; h2 ^= ZP2[p * 90 + s]; count[p]++; if ((p & 7) === GEN) kingSq[p >> 3] = s; } }
    if (side === HAN) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  // Starting position. Arrangements of 마/상 (b, c, g, h files from the player's own left): 0 마상마상, 1 상마상마,
  // 2 마상상마, 3 상마마상.
  const ARR = [[HOR, ELE, HOR, ELE], [ELE, HOR, ELE, HOR], [HOR, ELE, ELE, HOR], [ELE, HOR, HOR, ELE]];
  function setup(choArr = 2, hanArr = 2) {
    board.fill(0);
    for (const [c, arr] of [[CHO, choArr], [HAN, hanArr]]) {
      const back = c === CHO ? 0 : 9, mir = (f) => (c === CHO ? f : 8 - f); // Han's left is file i
      const put = (r, f, t) => { board[sq(r, mir(f))] = c | t; };
      put(back, 0, CHA); put(back, 8, CHA);
      const a = ARR[arr];
      put(back, 1, a[0]); put(back, 2, a[1]); put(back, 6, a[2]); put(back, 7, a[3]);
      put(back, 3, GUA); put(back, 5, GUA);
      board[sq(c === CHO ? 1 : 8, 4)] = c | GEN;
      put(c === CHO ? 2 : 7, 1, CAN); put(c === CHO ? 2 : 7, 7, CAN);
      for (const f of [0, 2, 4, 6, 8]) board[sq(c === CHO ? 3 : 6, f)] = c | SOL;
    }
    side = CHO; passes = 0; irrev = 0; un = 0;
    rehash();
    hk1[0] = h1; hk2[0] = h2;
  }
  // FEN as Fairy-Stockfish writes it for janggi (rank 10 first; uppercase Cho): k a b n r c p
  const LET = ' pabncrk';
  function setFen(fen) {
    const [rows, stm] = fen.trim().split(/\s+/);
    board.fill(0);
    const rs = rows.split('/');
    for (let i = 0; i < 10; i++) {
      let f = 0;
      for (const ch of rs[i].match(/\d+|./g)) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        const t = LET.indexOf(ch.toLowerCase());
        board[sq(9 - i, f)] = (ch === ch.toLowerCase() ? HAN : CHO) | t;
        f++;
      }
    }
    side = stm === 'b' ? HAN : CHO; passes = 0; irrev = 0; un = 0;
    rehash();
    hk1[0] = h1; hk2[0] = h2;
  }
  function fen() {
    const rows = [];
    for (let r = 9; r >= 0; r--) {
      let row = '', e = 0;
      for (let f = 0; f < 9; f++) {
        const p = board[sq(r, f)];
        if (!p) { e++; continue; }
        if (e) { row += e; e = 0; }
        const ch = LET[p & 7];
        row += p & 8 ? ch : ch.toUpperCase();
      }
      if (e) row += e;
      rows.push(row);
    }
    return rows.join('/') + (side === CHO ? ' w' : ' b') + ' - - 0 1';
  }
  const sqName = (s) => 'abcdefghi'[fileOf(s)] + (rankOf(s) + 1);
  const uci = (m) => (m === PASS ? sqName(kingSq[side >> 3]).repeat(2) : sqName(mFrom(m)) + sqName(mTo(m)));

  // ---------- attacks ----------
  // Is square s attacked by colour `by`? (Only 차, 포, 마, 상, 졸 can reach the other palace, so 궁·사 are left out:
  // this is used for the 궁.)
  function attacked(s, by) {
    const rays = RAYS[s];
    for (let i = 0; i < rays.length; i++) {
      const ray = rays[i];
      let k = 0;
      for (; k < ray.length; k++) {
        const q = board[ray[k]];
        if (q) { if (q === (by | CHA)) return true; break; }
      }
      if (k >= ray.length || (board[ray[k]] & 7) === CAN) continue; // no screen, or a 포 (can't be jumped)
      for (k++; k < ray.length; k++) {
        const q = board[ray[k]];
        if (q) { if (q === (by | CAN)) return true; break; }
      }
    }
    const hr = HREV[s];
    for (let i = 0; i < hr.length; i += 2) if (board[hr[i]] === (by | HOR) && !board[hr[i + 1]]) return true;
    const er = EREV[s];
    for (let i = 0; i < er.length; i += 3) if (board[er[i]] === (by | ELE) && !board[er[i + 1]] && !board[er[i + 2]]) return true;
    const sr = SREV[by >> 3][s];
    for (let i = 0; i < sr.length; i++) if (board[sr[i]] === (by | SOL)) return true;
    return false;
  }
  const inCheck = (c = side) => attacked(kingSq[c >> 3], c ^ 8);
  // attacked including by 궁·사 (for a point inside their palace): is a capture there answered by a capture?
  function defended(s, by) {
    if (attacked(s, by)) return true;
    const k = KMOVES[by >> 3][s];
    for (let i = 0; i < k.length; i++) { const q = board[k[i]]; if (q === (by | GUA) || q === (by | GEN)) return true; }
    return false;
  }
  function facing() {
    const a = kingSq[0], b = kingSq[1];
    if (fileOf(a) !== fileOf(b)) return false;
    for (let s = a + 9; s < b; s += 9) if (board[s]) return false;
    return true;
  }

  // ---------- move generation (pseudo-legal; the page and the search test the 궁 afterwards) ----------
  function gen(list, capsOnly) {
    let n = 0;
    const us = side, ci = us >> 3;
    const add = (from, to) => {
      const q = board[to];
      if (q) { if ((q & 8) !== us) list[n++] = from | (to << 7) | FLAG_CAP; }
      else if (!capsOnly) list[n++] = from | (to << 7);
    };
    for (let s = 0; s < 90; s++) {
      const p = board[s];
      if (!p || (p & 8) !== us) continue;
      switch (p & 7) {
        case SOL: { const t = SMOVES[ci][s]; for (let i = 0; i < t.length; i++) add(s, t[i]); break; }
        case GUA: case GEN: { const t = KMOVES[ci][s]; for (let i = 0; i < t.length; i++) add(s, t[i]); break; }
        case HOR: { const t = HMOVES[s]; for (let i = 0; i < t.length; i++) if (!board[t[i][0]]) add(s, t[i][1]); break; }
        case ELE: { const t = EMOVES[s]; for (let i = 0; i < t.length; i++) if (!board[t[i][0]] && !board[t[i][1]]) add(s, t[i][2]); break; }
        case CHA: {
          const rays = RAYS[s];
          for (let i = 0; i < rays.length; i++) {
            const ray = rays[i];
            for (let k = 0; k < ray.length; k++) {
              const q = board[ray[k]];
              if (!q) { if (!capsOnly) list[n++] = s | (ray[k] << 7); continue; }
              if ((q & 8) !== us) list[n++] = s | (ray[k] << 7) | FLAG_CAP;
              break;
            }
          }
          break;
        }
        case CAN: {
          const rays = RAYS[s];
          for (let i = 0; i < rays.length; i++) {
            const ray = rays[i];
            let k = 0;
            while (k < ray.length && !board[ray[k]]) k++;
            if (k >= ray.length || (board[ray[k]] & 7) === CAN) continue;
            for (k++; k < ray.length; k++) {
              const q = board[ray[k]];
              if (!q) { if (!capsOnly) list[n++] = s | (ray[k] << 7); continue; }
              if ((q & 8) !== us && (q & 7) !== CAN) list[n++] = s | (ray[k] << 7) | FLAG_CAP;
              break;
            }
          }
          break;
        }
      }
    }
    return n;
  }

  // ---------- make / unmake ----------
  function make(m) {
    uM[un] = m; uPass[un] = passes; uIrrev[un] = irrev; uFace[un] = facing() ? 1 : 0;
    if (m === PASS) { uCap[un] = 0; passes++; }
    else {
      const from = m & 127, to = (m >> 7) & 127, p = board[from], q = board[to];
      uCap[un] = q;
      if (q) { h1 ^= ZP1[q * 90 + to]; h2 ^= ZP2[q * 90 + to]; count[q]--; }
      h1 ^= ZP1[p * 90 + from] ^ ZP1[p * 90 + to]; h2 ^= ZP2[p * 90 + from] ^ ZP2[p * 90 + to];
      board[to] = p; board[from] = 0;
      if ((p & 7) === GEN) kingSq[p >> 3] = to;
      passes = 0;
      if (q) irrev = un + 1;
    }
    side ^= 8; h1 ^= ZS1; h2 ^= ZS2;
    un++;
    hk1[un] = h1; hk2[un] = h2;
  }
  function unmake() {
    un--;
    const m = uM[un];
    side ^= 8; h1 ^= ZS1; h2 ^= ZS2;
    passes = uPass[un]; irrev = uIrrev[un];
    if (m === PASS) return;
    const from = m & 127, to = (m >> 7) & 127, p = board[to], q = uCap[un];
    h1 ^= ZP1[p * 90 + from] ^ ZP1[p * 90 + to]; h2 ^= ZP2[p * 90 + from] ^ ZP2[p * 90 + to];
    board[from] = p; board[to] = q;
    if (q) { h1 ^= ZP1[q * 90 + to]; h2 ^= ZP2[q * 90 + to]; count[q]++; }
    if ((p & 7) === GEN) kingSq[p >> 3] = from;
  }
  // a free move for null-move pruning (not a real pass: it doesn't count towards two passes in a row)
  function makeNull() { uM[un] = 0; uPass[un] = passes; uIrrev[un] = irrev; uFace[un] = 0; uCap[un] = 0; passes = 0; irrev = un + 1; side ^= 8; h1 ^= ZS1; h2 ^= ZS2; un++; hk1[un] = h1; hk2[un] = h2; }
  function unmakeNull() { un--; side ^= 8; h1 ^= ZS1; h2 ^= ZS2; passes = uPass[un]; irrev = uIrrev[un]; }

  function legalMoves() {
    const list = new Int32Array(160), n = gen(list, false), out = [];
    const chk = inCheck(), fc = facing();
    for (let i = 0; i < n; i++) { make(list[i]); if (!inCheck(side ^ 8) && !(fc && facing())) out.push(list[i]); unmake(); }
    if (!chk) out.push(PASS);
    return out;
  }
  function repeats() { // earlier occurrences of this position (same side to move) since the last capture
    let c = 0;
    for (let i = un - 2; i >= irrev; i -= 2) if (hk1[i] === h1 && hk2[i] === h2) c++;
    return c;
  }
  function points(c) { let v = 0; for (let t = 1; t < 7; t++) v += POINTS[t] * count[c | t]; return c === HAN ? v + 1.5 : v; }
  const countWinner = () => (points(CHO) > points(HAN) ? CHO : HAN);
  // '' while the game goes on; 'mate' (the side to move is mated) or 'count:<why>' (decided by points: countWinner)
  function status() {
    if (inCheck() && legalMoves().length === 0) return 'mate';
    if (passes >= 2) return 'count:pass';
    if (un && uFace[un - 1] && facing()) return 'count:bikjang';
    if (repeats() >= 2) return 'count:repetition';
    if (un >= PLY_LIMIT) return 'count:limit';
    return '';
  }

  // ---------- evaluation ----------
  // Linear in the parameter array PV, Cho's view internally. Terms: material, piece-square tables (left-right
  // symmetric, from each side's own view), mobility per piece type, attacks on the 궁's palace, missing 사, the
  // 포's worth with fewer pieces around (screens), tempo.
  const PDEF = [], PINIT = [];
  let PN = 0;
  function prm(name, init) { const o = PN; PDEF.push([name, o, init.length]); for (const v of init) PINIT.push(v); PN += init.length; return o; }
  const lin = (n, f) => Array.from({ length: n }, (_, k) => f(k));
  // own-view index: rank from own back rank (0..9) × folded file (0..4)
  const pstInit = {
    [SOL]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return [0, 0, 0, 0, 10, 20, 32, 42, 42, 15][r] + (r >= 6 && f >= 3 ? 8 : 0); }),
    [GUA]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return r === 0 && f === 3 ? 4 : r === 1 && f === 4 ? 6 : 0; }),
    [ELE]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return Math.min(r, 3) * 3 - Math.max(0, r - 5) * 4 + (f >= 2 ? 3 : 0); }),
    [HOR]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return Math.min(r, 6) * 4 + f * 3 - (f === 0 ? 10 : 0) - (r === 9 ? 10 : 0); }),
    [CAN]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return (f === 4 ? 6 : 0) + (r >= 7 ? 6 : 0); }),
    [CHA]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return (r >= 6 ? 10 : 0) + (f === 3 || f === 4 ? 4 : 0); }),
    [GEN]: lin(50, (k) => { const r = (k / 5) | 0, f = k % 5; return r === 1 && f === 4 ? 10 : r === 0 && f === 4 ? 4 : 0; }),
  };
  const O = {
    mat: prm('material', [0, 100, 170, 170, 300, 380, 650, 0]),
    pst: [0], mob: prm('mobility per move', [0, 0, 0, 3, 6, 3, 4, 0]),
    att: prm('palace attack units', lin(16, (u) => (u < 2 ? 0 : -Math.min(300, u * u * 3)))),
    noGuard: prm('missing 사 (enemy has a 차)', [-30]),
    canFew: prm('포 per missing piece', [-4]),
    solPair: prm('졸 with a 졸 beside it', [6]),
    tempo: prm('tempo', [12]),
  };
  for (let t = 1; t <= 7; t++) O.pst.push(prm('pst ' + t, pstInit[t]));
  const TUNED = [0,95,163,152,276,326,724,0,0,0,0,6,2,2,4,0,-32,-17,-33,-41,-50,-64,-91,-116,-172,-238,-297,-300,-300,-300,-300,-300,-20,0,8,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-10,-3,13,29,30,-14,-6,13,18,38,-6,1,22,38,39,20,26,35,52,50,40,41,52,64,54,30,17,19,40,50,15,12,2,23,23,0,0,0,6,-7,0,0,0,8,27,0,0,0,-9,-23,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-4,1,7,3,-2,10,-2,3,6,6,7,6,16,6,9,1,6,13,15,11,-2,13,16,13,-8,10,23,14,18,8,26,13,-6,7,-1,4,7,2,3,-6,-3,-3,2,0,-1,-15,-4,-6,-4,-15,-8,4,2,1,-20,9,21,28,9,-10,13,14,28,29,5,11,20,27,33,7,14,21,23,13,-1,30,27,41,35,9,25,35,30,33,14,26,31,34,34,15,26,31,32,36,4,14,27,21,26,-3,18,6,56,52,0,13,-3,32,19,12,3,-1,36,56,-2,-6,-5,-4,15,-2,-18,-13,1,23,-18,-14,-10,6,2,1,-26,-21,15,15,-12,-24,-18,3,14,-19,-30,-16,1,13,-22,-20,-14,-6,11,-3,-9,14,1,4,-2,-17,-11,-14,-6,13,12,23,7,7,17,5,9,9,11,-12,5,15,2,1,3,0,17,11,6,24,17,21,22,18,16,11,4,24,16,-13,-5,6,17,14,-5,7,7,21,15,0,0,0,10,36,0,0,0,4,29,0,0,0,-22,-42,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; // tuned-params
  const PV = Int32Array.from(TUNED && TUNED.length === PN ? TUNED : PINIT);
  if (opts.params) PV.set(opts.params);
  const ATT_U = [0, 1, 0, 1, 2, 2, 3, 0]; // attack units on the palace by attacker type
  let TR = null; // trace: coefficient per parameter (Cho's view) while computing features()
  const tr = (k, c) => { if (TR) TR[k] += c; };
  const fold = (f) => (f > 4 ? 8 - f : f);
  const units = [0, 0], palaceHit = new Int8Array(90);
  function evaluate() {
    let v = 0;
    units[0] = 0; units[1] = 0;
    let pieces = 0;
    for (let s = 0; s < 90; s++) { const p = board[s]; if (p && (p & 7) !== GEN) pieces++; }
    for (let s = 0; s < 90; s++) {
      const p = board[s];
      if (!p) continue;
      const t = p & 7, c = p & 8, ci = c >> 3, sg = c === CHO ? 1 : -1;
      const r = c === CHO ? rankOf(s) : 9 - rankOf(s), k = r * 5 + fold(fileOf(s));
      v += sg * (PV[O.mat + t] + PV[O.pst[t] + k]);
      tr(O.mat + t, sg); tr(O.pst[t] + k, sg);
      if (t === CAN) { v += sg * PV[O.canFew] * (30 - pieces); tr(O.canFew, sg * (30 - pieces)); }
      if (t === SOL || t === GUA || t === GEN) {
        if (t === SOL) {
          if (PALACE[s] === 2 - ci) units[ci] += 1; // a 졸 inside the enemy palace
          const f = fileOf(s);
          if (f < 8 && board[s + 1] === p) { v += sg * PV[O.solPair]; tr(O.solPair, sg); } // counted once per pair
        }
        continue;
      }
      // mobility and hits on the enemy palace
      let mob = 0, hit = 0;
      const enemyPal = 2 - ci;
      if (t === HOR) { const tb = HMOVES[s]; for (let i = 0; i < tb.length; i++) if (!board[tb[i][0]]) { const to = tb[i][1], q = board[to]; if (!q || (q & 8) !== c) mob++; if (PALACE[to] === enemyPal) hit = 1; } }
      else if (t === ELE) { const tb = EMOVES[s]; for (let i = 0; i < tb.length; i++) if (!board[tb[i][0]] && !board[tb[i][1]]) { const to = tb[i][2], q = board[to]; if (!q || (q & 8) !== c) mob++; if (PALACE[to] === enemyPal) hit = 1; } }
      else {
        const rays = RAYS[s];
        for (let i = 0; i < rays.length; i++) {
          const ray = rays[i];
          let kk = 0;
          if (t === CHA) {
            for (; kk < ray.length; kk++) { const q = board[ray[kk]]; if (PALACE[ray[kk]] === enemyPal) hit = 1; if (!q) { mob++; continue; } if ((q & 8) !== c) mob++; break; }
          } else {
            while (kk < ray.length && !board[ray[kk]]) kk++;
            if (kk >= ray.length || (board[ray[kk]] & 7) === CAN) continue;
            for (kk++; kk < ray.length; kk++) { const q = board[ray[kk]]; if (PALACE[ray[kk]] === enemyPal) hit = 1; if (!q) { mob++; continue; } if ((q & 8) !== c && (q & 7) !== CAN) mob++; break; }
          }
        }
      }
      v += sg * PV[O.mob + t] * mob; tr(O.mob + t, sg * mob);
      if (hit) units[ci] += ATT_U[t];
    }
    for (const ci of [0, 1]) {
      const c = ci << 3, sg = c === CHO ? 1 : -1, u = Math.min(units[ci ^ 1], 15); // units against colour ci's palace
      v += sg * PV[O.att + u]; tr(O.att + u, sg);
      if (count[(c ^ 8) | CHA]) { const miss = 2 - count[c | GUA]; v += sg * PV[O.noGuard] * miss; tr(O.noGuard, sg * miss); }
    }
    if (TR) TR[O.tempo] += side === CHO ? 1 : -1;
    return (side === CHO ? v : -v) + PV[O.tempo];
  }
  void palaceHit;

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  let ply = 0;
  const toTT = (s) => (s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s);
  const fromTT = (s) => (s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s);

  // ---------- search ----------
  const MV = [], SC = [], QT = [];
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(160)); SC.push(new Int32Array(160)); QT.push(new Int32Array(160)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(16 * 128), CM = new Int32Array(16 * 128);
  const LMR = [];
  for (let d = 0; d < 64; d++) { LMR.push(new Int8Array(64)); for (let i = 1; i < 64; i++) LMR[d][i] = d && i ? Math.floor(0.6 + Math.log(d) * Math.log(i) / 2.2) : 0; }
  const W = Object.assign({ rfp: 1, fut: 1, lmp: 1, nul: 0, iid: 1, asp: 1, cm: 1, bad: 1 }, opts.weights || {});
  const RFP_MARGIN = 90, FUT_MARGIN = [0, 120, 220, 320], LMP = [0, 6, 10, 16, 24];
  const VICTIM = [0, 100, 170, 170, 300, 380, 650, 5000];
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0, excluded = null;
  function timeUp() {
    if ((nodes & 2047) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function countScore() { return countWinner() === side ? COUNT_WIN : -COUNT_WIN; }
  function score(n, p, ttMove) {
    const ms = MV[p], sc = SC[p], pm = un > 0 ? uM[un - 1] : 0, cmMove = pm && pm !== PASS ? CM[board[mTo(pm)] * 128 + mTo(pm)] : 0;
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      let v;
      if (m === ttMove) v = 1 << 30;
      else if (m === PASS) v = -(1 << 24);
      else if (isCap(m)) {
        const vv = VICTIM[board[mTo(m)] & 7], av = VICTIM[board[mFrom(m)] & 7], mvv = vv * 8 - (board[mFrom(m)] & 7);
        // a cheaper piece on a defended point: after the quiet moves (and left out of the quiescence search)
        v = W.bad && vv < av && defended(mTo(m), side ^ 8) ? -(1 << 20) + mvv : (1 << 28) + mvv;
      }
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
  const histAdd = (i, bonus) => { HIST[i] += bonus - Math.trunc(HIST[i] * Math.abs(bonus) / 16384); };
  // the game ends here by counting? (a repeat inside the search counts as the third)
  function countEnd() {
    if (un >= PLY_LIMIT || passes >= 2) return true;
    if (un && uFace[un - 1] && facing()) return true;
    return repeats() >= 1;
  }
  function qsearch(alpha, beta, p, qd) {
    nodes++;
    if (timeUp()) return 0;
    if (p >= MAXPLY) return evaluate();
    if (countEnd()) return countScore();
    const check = inCheck(), full = check && qd < 4, fc = facing();
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
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      if (!full && best + VICTIM[board[mTo(m)] & 7] + 200 < alpha) continue; // delta pruning
      if (!full && SC[p][i] < 0) continue; // a losing capture
      make(m);
      if (inCheck(side ^ 8) || (fc && facing())) { unmake(); continue; }
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
      if (countEnd()) return countScore();
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
      if (!pv && p > 0 && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    const ev = check ? -INF : evaluate();
    if (W.rfp && !pv && !check && depth <= 6 && Math.abs(beta) < COUNT_WIN - 1000 && ev - RFP_MARGIN * depth >= beta) return ev;
    // null move: passing is legal in janggi, so there is no zugzwang to fear
    if (W.nul && !pv && !check && nullOk && depth >= 3 && ev >= beta && !facing() && passes === 0) {
      makeNull(); ply++;
      const s = -search(depth - 1 - (3 + (depth >> 2)), -beta, -beta + 1, p + 1, false, false);
      ply--; unmakeNull();
      if (stopped) return 0;
      if (s >= beta) return s >= MATE_BOUND ? beta : s;
    }
    if (W.iid && pv && !ttMove && depth >= 6) {
      search(depth - 3, alpha, beta, p, true, false);
      if (stopped) return 0;
      if (tFlag[idx] && tKey[idx] === h2) ttMove = tMove[idx];
    }
    const ms = MV[p];
    let n = gen(ms, false);
    if (!check) ms[n++] = PASS;
    score(n, p, ttMove);
    const futile = W.fut && !pv && !check && depth <= 3 && ev + FUT_MARGIN[depth] <= alpha;
    const a0 = alpha, qt = QT[p], fc = facing();
    let best = -INF, bestMove = 0, legal = 0, quiets = 0;
    for (let i = 0; i < n; i++) {
      const m = pick(n, p, i);
      if (p === 0 && excluded && excluded.includes(m)) continue; // think({exclude}): the next best move
      const quiet = !isCap(m);
      make(m);
      if (m !== PASS && (inCheck(side ^ 8) || (fc && facing()))) { unmake(); continue; }
      legal++;
      const gives = m !== PASS && inCheck();
      if (quiet && !gives && legal > 1 && best > -MATE_BOUND) {
        if (futile || (W.lmp && !pv && !check && depth <= 4 && quiets >= LMP[depth])) { unmake(); quiets++; continue; }
      }
      if (quiet && m !== PASS) qt[quiets++] = m;
      ply++;
      let s;
      if (legal === 1) s = -search(depth - 1, -beta, -alpha, p + 1, pv, true);
      else {
        let r = 0;
        if (depth >= 3 && quiet && !gives && !check && m !== KIL[p * 2] && m !== KIL[p * 2 + 1]) {
          r = LMR[Math.min(depth, 63)][Math.min(legal, 63)];
          if (pv) r--;
          if (m !== PASS && HIST[board[mTo(m)] * 128 + mTo(m)] > 4000) r--;
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
        if (quiet && m !== PASS) {
          if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
          const pm = un > 0 ? uM[un - 1] : 0;
          if (pm && pm !== PASS) CM[board[mTo(pm)] * 128 + mTo(pm)] = m;
          const bonus = Math.min(depth * depth * 16, 1600);
          histAdd(board[mFrom(m)] * 128 + mTo(m), bonus);
          for (let j = 0; j < quiets - 1; j++) { const x = qt[j]; histAdd(board[mFrom(x)] * 128 + mTo(x), -bonus); }
        }
        break;
      }
    }
    if (!legal) return -(MATE - p); // only possible in check (else passing is legal)
    if (best === -INF) best = alpha;
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes, soft}. Returns {move, score, depth, nodes, ms}; score from the side to move:
  // MATE − n = mates in n plies, ±COUNT_WIN = the game ends by counting
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
    const legal = legalMoves().filter((m) => !excluded || !excluded.includes(m));
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!legal.length) { info.score = -MATE; return info; }
    if (legal.length === 1) { info.move = legal[0]; info.score = evaluate(); info.ms = Date.now() - t0; return info; }
    let best = legal[0], prev = 0;
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      let s, delta = 35, lo = -INF, hi = INF;
      if (W.asp && d >= 5 && Math.abs(prev) < COUNT_WIN - 1000) { lo = prev - delta; hi = prev + delta; }
      for (;;) {
        s = search(d, lo, hi, 0, true, false);
        if (stopped) break;
        if (s <= lo) { lo = Math.max(-INF, lo - delta); delta *= 2; if (delta > 500) lo = -INF; continue; }
        if (s >= hi) { hi = Math.min(INF, hi + delta); delta *= 2; if (delta > 500) hi = INF; if (rootBest) best = rootBest; continue; }
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
  function perft(d) { // passes not counted
    const list = new Int32Array(160), n = gen(list, false), fc = facing();
    let total = 0;
    for (let i = 0; i < n; i++) {
      make(list[i]);
      if (!inCheck(side ^ 8) && !(fc && facing())) total += d <= 1 ? 1 : perft(d - 1);
      unmake();
    }
    return total;
  }
  function features() { // evaluation as Σ coef × PV[idx], Cho's view
    TR = new Float64Array(PN);
    const v = evaluate(), t = TR;
    TR = null;
    const idx = [], coef = [];
    for (let k = 0; k < PN; k++) if (t[k]) { idx.push(k); coef.push(t[k]); }
    return { idx, coef, value: side === CHO ? v : -v };
  }
  function qscore() { nodes = 0; stopped = false; deadline = 0; maxNodes = 0; ply = 0; return qsearch(-INF, INF, 0, 0); }
  function play(m) { make(m); }
  function undo() { if (un) unmake(); }

  setup();
  return {
    CHO, HAN, SOL, GUA, ELE, HOR, CAN, CHA, GEN, MATE, MATE_BOUND, COUNT_WIN, PASS, FLAG_CAP, PLY_LIMIT, POINTS,
    setup, setFen, fen, legalMoves, play, undo, think, evaluate, qscore, features, perft, status, inCheck, facing, ttClear,
    points, countWinner, uci, sqName, mFrom, mTo, isCap, PDEF, params: () => PV.slice(), repeats,
    get side() { return side; }, get board() { return board; }, get kings() { return kingSq.slice(); }, get plies() { return un; }, get passes() { return passes; },
  };
}
if (typeof module !== 'undefined') module.exports = { JanggiEngine };

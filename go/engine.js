// Go engine for 9×9 (written for Penopi). Plain script, no build: loaded by worker.js (importScripts), by the page
// (rules) and by node (tools/test-go.mjs).
//
// Rules: area scoring (stones on the board + empty points surrounded by one colour only), komi 7.5 so there are no
// draws. Black moves first. Suicide is not allowed; a move may not repeat an earlier whole-board position
// (positional superko; the simple ko is a case of it). Two passes in a row end the game; dead stones are then found
// by playing the position out many times (see score()).
//
// Points: 0..80 = row*9 + col, row 0 at the top. Inside, an 11×11 board with a border: p = (row+1)*11 + col+1.
// Move: the point, or PASS (−1).
//
// Search: Monte Carlo tree search with RAVE (all-moves-as-first statistics), light playouts that never fill their own
// true eyes, capture a group left in atari by the last move, and run out of their own atari when they can.
// The tree is reused from move to move when the game follows it.
'use strict';

function GoEngine(opts) {
  opts = opts || {};
  const N = opts.size || 9, W = N + 2, NP = W * W, PASS = -1;
  const KOMI = opts.komi === undefined ? 7.5 : opts.komi;
  const W_PAT = opts.patterns === undefined ? 1 : opts.patterns;
  const EMPTY = 0, BLACK = 1, WHITE = 2, EDGE = 3;
  const TOP = (s) => ((s / N) | 0) * W + (s % N) + W + 1; // 0..80 → padded
  const OUT = new Int16Array(NP).fill(-1);
  const POINTS = new Int16Array(N * N);
  for (let s = 0; s < N * N; s++) { POINTS[s] = TOP(s); OUT[TOP(s)] = s; }
  const DIR = [-W, 1, W, -1], DIAG = [-W - 1, -W + 1, W - 1, W + 1];

  // ---------- a board (the game's, and a scratch one for playouts) ----------
  function Board() {
    const c = new Int8Array(NP), next = new Int16Array(NP), head = new Int16Array(NP), libs = new Int16Array(NP), size = new Int16Array(NP);
    const B = { c, next, head, libs, size, ko: -1, stm: BLACK, caps: [0, 0, 0], h1: 0, h2: 0 };
    return B;
  }
  let seed = 0x9e3779b9 | 0;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(NP * 3), Z2 = new Int32Array(NP * 3);
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd32(); Z2[i] = rnd32(); }
  function clear(B) {
    B.c.fill(EDGE);
    for (const p of POINTS) B.c[p] = EMPTY;
    B.ko = -1; B.stm = BLACK; B.caps[1] = B.caps[2] = 0; B.h1 = 0; B.h2 = 0;
  }
  function copy(dst, src) {
    dst.c.set(src.c); dst.next.set(src.next); dst.head.set(src.head); dst.libs.set(src.libs); dst.size.set(src.size);
    dst.ko = src.ko; dst.stm = src.stm; dst.caps[1] = src.caps[1]; dst.caps[2] = src.caps[2]; dst.h1 = src.h1; dst.h2 = src.h2;
  }
  // pseudo-liberties: libs[head] counts (stone, empty neighbour) pairs, so a group with libs 0 has no liberty
  function placeStone(B, p, col) {
    const { c, next, head, libs, size } = B;
    c[p] = col; head[p] = p; next[p] = p; size[p] = 1; libs[p] = 0;
    B.h1 ^= Z1[p * 3 + col]; B.h2 ^= Z2[p * 3 + col];
    for (let d = 0; d < 4; d++) { const q = p + DIR[d]; if (c[q] === EMPTY) libs[p]++; else if (c[q] !== EDGE) libs[head[q]]--; }
    for (let d = 0; d < 4; d++) {
      const q = p + DIR[d];
      if (c[q] === col && head[q] !== head[p]) { // merge the smaller string into the larger
        let a = head[p], b = head[q];
        if (size[a] > size[b]) { const t = a; a = b; b = t; }
        let s = a;
        do { head[s] = b; s = next[s]; } while (s !== a);
        const t = next[a]; next[a] = next[b]; next[b] = t;
        size[b] += size[a]; libs[b] += libs[a];
      }
    }
  }
  function removeString(B, h) {
    const { c, next, head, libs } = B;
    const col = c[h];
    let s = h, n = 0;
    do {
      c[s] = EMPTY; n++;
      B.h1 ^= Z1[s * 3 + col]; B.h2 ^= Z2[s * 3 + col];
      s = next[s];
    } while (s !== h);
    s = h;
    do { // the stones' neighbours of other strings get a liberty back each
      for (let d = 0; d < 4; d++) { const q = s + DIR[d]; if (c[q] === BLACK || c[q] === WHITE) libs[head[q]]++; }
      s = next[s];
    } while (s !== h);
    return n;
  }
  // true liberties of the string at p, up to `max` (stops early)
  const libMark = new Int32Array(NP);
  let libStamp = 0;
  function liberties(B, p, max, out) {
    const { c, next } = B;
    libStamp++;
    let n = 0, s = p;
    do {
      for (let d = 0; d < 4; d++) {
        const q = s + DIR[d];
        if (c[q] === EMPTY && libMark[q] !== libStamp) { libMark[q] = libStamp; if (out) out[n] = q; if (++n >= max) return n; }
      }
      s = next[s];
    } while (s !== p);
    return n;
  }
  // would playing col at p be legal (ignoring superko)? empty, not the ko point, not suicide
  function legalSimple(B, p, col) {
    const c = B.c;
    if (c[p] !== EMPTY || p === B.ko) return false;
    const opp = 3 - col;
    for (let d = 0; d < 4; d++) {
      const q = p + DIR[d];
      if (c[q] === EMPTY) return true;
      if (c[q] === col && B.libs[B.head[q]] > 1 && liberties(B, q, 2) > 1) return true; // joins a string that keeps a liberty
      if (c[q] === opp && liberties(B, q, 2) === 1) return true; // captures
    }
    return false;
  }
  // play col at p (must be legalSimple) or pass; returns stones captured
  const capList = new Int16Array(4);
  function playOn(B, p, col) {
    if (p === PASS) { B.ko = -1; B.stm = 3 - col; return 0; }
    const c = B.c, opp = 3 - col;
    placeStone(B, p, col);
    let captured = 0, nCap = 0, lastCap = -1;
    for (let d = 0; d < 4; d++) {
      const q = p + DIR[d];
      if (c[q] === opp && B.libs[B.head[q]] === 0) {
        const h = B.head[q], n = removeString(B, h);
        captured += n; lastCap = q; nCap++;
      }
    }
    B.caps[col] += captured;
    // a single stone captured by a single stone that now has one liberty: ko
    B.ko = -1;
    if (captured === 1 && B.size[B.head[p]] === 1 && liberties(B, p, 2) === 1) {
      for (let d = 0; d < 4; d++) { const q = p + DIR[d]; if (c[q] === EMPTY) B.ko = q; }
    }
    void nCap; void lastCap; void capList;
    B.stm = opp;
    return captured;
  }
  // would col at p leave its own string with one liberty (and capture nothing)? (a self-atari)
  const saLibs = new Int16Array(8), saOut = new Int16Array(4);
  function selfAtari(B, p, col) {
    const c = B.c, opp = 3 - col;
    let n = 0;
    const add = (q) => { if (q === p) return; for (let i = 0; i < n; i++) if (saLibs[i] === q) return; saLibs[n++] = q; };
    for (let d = 0; d < 4; d++) {
      const q = p + DIR[d];
      if (c[q] === EMPTY) add(q);
      else if (c[q] === opp && liberties(B, q, 2) === 1) return false; // captures: fine
      else if (c[q] === col) { const k = liberties(B, q, 3, saOut); for (let i = 0; i < k; i++) add(saOut[i]); }
      if (n >= 2) return false;
    }
    return n < 2;
  }
  // size of the string col would make at p (to tell a throw-in from a big self-atari)
  function joinSize(B, p, col) {
    let n = 1; const seenH = [];
    for (let d = 0; d < 4; d++) { const q = p + DIR[d]; if (B.c[q] === col && !seenH.includes(B.head[q])) { seenH.push(B.head[q]); n += B.size[B.head[q]]; } }
    return n;
  }
  // does col at p capture something?
  function capturesAt(B, p, col) {
    for (let d = 0; d < 4; d++) { const q = p + DIR[d]; if (B.c[q] === 3 - col && B.libs[B.head[q]] <= 4 && liberties(B, q, 2) === 1) return true; }
    return false;
  }
  // a true eye of col: all four neighbours col (or edge), and enough diagonals
  function isEye(B, p, col) {
    const c = B.c;
    for (let d = 0; d < 4; d++) { const v = c[p + DIR[d]]; if (v !== col && v !== EDGE) return false; }
    let bad = 0, edge = 0;
    for (let d = 0; d < 4; d++) { const v = c[p + DIAG[d]]; if (v === EDGE) edge = 1; else if (v === 3 - col) bad++; }
    return bad + edge < 2;
  }
  // area score from Black's view (stones + one-colour empty regions) minus komi
  const regMark = new Int32Array(NP), regQ = new Int16Array(NP);
  let regStamp = 0;
  function areaScore(B, dead) {
    const c = B.c;
    let black = 0, white = 0;
    const col = (p) => (dead && dead[p] ? EMPTY : c[p]);
    regStamp++;
    for (const p of POINTS) {
      const v = col(p);
      if (v === BLACK) { black++; continue; }
      if (v === WHITE) { white++; continue; }
      if (regMark[p] === regStamp) continue;
      // flood the empty region
      let qh = 0, qt = 0, n = 0, touchB = false, touchW = false;
      regQ[qt++] = p; regMark[p] = regStamp;
      while (qh < qt) {
        const s = regQ[qh++]; n++;
        for (let d = 0; d < 4; d++) {
          const q = s + DIR[d], w = c[q] === EDGE ? EDGE : col(q);
          if (w === EMPTY && regMark[q] !== regStamp) { regMark[q] = regStamp; regQ[qt++] = q; }
          else if (w === BLACK) touchB = true; else if (w === WHITE) touchW = true;
        }
      }
      if (touchB && !touchW) black += n; else if (touchW && !touchB) white += n;
    }
    return black - white - KOMI;
  }

  // ---------- playouts ----------
  const P = Board(), empt = new Int16Array(N * N), cand = new Int16Array(8), lib2 = new Int16Array(4);
  const seq = new Int16Array(N * N * 3), seqCol = new Int8Array(N * N * 3);
  let seqLen = 0;
  let rs = 0x12345678;
  const rnd = (n) => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return ((rs >>> 0) % n); };
  // ---------- 3×3 patterns (the usual Monte Carlo go shapes: hane, cuts, edge blocks) ----------
  // Written with X and O for the two colours (either way round), '.' empty, 'x' not X, 'o' not O, '?' anything,
  // ' ' off the board; the centre is the move. Every rotation, reflection and colour swap counts. Looked up by the
  // eight neighbours' states (2 bits each: empty, black, white, edge).
  const PAT_SRC = [
    ['XOX', '...', '???'], ['XO.', '...', '?.?'], ['XO?', 'X..', 'x.?'], ['.O.', 'X..', '...'],
    ['XO?', 'O.o', '?o?'], ['XO?', 'O.X', '???'], ['?X?', 'O.O', 'ooo'], ['OX?', 'o.O', '???'],
    ['X.?', 'O.?', '   '], ['OX?', 'X.O', '   '], ['?X?', 'x.O', '   '], ['?XO', 'x.x', '   '], ['?OX', 'X.O', '   '],
  ];
  const N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const PAT = new Uint8Array(65536);
  {
    const rot = (g) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => g[2 - c][r]).join(''));
    const flip = (g) => g.map((row) => row.split('').reverse().join(''));
    const swap = (g) => g.map((row) => row.replace(/[XOxo]/g, (ch) => ({ X: 'O', O: 'X', x: 'o', o: 'x' }[ch])));
    const all = [];
    for (const p0 of PAT_SRC) for (const p1 of [p0, swap(p0)]) {
      let g = p1;
      for (let k = 0; k < 4; k++) { all.push(g, flip(g)); g = rot(g); }
    }
    const POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]];
    const ok = (ch, st) => ch === '?' || (ch === '.' && st === 0) || (ch === 'X' && st === 1) || (ch === 'O' && st === 2) || (ch === ' ' && st === 3)
      || (ch === 'x' && (st === 0 || st === 2)) || (ch === 'o' && (st === 0 || st === 1));
    for (let code = 0; code < 65536; code++) {
      for (const g of all) {
        let m = true;
        for (let i = 0; i < 8 && m; i++) m = ok(g[POS[i][0]][POS[i][1]], (code >> (2 * i)) & 3);
        if (m) { PAT[code] = 1; break; }
      }
    }
  }
  function patAt(B, p) { let code = 0; for (let i = 0; i < 8; i++) code |= B.c[p + N8[i]] << (2 * i); return PAT[code]; }
  const pcand = new Int16Array(8);
  // a pattern move next to the last move (not filling my eye, legal, not a big self-atari)
  function patternMove(B, last, col) {
    if (last < 0) return -1;
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const q = last + N8[i];
      if (B.c[q] !== EMPTY || !patAt(B, q) || isEye(B, q, col) || !legalSimple(B, q, col)) continue;
      if (selfAtari(B, q, col) && joinSize(B, q, col) > 1) continue;
      pcand[n++] = q;
    }
    return n ? pcand[rnd(n)] : -1;
  }
  // a move worth playing first near the last move: capture a string the last move left in atari, or escape own atari
  function urgent(B, last, col) {
    if (last < 0) return -1;
    const c = B.c;
    let n = 0;
    for (let d = 0; d < 4; d++) { // the last stone itself or strings next to it in atari
      const q = last + DIR[d];
      if (c[q] === col && liberties(B, q, 2, lib2) === 1) { // my string in atari: run (if it gains liberties)
        const e = lib2[0];
        if (legalSimple(B, e, col)) cand[n++] = e;
      }
    }
    if (c[last] === 3 - col && liberties(B, last, 2, lib2) === 1 && legalSimple(B, lib2[0], col)) cand[n++] = lib2[0]; // capture
    return n ? cand[rnd(n)] : -1;
  }
  function playout(fromB, maxMoves) {
    copy(P, fromB);
    let passes = 0, moves = 0, last = -1;
    seqLen = 0;
    while (passes < 2 && moves < maxMoves) {
      const col = P.stm;
      let m = urgent(P, last, col);
      if (m < 0 && W_PAT && rnd(100) < 95) m = patternMove(P, last, col);
      if (m < 0) {
        // random among empty points that are legal and not my eye
        let ne = 0;
        for (const p of POINTS) if (P.c[p] === EMPTY) empt[ne++] = p;
        while (ne > 0) {
          const i = rnd(ne), p = empt[i];
          if (!isEye(P, p, col) && legalSimple(P, p, col) && !(selfAtari(P, p, col) && (joinSize(P, p, col) > 1 || rnd(2)))) { m = p; break; }
          empt[i] = empt[--ne];
        }
      }
      if (m < 0) { playOn(P, PASS, col); passes++; last = -1; }
      else { playOn(P, m, col); passes = 0; last = m; seq[seqLen] = m; seqCol[seqLen++] = col; }
      moves++;
    }
    return areaScore(P, null);
  }

  // ---------- the game ----------
  const G = Board();
  let history = [], hashes = [], passesInRow = 0, moveList = [];
  function setStart() {
    clear(G); history = []; hashes = [G.h1 + ':' + G.h2]; passesInRow = 0; moveList = [];
    treeReset();
  }
  const seen = (B) => hashes.includes(B.h1 + ':' + B.h2);
  const scratch = Board();
  // legal for the game: simple rules plus positional superko
  function legalGame(p) {
    if (!legalSimple(G, p, G.stm)) return false;
    copy(scratch, G); playOn(scratch, p, G.stm);
    return !hashes.includes(scratch.h1 + ':' + scratch.h2);
  }
  function legalMoves() { const out = []; for (let s = 0; s < N * N; s++) if (legalGame(POINTS[s])) out.push(s); out.push(PASS); return out; }
  function play(s) {
    const p = s === PASS ? PASS : POINTS[s], col = G.stm;
    const cap = playOn(G, p, col);
    history.push(s); moveList.push(s);
    hashes.push(G.h1 + ':' + G.h2);
    passesInRow = s === PASS ? passesInRow + 1 : 0;
    treeAdvance(s);
    return cap;
  }
  const status = () => (passesInRow >= 2 ? 'over' : '');

  // ---------- tree ----------
  const MAXN = opts.nodes || 300000;
  const nMove = new Int16Array(MAXN), nFirst = new Int32Array(MAXN), nCount = new Int16Array(MAXN);
  const nVis = new Float32Array(MAXN), nWin = new Float32Array(MAXN), rVis = new Float32Array(MAXN), rWin = new Float32Array(MAXN);
  let used = 0, root = 0;
  function newNode(move) {
    if (used >= MAXN) return -1;
    const i = used++;
    nMove[i] = move; nFirst[i] = -1; nCount[i] = 0; nVis[i] = 0; nWin[i] = 0; rVis[i] = 0; rWin[i] = 0;
    return i;
  }
  function treeReset() { used = 0; root = newNode(PASS); }
  // children of the root follow the game: keep the subtree if the move played was expanded, else start over
  function treeAdvance(s) {
    const p = s === PASS ? PASS : POINTS[s];
    if (nFirst[root] >= 0) for (let k = 0; k < nCount[root]; k++) {
      const ch = nFirst[root] + k;
      if (nMove[ch] === p) { root = ch; if (used > MAXN * 0.8) treeReset(); return; }
    }
    treeReset();
  }
  const PRIOR_N = 10, RAVE_K = opts.raveK || 600, UCT_C = opts.uct === undefined ? 0.05 : opts.uct;
  // expand a node for the side to move on B: every legal move (not filling own true eyes) + pass, with priors
  function expand(node, B, last) {
    if (used + N * N + 1 >= MAXN) return false;
    const col = B.stm, first = used;
    const urg = urgent(B, last, col);
    for (const p of POINTS) {
      if (B.c[p] !== EMPTY || isEye(B, p, col) || !legalSimple(B, p, col)) continue;
      const ch = newNode(p);
      // priors: even, a little better near the last move and for urgent moves, worse on the first line
      let pv = PRIOR_N, pw = PRIOR_N * 0.5;
      const r = ((p / W) | 0) - 1, cc = (p % W) - 1;
      if (r === 0 || cc === 0 || r === N - 1 || cc === N - 1) pw -= PRIOR_N * 0.1;
      if (last >= 0 && Math.abs(p - last) <= W + 1 && Math.abs(((p % W) - (last % W))) <= 1) pw += PRIOR_N * 0.1;
      if (p === urg || capturesAt(B, p, col)) { pv += PRIOR_N; pw += PRIOR_N * 0.9; }
      else if (W_PAT && last >= 0 && Math.abs(p - last) <= W + 1 && patAt(B, p)) { pv += PRIOR_N; pw += PRIOR_N * 0.8; }
      else if (selfAtari(B, p, col) && joinSize(B, p, col) > 1) { pv += PRIOR_N; pw = 0; }
      nVis[ch] = pv; nWin[ch] = pw;
    }
    newNode(PASS); // pass: tried last
    nVis[used - 1] = PRIOR_N; nWin[used - 1] = PRIOR_N * 0.1;
    nFirst[node] = first; nCount[node] = used - first;
    return true;
  }
  function select(node) {
    const f = nFirst[node], n = nCount[node];
    let best = f, bv = -1e9;
    const lnN = Math.log(nVis[node] + 1);
    for (let k = 0; k < n; k++) {
      const ch = f + k, v = nVis[ch], q = nWin[ch] / v;
      const rv = rVis[ch], beta = rv / (rv + v + rv * v / RAVE_K);
      const amaf = rv > 0 ? rWin[ch] / rv : q;
      const val = (1 - beta) * q + beta * amaf + UCT_C * Math.sqrt(lnN / v);
      if (val > bv) { bv = val; best = ch; }
    }
    return best;
  }
  const path = new Int32Array(N * N * 3), pathCol = new Int8Array(N * N * 3);
  const amafCol = new Int8Array(NP); // first colour to play each point after a node, for RAVE
  const S = Board();
  function simulate() {
    copy(S, G);
    let node = root, depth = 0, last = moveList.length ? (moveList[moveList.length - 1] === PASS ? -1 : POINTS[moveList[moveList.length - 1]]) : -1;
    let passes = passesInRow;
    path[depth++] = node;
    const treeMoves = [], treeCols = [];
    while (nFirst[node] >= 0 && passes < 2) {
      const ch = select(node), m = nMove[ch], col = S.stm;
      if (m !== PASS && !legalSimple(S, m, col)) { nVis[ch] += 1; break; } // (a ko point) treat as a loss-free skip
      playOn(S, m, col);
      treeMoves.push(m); treeCols.push(col);
      passes = m === PASS ? passes + 1 : 0; last = m === PASS ? -1 : m;
      node = ch; pathCol[depth] = col; path[depth++] = node;
    }
    if (passes < 2 && nVis[node] >= PRIOR_N + 1) { // expand on the second visit
      if (expand(node, S, last) && nCount[node]) {
        const ch = select(node), m = nMove[ch], col = S.stm;
        if (m === PASS || legalSimple(S, m, col)) {
          playOn(S, m, col); treeMoves.push(m); treeCols.push(col);
          node = ch; pathCol[depth] = col; path[depth++] = node;
          passes = m === PASS ? passes + 1 : 0;
        }
      }
    }
    const score = passes >= 2 ? areaScore(S, null) : playout(S, N * N * 3);
    const blackWins = score > 0 ? 1 : 0;
    // back up: each node's wins from the view of the colour that played its move. RAVE: a child of a node counts a
    // win or loss if its move was played later in this simulation, first by the colour to move at that node.
    amafCol.fill(0);
    for (let i = seqLen - 1; i >= 0; i--) amafCol[seq[i]] = seqCol[i]; // earliest play of each point wins
    for (let i = depth - 1; i >= 0; i--) {
      const nd = path[i];
      if (i < treeMoves.length && treeMoves[i] !== PASS) amafCol[treeMoves[i]] = treeCols[i]; // the move out of nd
      nVis[nd] += 1;
      if (i > 0) nWin[nd] += pathCol[i] === BLACK ? blackWins : 1 - blackWins;
      const f = nFirst[nd];
      if (f < 0) continue;
      const colHere = i < treeMoves.length ? treeCols[i] : S.stm, win = colHere === BLACK ? blackWins : 1 - blackWins;
      for (let k = 0; k < nCount[nd]; k++) {
        const ch = f + k, m = nMove[ch];
        if (m !== PASS && amafCol[m] === colHere) { rVis[ch] += 1; rWin[ch] += win; }
      }
    }
  }
  // cfg: {time, playouts}. Returns {move (0..80 or PASS), winrate (side to move), playouts, ms, score (Black's area
  // margin estimate)}
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now(), deadline = cfg.time ? t0 + cfg.time : 0, maxP = cfg.playouts || 0;
    if (nFirst[root] < 0) { copy(S, G); const last = moveList.length && moveList[moveList.length - 1] !== PASS ? POINTS[moveList[moveList.length - 1]] : -1; nVis[root] = PRIOR_N + 1; expand(root, S, last); }
    let n = 0;
    for (;;) {
      simulate(); n++;
      if (maxP && n >= maxP) break;
      if ((n & 63) === 0 && deadline && Date.now() >= deadline) break;
      if (!deadline && !maxP && n >= 5000) break;
    }
    // the most visited legal move (superko checked here); pass if nothing better
    const f = nFirst[root];
    let best = -1, bv = -1, bw = 0;
    for (let k = 0; k < nCount[root]; k++) {
      const ch = f + k, m = nMove[ch];
      if (nVis[ch] <= bv) continue;
      if (m !== PASS && !legalGame(m)) continue;
      best = ch; bv = nVis[ch];
    }
    const info = { move: PASS, winrate: 0.5, playouts: n, ms: Date.now() - t0 };
    if (best >= 0) { info.move = nMove[best] === PASS ? PASS : OUT[nMove[best]]; bw = nWin[best] / nVis[best]; info.winrate = bw; }
    // passing is fine when the opponent just passed and I win as things stand
    // (only when the board is settled: almost every point clearly owned in the playouts, and the search agrees)
    if (passesInRow === 1 && info.winrate > 0.7) {
      const est = estimate(200), mine = G.stm === BLACK ? est.margin : -est.margin;
      const settled = est.owner.filter((o) => Math.abs(o) > 0.7).length / est.owner.length;
      if (mine > 0 && settled > 0.9) { info.move = PASS; info.winrate = Math.max(info.winrate, 0.9); }
    }
    // hopeless: resign rather than fill my own eyes (the page lets Penopi resign); after the opponent's pass, just pass
    if (moveList.length > 20 && info.winrate < 0.06 && n >= 2000) info.resign = true;
    if (passesInRow === 1 && info.winrate < 0.15) info.move = PASS;
    return info;
  }
  // dead stones and the margin by playing the position out many times: a stone whose point ends up the other
  // colour in most playouts is dead. Returns {margin (Black, with komi, dead removed), dead: [points 0..80], owner}
  const own = new Float32Array(NP);
  function estimate(runs) {
    own.fill(0);
    for (let r = 0; r < runs; r++) {
      playout(G, N * N * 3);
      for (const p of POINTS) {
        let v = P.c[p];
        if (v === EMPTY) { // an eye: whose neighbours
          for (let d = 0; d < 4; d++) { const w = P.c[p + DIR[d]]; if (w === BLACK || w === WHITE) { v = w; break; } }
        }
        own[p] += v === BLACK ? 1 : v === WHITE ? -1 : 0;
      }
    }
    const deadArr = new Uint8Array(NP), dead = [], owner = [];
    for (const p of POINTS) {
      const o = own[p] / runs;
      owner.push(o);
      if ((G.c[p] === BLACK && o < -0.3) || (G.c[p] === WHITE && o > 0.3)) { deadArr[p] = 1; dead.push(OUT[p]); }
    }
    return { margin: areaScore(G, deadArr), dead, owner };
  }

  setStart();
  return {
    N, PASS, KOMI, BLACK, WHITE, setStart, legalMoves, play, status, think, estimate,
    legal: (s) => (s === PASS ? true : legalGame(POINTS[s])),
    cells: () => { const a = new Int8Array(N * N); for (let s = 0; s < N * N; s++) a[s] = G.c[POINTS[s]]; return a; },
    captures: (col) => G.caps[col], area: () => areaScore(G, null),
    get stm() { return G.stm; }, get passes() { return passesInRow; }, get ko() { return G.ko >= 0 ? OUT[G.ko] : -1; },
    _internals: { G, POINTS, OUT, legalSimple: (s, col) => legalSimple(G, POINTS[s], col), libsOf: (s) => liberties(G, POINTS[s], 99) },
  };
}
if (typeof module !== 'undefined') module.exports = { GoEngine };

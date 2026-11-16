// 육각잇기 (a connection game on a rhombus of hexagons, Piet Hein 1942 / John Nash 1948) engine, written for this
// site: Monte Carlo tree search with RAVE in plain JS. Loaded on the page (rules) and in worker.js (thinking).
//
// Rules: N×N rhombus, 흑 (1) moves first and connects the top and bottom rows, 백 (2) connects the left and right
// columns. One stone per move on an empty cell. The swap rule: as the second move, 백 may take 흑's first stone — it
// becomes a 백 stone at the mirrored cell (row and column exchanged), and 흑 moves again. No draws (a full board
// always has exactly one connection).
//
// Cells: s = row*N + col, row 0 at the top. Neighbours (r−1,c) (r−1,c+1) (r,c−1) (r,c+1) (r+1,c−1) (r+1,c).
// Moves: the cell, or SWAP (−2).
function HexEngine(opts) {
  opts = opts || {};
  const SWAP = -2, EMPTY = 0, BLACK = 1, WHITE = 2;
  let N = 0, NN = 0;
  let NB = [], BR = []; // neighbours; bridges per carrier cell: [a, b, other carrier] triples
  let board = new Int8Array(0), moves = [], toMove = BLACK;
  function setup(n) {
    N = n || opts.size || 9; NN = N * N;
    NB = []; BR = [];
    const on = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
    const D = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]];
    for (let s = 0; s < NN; s++) {
      const r = (s / N) | 0, c = s % N, nb = [];
      for (const [dr, dc] of D) if (on(r + dr, c + dc)) nb.push((r + dr) * N + c + dc);
      NB.push(nb); BR.push([]);
    }
    // a bridge: two cells a, b with exactly two common neighbours x, y (the carriers)
    for (let a = 0; a < NN; a++) for (let b = a + 1; b < NN; b++) {
      if (NB[a].includes(b)) continue;
      const common = NB[a].filter((x) => NB[b].includes(x));
      if (common.length !== 2) continue;
      const [x, y] = common;
      BR[x].push(a, b, y); BR[y].push(a, b, x);
    }
    board = new Int8Array(NN); moves = []; toMove = BLACK;
  }
  const mirror = (s) => (s % N) * N + ((s / N) | 0);
  function legal() {
    const out = [];
    for (let s = 0; s < NN; s++) if (!board[s]) out.push(s);
    if (moves.length === 1) out.push(SWAP);
    return out;
  }
  function play(m) {
    if (m === SWAP) {
      if (moves.length !== 1) throw new Error('swap only as the second move');
      const s = moves[0];
      board[s] = EMPTY; board[mirror(s)] = WHITE;
      moves.push(SWAP); toMove = BLACK;
      return;
    }
    if (m < 0 || m >= NN || board[m]) throw new Error('illegal move ' + m);
    board[m] = toMove; moves.push(m); toMove = 3 - toMove;
  }
  // the winner (1/2) or 0; with path: the cells of a winning chain
  const seen = new Int32Array(1024);
  let stamp = 0;
  function connected(b, col, path) {
    stamp++;
    if (seen.length < NN) return false;
    const stack = [], from = path ? new Int32Array(NN).fill(-1) : null;
    for (let i = 0; i < N; i++) { const s = col === BLACK ? i : i * N; if (b[s] === col) { seen[s] = stamp; stack.push(s); } }
    while (stack.length) {
      const s = stack.pop(), r = (s / N) | 0, c = s % N;
      if (col === BLACK ? r === N - 1 : c === N - 1) {
        if (path) { for (let t = s; t >= 0; t = from[t]) path.push(t); }
        return true;
      }
      const nb = NB[s];
      for (let i = 0; i < nb.length; i++) { const t = nb[i]; if (b[t] === col && seen[t] !== stamp) { seen[t] = stamp; if (from) from[t] = s; stack.push(t); } }
    }
    return false;
  }
  function winner(path) {
    if (connected(board, BLACK, path)) return BLACK;
    if (connected(board, WHITE, path)) return WHITE;
    return 0;
  }

  // ---------- search ----------
  const CAP = opts.nodes || 600000;
  const nMove = new Int16Array(CAP), nChild = new Int32Array(CAP), nCount = new Int16Array(CAP);
  const nVis = new Float32Array(CAP), nWin = new Float32Array(CAP), rVis = new Float32Array(CAP), rWin = new Float32Array(CAP);
  let used = 0;
  const RAVE_K = opts.raveK || 3000, UCT_C = opts.uct ?? 0.05;
  let EXPAND = 2; // visits before a node gets its children: more on bigger boards, so the node store lasts a whole search
  let seed = (opts.seed || 12345) >>> 0;
  const rnd = (n) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % n); };
  function newNode(m) { const i = used++; nMove[i] = m; nChild[i] = -1; nCount[i] = 0; nVis[i] = 0; nWin[i] = 0; rVis[i] = 0; rWin[i] = 0; return i; }
  let pb = new Int8Array(0), empt = new Int16Array(0), pos = new Int16Array(0);
  // children of node i in position b (empty cells; swap at ply 1)
  function expand(i, b, ply) {
    let n = 0;
    for (let s = 0; s < NN; s++) if (!b[s]) n++;
    if (ply === 1) n++;
    if (used + n > CAP) return false;
    nChild[i] = used; nCount[i] = n;
    for (let s = 0; s < NN; s++) if (!b[s]) newNode(s);
    if (ply === 1) newNode(SWAP);
    return true;
  }
  function select(i) {
    const c0 = nChild[i], n = nCount[i], lnN = Math.log(nVis[i] + 1);
    let best = c0, bv = -1;
    for (let k = c0; k < c0 + n; k++) {
      const v = nVis[k], rv = rVis[k];
      let q;
      if (v + rv === 0) q = 0.6 + rnd(1000) * 1e-5; // first-play urgency
      else {
        const beta = rv / (rv + v + v * rv / RAVE_K + 1e-9);
        const qa = rv ? rWin[k] / rv : 0.5, qm = v ? nWin[k] / v : 0.5;
        q = (1 - beta) * qm + beta * qa + (v ? UCT_C * Math.sqrt(lnN / v) : 0.1);
      }
      if (q > bv) { bv = q; best = k; }
    }
    return best;
  }
  const path = new Int32Array(1024), pathMover = new Int8Array(1024);
  // one playout from the current position: random fill, answering bridge intrusions
  function playout(b, mover, last) {
    let ne = 0;
    for (let s = 0; s < NN; s++) if (!b[s]) { pos[s] = ne; empt[ne++] = s; } else pos[s] = -1;
    const take = (s) => { const k = pos[s], t = empt[--ne]; empt[k] = t; pos[t] = k; pos[s] = -1; };
    let col = mover;
    while (ne > 0) {
      let s = -1;
      // the opponent's last stone went into one of my bridges: complete it
      if (last >= 0) {
        const br = BR[last];
        for (let k = 0; k < br.length; k += 3) if (b[br[k]] === col && b[br[k + 1]] === col && !b[br[k + 2]]) { s = br[k + 2]; break; }
      }
      if (s < 0) s = empt[rnd(ne)];
      take(s); b[s] = col; last = s; col = 3 - col;
    }
    return connected(b, BLACK, null) ? BLACK : WHITE;
  }
  let root = -1, rootKey = '';
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now(), deadline = cfg.time ? t0 + cfg.time : 0, maxP = cfg.playouts || 0;
    if (pb.length !== NN) { pb = new Int8Array(NN); empt = new Int16Array(NN); pos = new Int16Array(NN); }
    EXPAND = opts.expand || Math.max(2, Math.round(NN / 4));
    used = 0; root = newNode(-1);
    const ply0 = moves.length, me = toMove;
    let playouts = 0;
    if (!expand(root, board, ply0)) throw new Error('out of nodes');
    while (true) {
      if ((playouts & 63) === 0 && ((deadline && Date.now() >= deadline) || (maxP && playouts >= maxP))) break;
      pb.set(board);
      let i = root, depth = 0, col = toMove, ply = ply0, last = moves.length ? moves[moves.length - 1] : -1;
      // descend
      while (nCount[i] > 0) {
        const k = select(i);
        path[depth] = k; pathMover[depth] = col; depth++;
        const m = nMove[k];
        if (m === SWAP) { const s = moves[0]; pb[s] = EMPTY; pb[mirror(s)] = WHITE; col = BLACK; last = mirror(s); }
        else { pb[m] = col; col = 3 - col; last = m; }
        ply++; i = k;
        if (nVis[k] + 1 >= EXPAND && nCount[k] === 0) { if (!won(pb)) expand(k, pb, ply); }
        if (nCount[k] === 0) break;
      }
      const w = won(pb) || playout(pb, col, last);
      playouts++;
      // back up: node values from the mover's view; RAVE from the final board
      nVis[root]++; if (w === me) nWin[root]++;
      let parentCol = toMove, parent = root;
      for (let d = 0; d < depth; d++) {
        const k = path[d], mover = pathMover[d];
        nVis[k]++; if (w === mover) nWin[k]++;
        // AMAF: every sibling whose cell the mover owns at the end
        const c0 = nChild[parent], n = nCount[parent];
        for (let j = c0; j < c0 + n; j++) { const m = nMove[j]; if (m >= 0 && pb[m] === mover) { rVis[j]++; if (w === mover) rWin[j]++; } }
        parent = k; parentCol = 3 - parentCol;
      }
      void parentCol;
    }
    // the most visited move
    const c0 = nChild[root], n = nCount[root];
    let best = c0;
    for (let k = c0; k < c0 + n; k++) if (nVis[k] > nVis[best]) best = k;
    const v = nVis[best];
    return { move: nMove[best], p: v ? nWin[best] / v : 0.5, playouts, ms: Date.now() - t0, nodes: used };
  }
  function won(b) { // a finished position inside the tree: who connected (0 if nobody)
    if (connected(b, BLACK, null)) return BLACK;
    if (connected(b, WHITE, null)) return WHITE;
    return 0;
  }
  void rootKey;

  setup(opts.size || 9);
  return {
    SWAP, BLACK, WHITE, setup, legal, play, winner, think, mirror,
    get size() { return N; }, get board() { return board; }, get toMove() { return toMove; }, get moves() { return moves.slice(); },
    neighbours: (s) => NB[s].slice(),
  };
}
if (typeof module !== 'undefined') module.exports = { HexEngine };

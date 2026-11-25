// Hnefatafl engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules: legal moves, result) and by node (tools/test-hnefatafl.mjs).
//
// Rules (the Viking board game, after the Copenhagen rules, simplified): a square board with a throne in the middle and a
// refuge in each corner. The attackers (24, or 8 on the small board) move first and want to capture the king; the defenders
// (12 and a king, or 4 and a king) want the king on a corner. Every piece moves like a rook, any distance over empty
// squares. Only the king may stop on the throne and on the corners; the other pieces may pass over the empty throne.
// Capture: closing in on an enemy piece between two of yours (a move that closes it; walking in between is safe). The corners
// and the throne count as hostile to the enemy when you close in against them: corners to everyone, the throne to the
// attackers always and to the defenders when it is empty. The king is armed. The king is taken by four attackers around him
// (three and the empty throne next to it; four on it) on the 11×11 board; on the 7×7 board like any other piece by two
// attackers (but four on the throne). A side that can't move loses; the same position three times is a draw
// (so is move 300).
//
// Board: Int8Array(N*N), sq = row*N + col, row 0 is the attackers' top. 0 empty, 1 attacker, 2 defender, 3 king.
// Move: from | to << 7.
//
// Search: negamax alpha-beta (PVS), iterative deepening, transposition table, killer/history, king-escape lookahead.
'use strict';

function HnefataflEngine(opts) {
  opts = opts || {};
  const ATT = 1, DEF = 2;
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const MAXPLY = 60, PLY_LIMIT = 300;

  const W = Object.assign({ guard: 40, edge: 70, near: 22, free: 4, dist: 16, def7: 260, def11: 230 }, opts.weights || {});
  let N = 0, NN = 0, THRONE = 0, KING_FOUR = false;
  let CORNERS = [];
  const board = new Int8Array(121);
  let kingSq = -1, stm = ATT, plies = 0;
  const count = [0, 0, 0, 0];
  let seed = 0x1b873593 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(4 * 121), Z2 = new Int32Array(4 * 121);
  for (let i = 0; i < 4 * 121; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  const hist1 = [], hist2 = [];

  const LAYOUTS = {
    7: {
      att: [[0, 3], [1, 3], [5, 3], [6, 3], [3, 0], [3, 1], [3, 5], [3, 6]],
      def: [[2, 3], [4, 3], [3, 2], [3, 4]],
    },
    11: {
      att: [[0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 5], [10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [9, 5],
        [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [5, 1], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [5, 9]],
      def: [[3, 5], [4, 4], [4, 5], [4, 6], [5, 3], [5, 4], [5, 6], [5, 7], [6, 4], [6, 5], [6, 6], [7, 5]],
    },
  };
  function startArray(size) {
    const b = new Int8Array(121), n = size;
    for (const [r, c] of LAYOUTS[size].att) b[r * n + c] = 1;
    for (const [r, c] of LAYOUTS[size].def) b[r * n + c] = 2;
    b[((n - 1) / 2) * n + (n - 1) / 2] = 3;
    return b;
  }
  function setSize(size) {
    N = size; NN = N * N; THRONE = ((N - 1) / 2) * N + (N - 1) / 2; KING_FOUR = N === 11;
    CORNERS = [0, N - 1, (N - 1) * N, N * N - 1];
  }
  function setPosition(arr, side, played) {
    board.fill(0); for (let i = 0; i < NN; i++) board[i] = arr[i];
    stm = side; plies = played || 0; h1 = 0; h2 = 0; kingSq = -1;
    count[1] = count[2] = count[3] = 0;
    for (let s = 0; s < NN; s++) {
      const p = board[s];
      if (!p) continue;
      count[p]++; h1 ^= Z1[p * 121 + s]; h2 ^= Z2[p * 121 + s];
      if (p === 3) kingSq = s;
    }
    if (stm === DEF) { h1 ^= ZS1; h2 ^= ZS2; }
    hist1.length = 0; hist2.length = 0; hist1.push(h1); hist2.push(h2);
  }

  const isCorner = (s) => s === CORNERS[0] || s === CORNERS[1] || s === CORNERS[2] || s === CORNERS[3];
  const rowOf = (s) => (s / N) | 0, colOf = (s) => s % N;
  const mine = (side, p) => (side === ATT ? p === 1 : p === 2 || p === 3);

  // ---------- moves ----------
  const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1];
  function genMoves(side, list) {
    let n = 0;
    for (let s = 0; s < NN; s++) {
      const p = board[s];
      if (!mine(side, p)) continue;
      const r = rowOf(s), c = colOf(s);
      for (let d = 0; d < 4; d++) {
        let rr = r + DR[d], cc = c + DC[d];
        while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
          const q = rr * N + cc;
          if (board[q]) break;
          if (q === THRONE && p !== 3) { rr += DR[d]; cc += DC[d]; continue; } // pass over the empty throne
          if (isCorner(q) && p !== 3) break;
          list[n++] = s | (q << 7);
          rr += DR[d]; cc += DC[d];
        }
      }
    }
    return n;
  }
  // can the king run to a corner in one move? returns how many corners
  function kingEscapes() {
    if (kingSq < 0) return 0;
    let n = 0;
    const r = rowOf(kingSq), c = colOf(kingSq);
    for (let d = 0; d < 4; d++) {
      let rr = r + DR[d], cc = c + DC[d];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
        const q = rr * N + cc;
        if (board[q]) break;
        if (isCorner(q)) { n++; break; }
        rr += DR[d]; cc += DC[d];
      }
    }
    return n;
  }

  const capStack = [], capCount = [];
  function make(m) {
    const from = m & 127, to = (m >> 7) & 127, side = stm, p = board[from];
    board[from] = 0; h1 ^= Z1[p * 121 + from]; h2 ^= Z2[p * 121 + from];
    board[to] = p; h1 ^= Z1[p * 121 + to]; h2 ^= Z2[p * 121 + to];
    if (p === 3) kingSq = to;
    // captures by the moved piece
    let ncap = 0;
    const r = rowOf(to), c = colOf(to);
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d], cc = c + DC[d];
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      const q = rr * N + cc, e = board[q];
      if (!e || mine(side, e)) continue;
      const r2 = rr + DR[d], c2 = cc + DC[d];
      let take = false;
      if (e === 3) take = kingTaken(q, to, d);
      else if (r2 >= 0 && r2 < N && c2 >= 0 && c2 < N) {
        const far = r2 * N + c2, f = board[far];
        if (mine(side, f)) take = true;
        else if (isCorner(far)) take = true;
        else if (far === THRONE && (side === DEF || f === 0)) take = true; // throne: hostile to attackers always, to defenders when empty
      }
      if (take) {
        capStack.push(q, e); ncap++;
        board[q] = 0; h1 ^= Z1[e * 121 + q]; h2 ^= Z2[e * 121 + q]; count[e]--;
        if (e === 3) kingSq = -1;
      }
    }
    capCount.push(ncap);
    stm = 3 - side; plies++; h1 ^= ZS1; h2 ^= ZS2;
    hist1.push(h1); hist2.push(h2);
  }
  // is the king on q taken by the attacker who just moved to `to` (coming from direction d)?
  function kingTaken(q, to, d) {
    const r = rowOf(q), c = colOf(q);
    if (KING_FOUR || q === THRONE) { // all four sides: attackers (the empty throne counts when next to it)
      for (let k = 0; k < 4; k++) {
        const rr = r + DR[k], cc = c + DC[k];
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) return false;
        const s = rr * N + cc;
        if (board[s] === 1) continue;
        if (s === THRONE && q !== THRONE && board[s] === 0) continue;
        return false;
      }
      return true;
    }
    const rr = r + DR[d], cc = c + DC[d];
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) return false;
    const far = rr * N + cc;
    return board[far] === 1 || isCorner(far) || (far === THRONE && board[far] === 0);
  }
  function unmake(m) {
    hist1.pop(); hist2.pop();
    const from = m & 127, to = (m >> 7) & 127;
    stm = 3 - stm; plies--; h1 ^= ZS1; h2 ^= ZS2;
    const ncap = capCount.pop();
    for (let i = 0; i < ncap; i++) {
      const e = capStack.pop(), q = capStack.pop();
      board[q] = e; h1 ^= Z1[e * 121 + q]; h2 ^= Z2[e * 121 + q]; count[e]++;
      if (e === 3) kingSq = q;
    }
    const p = board[to];
    board[to] = 0; h1 ^= Z1[p * 121 + to]; h2 ^= Z2[p * 121 + to];
    board[from] = p; h1 ^= Z1[p * 121 + from]; h2 ^= Z2[p * 121 + from];
    if (p === 3) kingSq = from;
  }

  const SCRATCH = new Int32Array(1024);
  function repeats() { // how many times the current position has occurred (including now)
    let n = 0;
    for (let i = hist1.length - 1, k = 0; i >= 0 && k < 60; i -= 2, k++) if (hist1[i] === h1 && hist2[i] === h2) n++;
    return n;
  }
  // 0 playing, 1 attackers win, 2 defenders win, 3 draw
  function result() {
    if (kingSq < 0) return ATT;
    if (isCorner(kingSq)) return DEF;
    if (genMoves(stm, SCRATCH) === 0) return 3 - stm;
    if (repeats() >= 3 || plies >= PLY_LIMIT) return 3;
    return 0;
  }
  const status = () => (result() ? 'over' : 'play');

  // ---------- evaluation ----------
  // from the side to move. Attackers: pieces, a guarded king; defenders: pieces, a king with room and routes to a corner.
  const cornerDist = (s) => {
    const r = rowOf(s), c = colOf(s);
    return Math.min(r, N - 1 - r) + Math.min(c, N - 1 - c);
  };
  function evaluate() {
    // value everything from the attackers' view, then flip
    const a = count[1], d = count[2];
    let v = a * 100 - d * (N === 7 ? W.def7 : W.def11); // a defender is worth more than an attacker
    // the king: close to a corner is good for the defenders, free lines even more
    const r = rowOf(kingSq), c = colOf(kingSq);
    v += W.dist * cornerDist(kingSq);
    let free = 0, near = 0;
    for (let k = 0; k < 4; k++) {
      let rr = r + DR[k], cc = c + DC[k], len = 0;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && !board[rr * N + cc]) { len++; rr += DR[k]; cc += DC[k]; }
      free += len;
      const rr2 = r + DR[k], cc2 = c + DC[k];
      if (rr2 >= 0 && rr2 < N && cc2 >= 0 && cc2 < N && board[rr2 * N + cc2] === 1) near++;
      if (!(rr >= 0 && rr < N && cc >= 0 && cc < N)) { /* ran off the edge: an open line to the edge */ v -= W.edge; }
    }
    v -= W.free * free;
    v += W.near * near;
    // attackers sitting next to the corners (the diagonal guards) stop the king's last run
    for (const cs of CORNERS) {
      const cr = rowOf(cs), cc = colOf(cs), sr = cr === 0 ? 1 : -1, sc = cc === 0 ? 1 : -1;
      for (const [x, y] of [[0, 2], [1, 1], [2, 0]]) if (board[(cr + sr * x) * N + cc + sc * y] === 1) v += W.guard;
    }
    return stm === ATT ? v : -v;
  }

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  let ply = 0;
  const toTT = (s) => (s >= WIN_BOUND ? s + ply : s <= -WIN_BOUND ? s - ply : s);
  const fromTT = (s) => (s >= WIN_BOUND ? s - ply : s <= -WIN_BOUND ? s + ply : s);

  // ---------- search ----------
  const MV = [], SC = [];
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(1024)); SC.push(new Int32Array(1024)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(2 * 128 * 128);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 511) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  const histIdx = (m) => (stm - 1) * 16384 + (m & 127) * 128 + ((m >> 7) & 127);
  function search(depth, alpha, beta, p, root) {
    nodes++;
    if (timeUp()) return 0;
    if (!root) {
      if (kingSq < 0) return stm === ATT ? WIN - ply : -(WIN - ply);       // (the side that just moved took the king: attackers won)
      if (isCorner(kingSq)) return stm === DEF ? WIN - ply : -(WIN - ply);
      if (repeats() >= 2 || plies >= PLY_LIMIT) return 0;
    }
    // defenders to move with the king one run from a corner win at once
    if (stm === DEF && kingEscapes() > 0) return WIN - ply - 1;
    const list = MV[p], n = genMoves(stm, list);
    if (n === 0) return -(WIN - ply);
    if (depth <= 0) return evaluate();
    const a0 = alpha, idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!root && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), f = tFlag[idx];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }
    const sc = SC[p];
    for (let i = 0; i < n; i++) {
      const m = list[i];
      sc[i] = m === ttMove ? 1 << 30 : m === KIL[p * 2] ? 1 << 20 : m === KIL[p * 2 + 1] ? (1 << 20) - 1 : HIST[histIdx(m)];
      if ((board[m & 127] === 3)) sc[i] += 1 << 22; // king moves first (escapes)
    }
    let best = -INF, bestMove = list[0];
    for (let i = 0; i < n; i++) {
      let b = i;
      for (let j = i + 1; j < n; j++) if (sc[j] > sc[b]) b = j;
      if (b !== i) { let t = list[i]; list[i] = list[b]; list[b] = t; t = sc[i]; sc[i] = sc[b]; sc[b] = t; }
      const m = list[i], hi = histIdx(m);
      make(m); ply++;
      let s;
      if (i === 0) s = -search(depth - 1, -beta, -alpha, p + 1, false);
      else {
        s = -search(depth - 1, -alpha - 1, -alpha, p + 1, false);
        if (s > alpha && s < beta && !stopped) s = -search(depth - 1, -beta, -alpha, p + 1, false);
      }
      ply--; unmake(m);
      if (stopped) return 0;
      if (s > best) { best = s; bestMove = m; if (root) rootBest = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
        HIST[hi] += depth * depth;
        break;
      }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }

  // cfg: {time: ms, depth, nodes, soft}; returns {move, score, depth, nodes, ms, pv}; score from the side to move
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    const soft = cfg.time ? cfg.time * (cfg.soft || 0.5) : 0, maxDepth = Math.min(cfg.depth || 64, MAXPLY - 4);
    nodes = 0; stopped = false; ply = 0;
    KIL.fill(0);
    for (let i = 0; i < HIST.length; i++) HIST[i] >>= 3;
    if (cfg.clearTT) ttClear();
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0, pv: [] };
    const root = new Int32Array(1024), n = genMoves(stm, root);
    if (!n) { info.score = -WIN; info.ms = Date.now() - t0; return info; }
    let best = root[0];
    info.move = best;
    // a move that wins on the spot: the king to a corner, or a capture of the king
    if (stm === DEF && kingEscapes() > 0) {
      for (let i = 0; i < n; i++) { const m = root[i]; if (board[m & 127] === 3 && isCorner((m >> 7) & 127)) { info.move = m; info.score = WIN - 1; info.depth = 1; info.ms = Date.now() - t0; return info; } }
    }
    if (n === 1 && cfg.time) deadline = t0 + Math.min(cfg.time, 250);
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = 0;
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) { if (rootBest && d > 1) best = rootBest; break; }
      if (rootBest) best = rootBest;
      info.depth = d; info.score = sc; info.move = best;
      if (Math.abs(sc) >= WIN_BOUND) break;
      if (soft && Date.now() - t0 >= soft) break;
      if (maxNodes && nodes >= maxNodes * 0.5) break;
    }
    info.move = best;
    info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- helpers for the page ----------
  function legalMoves() {
    const list = new Int32Array(1024), n = genMoves(stm, list);
    return Array.from(list.subarray(0, n));
  }
  // the squares emptied by the last move (for the page's pencil marks), recomputed from the capture stack
  function lastCaptured() {
    const k = capCount.length ? capCount[capCount.length - 1] : 0, out = [];
    for (let i = 0; i < k; i++) out.push([capStack[capStack.length - 2 - 2 * i], capStack[capStack.length - 1 - 2 * i]]);
    return out; // [square, piece]
  }
  function perft(d) {
    if (d === 0) return 1;
    const list = new Int32Array(1024), n = genMoves(stm, list);
    if (d === 1) return n;
    let total = 0;
    for (let i = 0; i < n; i++) {
      make(list[i]);
      if (!(kingSq < 0 || isCorner(kingSq))) total += perft(d - 1); else total += 1;
      unmake(list[i]);
    }
    return total;
  }
  const sqName = (s) => 'abcdefghijk'[colOf(s)] + (N - rowOf(s));
  const moveStr = (m) => sqName(m & 127) + '-' + sqName((m >> 7) & 127);
  function setStart(size) { const sz = size || N || 7; setSize(sz); setPosition(startArray(sz), ATT, 0); }

  setSize(opts.size || 7);
  setPosition(startArray(N), ATT, 0);
  return {
    ATT, DEF, WIN, WIN_BOUND, startArray, setPosition, setSize, setStart,
    legalMoves, play: make, undo: unmake, result, status, think, evaluate, perft, sqName, moveStr, kingEscapes, lastCaptured, ttClear,
    get stm() { return stm; }, get board() { return board; }, get plies() { return plies; }, get size() { return N; }, get throne() { return THRONE; },
    get corners() { return CORNERS.slice(); }, get kingSq() { return kingSq; }, get hash() { return [h1, h2]; },
    pieceCount: (p) => count[p],
  };
}
if (typeof module !== 'undefined') module.exports = { HnefataflEngine };

// Surakarta engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules: legal moves, result) and by node (tools/test-surakarta.mjs).
//
// Rules (the traditional game from Java): 6×6 points, each side 12 pieces on its two home rows; Black moves first.
// A piece either steps one point in any of the 8 directions onto an empty point, or captures along a circuit:
// two closed loops run along the 2nd/5th lines (small loop) and the 3rd/4th lines (big loop), joined at the corners by
// arcs. A piece travels along a loop in either direction over empty points (its own starting point counts as empty)
// and captures the first enemy piece it meets; its own side's pieces block it. It goes straight at the crossings,
// never turns. Whoever captures all enemy pieces wins; a side that cannot move loses; if 40 plies pass without a
// capture the side with more pieces wins (equal: a draw).
//
// Board: Int8Array(36), sq = row*6 + col, row 0 = Black's back row. 1 black (rows 0,1), 2 white (rows 4,5).
// Move: from | to << 6 | (capture ? 4096 : 0).
//
// Search: negamax alpha-beta (PVS), iterative deepening, transposition table (two 32-bit Zobrist keys), killer/history,
// capture-only quiescence. Evaluation: piece count and how many captures each side threatens.
'use strict';

function SurakartaEngine(opts) {
  opts = opts || {};
  const BLACK = 1, WHITE = 2;
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const MAXPLY = 80, QUIET_LIMIT = 40;

  // the two circuits as 24 squares each, in travelling order (a square on a crossing appears twice)
  const sq = (r, c) => r * 6 + c;
  const range = (a, b) => { const out = []; if (a <= b) for (let i = a; i <= b; i++) out.push(i); else for (let i = a; i >= b; i--) out.push(i); return out; };
  function circuit(a, b) { // a: the small-numbered line (1 or 2), b = 5 − a
    const out = [];
    for (const c of range(0, 5)) out.push(sq(a, c));      // row a, left to right
    for (const r of range(0, 5)) out.push(sq(r, b));      // column b, top to bottom
    for (const c of range(5, 0)) out.push(sq(b, c));      // row b, right to left
    for (const r of range(5, 0)) out.push(sq(r, a));      // column a, bottom to top
    return out;
  }
  const CIRCUITS = [circuit(1, 4), circuit(2, 3)];
  // for each square, the (circuit, index) places it sits at
  const ON = Array.from({ length: 36 }, () => []);
  CIRCUITS.forEach((c, ci) => c.forEach((s, i) => ON[s].push([ci, i])));

  // ---------- board state ----------
  const board = new Int8Array(36);
  const count = [0, 0, 0];
  let stm = BLACK, quiet = 0, plies = 0;
  let seed = 0x7f4a7c15 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(3 * 36), Z2 = new Int32Array(3 * 36);
  for (let i = 0; i < 3 * 36; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  const NEIGH = Array.from({ length: 36 }, (_, s) => {
    const r = Math.floor(s / 6), c = s % 6, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && r + dr >= 0 && r + dr < 6 && c + dc >= 0 && c + dc < 6) out.push((r + dr) * 6 + c + dc);
    }
    return out;
  });

  function startArray() {
    const b = new Int8Array(36);
    for (let s = 0; s < 12; s++) b[s] = BLACK;
    for (let s = 24; s < 36; s++) b[s] = WHITE;
    return b;
  }
  function setPosition(arr, side, quietPlies) {
    board.set(arr); stm = side; quiet = quietPlies || 0; plies = 0;
    count[1] = count[2] = 0; h1 = 0; h2 = 0;
    for (let s = 0; s < 36; s++) if (board[s]) { count[board[s]]++; h1 ^= Z1[board[s] * 36 + s]; h2 ^= Z2[board[s] * 36 + s]; }
    if (stm === WHITE) { h1 ^= ZS1; h2 ^= ZS2; }
  }

  // ---------- moves ----------
  const SEEN = new Int32Array(36);
  let seenStamp = 0;
  // captures of `side` into list; returns the new length
  function genCaptures(side, list, n) {
    for (let s = 0; s < 36; s++) {
      if (board[s] !== side) continue;
      seenStamp++;
      const places = ON[s];
      for (let pi = 0; pi < places.length; pi++) {
        const circ = CIRCUITS[places[pi][0]], i = places[pi][1];
        for (let dir = -1; dir <= 1; dir += 2) {
          for (let k = 1; k < 24; k++) {
            const q = circ[(i + dir * k + 48) % 24];
            if (q === s) continue;
            const b = board[q];
            if (!b) continue;
            if (b !== side && SEEN[q] !== seenStamp) { SEEN[q] = seenStamp; list[n++] = s | (q << 6) | 4096; }
            break;
          }
        }
      }
    }
    return n;
  }
  function genMoves(side, list) {
    let n = genCaptures(side, list, 0);
    for (let s = 0; s < 36; s++) {
      if (board[s] !== side) continue;
      const nb = NEIGH[s];
      for (let j = 0; j < nb.length; j++) if (!board[nb[j]]) list[n++] = s | (nb[j] << 6);
    }
    return n;
  }
  const taken = [], quietStack = [];
  function make(m) {
    const from = m & 63, to = (m >> 6) & 63, side = stm, opp = 3 - side;
    quietStack.push(quiet);
    const cap = board[to];
    taken.push(cap);
    board[from] = 0; h1 ^= Z1[side * 36 + from]; h2 ^= Z2[side * 36 + from];
    if (cap) { h1 ^= Z1[cap * 36 + to]; h2 ^= Z2[cap * 36 + to]; count[opp]--; quiet = 0; } else quiet++;
    board[to] = side; h1 ^= Z1[side * 36 + to]; h2 ^= Z2[side * 36 + to];
    stm = opp; plies++; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmake(m) {
    const from = m & 63, to = (m >> 6) & 63;
    stm = 3 - stm; plies--; h1 ^= ZS1; h2 ^= ZS2;
    const side = stm, cap = taken.pop();
    quiet = quietStack.pop();
    board[to] = cap; h1 ^= Z1[side * 36 + to]; h2 ^= Z2[side * 36 + to];
    if (cap) { h1 ^= Z1[cap * 36 + to]; h2 ^= Z2[cap * 36 + to]; count[3 - side]++; }
    board[from] = side; h1 ^= Z1[side * 36 + from]; h2 ^= Z2[side * 36 + from];
  }
  const SCRATCH = new Int32Array(512);
  const hasMove = () => genMoves(stm, SCRATCH) > 0;
  // 'over' when a side has no pieces, the side to move cannot move, or 40 plies went by without a capture
  function result() { // 0 still playing, 1 black wins, 2 white wins, 3 draw
    if (count[WHITE] === 0) return BLACK;
    if (count[BLACK] === 0) return WHITE;
    if (!hasMove()) return 3 - stm;
    if (quiet >= QUIET_LIMIT) return count[BLACK] > count[WHITE] ? BLACK : count[WHITE] > count[BLACK] ? WHITE : 3;
    return 0;
  }
  const status = () => (result() ? 'over' : 'play');

  // ---------- evaluation ----------
  const CAPS = new Int32Array(512);
  function evaluate() { // for the side to move
    const me = stm, opp = 3 - me;
    const a = genCaptures(me, CAPS, 0), b = genCaptures(opp, CAPS, 0);
    return 100 * (count[me] - count[opp]) + 6 * (a - b) + 4;
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
  for (let i = 0; i < MAXPLY + 8; i++) { MV.push(new Int32Array(512)); SC.push(new Int32Array(512)); }
  const KIL = new Int32Array((MAXPLY + 8) * 2), HIST = new Int32Array(4096 * 2);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  // the end of the game inside the search: a score for the side to move, or null if it goes on
  function terminal() { // (a side with no move is found by the search itself)
    let r = 0;
    if (count[WHITE] === 0) r = BLACK;
    else if (count[BLACK] === 0) r = WHITE;
    else if (quiet >= QUIET_LIMIT) r = count[BLACK] > count[WHITE] ? BLACK : count[WHITE] > count[BLACK] ? WHITE : 3;
    if (!r) return null;
    if (r === 3) return 0;
    return r === stm ? WIN - ply : -(WIN - ply);
  }
  function qsearch(alpha, beta, p, qd) {
    nodes++;
    if (timeUp()) return 0;
    const t = terminal();
    if (t !== null) return t;
    const stand = evaluate();
    if (qd >= 6 || p >= MAXPLY) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const list = MV[p], n = genCaptures(stm, list, 0);
    let best = stand;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      make(m); ply++;
      const s = -qsearch(-beta, -alpha, p + 1, qd + 1);
      ply--; unmake(m);
      if (stopped) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }
  const histIdx = (m) => (stm - 1) * 4096 + (m & 4095);
  function search(depth, alpha, beta, p, root) {
    nodes++;
    if (timeUp()) return 0;
    if (!root) { const t = terminal(); if (t !== null) return t; }
    if (depth <= 0) return qsearch(alpha, beta, p, 0);
    const a0 = alpha, idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!root && tDepth[idx] >= depth && quiet < QUIET_LIMIT - 8) {
        const s = fromTT(tScore[idx]), f = tFlag[idx];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }
    const list = MV[p], sc = SC[p], n = genMoves(stm, list);
    if (n === 0) return -(WIN - ply);
    for (let i = 0; i < n; i++) {
      const m = list[i];
      sc[i] = m === ttMove ? 1 << 30 : (m & 4096) ? (1 << 28) : m === KIL[p * 2] ? 1 << 20 : m === KIL[p * 2 + 1] ? (1 << 20) - 1 : HIST[histIdx(m)];
    }
    let best = -INF, bestMove = list[0];
    for (let i = 0; i < n; i++) {
      let b = i;
      for (let j = i + 1; j < n; j++) if (sc[j] > sc[b]) b = j;
      if (b !== i) { let t = list[i]; list[i] = list[b]; list[b] = t; t = sc[i]; sc[i] = sc[b]; sc[b] = t; }
      const m = list[i];
      const hi = histIdx(m);
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
        if (!(m & 4096)) {
          if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
          HIST[hi] += depth * depth;
        }
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
    const root = new Int32Array(512), n = genMoves(stm, root);
    if (!n) { info.score = -WIN; info.ms = Date.now() - t0; return info; }
    let best = root[0];
    info.move = best;
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
    const list = new Int32Array(512), n = genMoves(stm, list);
    return Array.from(list.subarray(0, n));
  }
  function perft(d) {
    if (d === 0) return 1;
    const list = new Int32Array(512), n = genMoves(stm, list);
    if (d === 1) return n;
    let total = 0;
    for (let i = 0; i < n; i++) { make(list[i]); total += perft(d - 1); unmake(list[i]); }
    return total;
  }
  // the squares a capturing piece passes on the way, from `from` to `to` (for drawing): the loop path, for each way that works
  function paths(from, to) {
    const out = [];
    for (const [ci, i] of ON[from]) {
      const circ = CIRCUITS[ci];
      for (let dir = -1; dir <= 1; dir += 2) {
        const way = [from];
        for (let k = 1; k < 24; k++) {
          const q = circ[(i + dir * k + 48) % 24];
          way.push(q);
          if (q === from) continue;
          if (board[q]) { if (q === to) out.push({ circuit: ci, dir, way: way.slice() }); break; }
        }
      }
    }
    return out;
  }
  const sqName = (s) => 'abcdef'[s % 6] + (Math.floor(s / 6) + 1);
  const moveStr = (m) => sqName(m & 63) + (m & 4096 ? 'x' : '-') + sqName((m >> 6) & 63);

  setPosition(startArray(), BLACK, 0);
  return {
    BLACK, WHITE, WIN, WIN_BOUND, QUIET_LIMIT, CIRCUITS, startArray, setPosition,
    setStart() { setPosition(startArray(), BLACK, 0); },
    legalMoves, play: make, undo: unmake, result, status, think, evaluate, perft, paths, sqName, moveStr, ttClear,
    get stm() { return stm; }, get board() { return board; }, get quiet() { return quiet; }, get plies() { return plies; }, get hash() { return [h1, h2]; },
    pieceCount: (side) => count[side],
  };
}
if (typeof module !== 'undefined') module.exports = { SurakartaEngine };

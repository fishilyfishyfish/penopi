// Konane engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules: legal moves, result) and by node (tools/test-konane.mjs).
//
// Rules (the traditional Hawaiian game, 8×8): the board starts full, black and white alternating like a chess board
// (a1 corner black). Black takes one of its own pieces off first, from a corner or from the middle four; White then
// takes off a white piece next to that empty square. After that a move is a jump: over an adjacent enemy piece
// onto the empty square right behind it, and it may go on jumping in the same direction (never turning). Every jumped
// piece is removed. A side that cannot jump loses; there is no draw.
//
// Board: Int8Array(64), sq = row*8 + col, row 0 = rank 1, col 0 = file a. 1 black ((row+col) even), 2 white.
// Move: from | to << 6. The two opening removals have from === to (the piece taken off).
//
// Search: negamax alpha-beta (PVS) with iterative deepening, transposition table (two 32-bit Zobrist keys),
// killer and history ordering. Evaluation: how many jumps each side has (mobility), the thing that decides this game.
'use strict';

function KonaneEngine(opts) {
  opts = opts || {};
  const BLACK = 1, WHITE = 2;
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const MAXPLY = 96;
  const DIRS = [8, -8, 1, -1]; // squares: up a row, down a row, right, left (the edge is checked below)

  const board = new Int8Array(64);
  let stm = BLACK, plies = 0;
  let seed = 0x2545f491 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(3 * 64), Z2 = new Int32Array(3 * 64);
  for (let i = 0; i < 3 * 64; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;

  const rowOf = (s) => s >> 3, colOf = (s) => s & 7;
  const OPEN_BLACK = [0, 63, 27, 36]; // a1, h8, d4, e5
  function startArray() {
    const b = new Int8Array(64);
    for (let s = 0; s < 64; s++) b[s] = ((s >> 3) + (s & 7)) % 2 === 0 ? BLACK : WHITE;
    return b;
  }
  function setPosition(arr, side, played) {
    board.set(arr); stm = side; plies = played || 0; h1 = 0; h2 = 0;
    for (let s = 0; s < 64; s++) if (board[s]) { h1 ^= Z1[board[s] * 64 + s]; h2 ^= Z2[board[s] * 64 + s]; }
    if (stm === WHITE) { h1 ^= ZS1; h2 ^= ZS2; }
  }

  // ---------- moves ----------
  // can a piece on s step in direction i (0 up, 1 down, 2 right, 3 left) over a neighbour and land? (stays on the board)
  function room(s, i, k) { // k = jumped squares so far + 1: the landing square is k*2 steps away
    const r = rowOf(s), c = colOf(s), n = 2 * k;
    return i === 0 ? r + n <= 7 : i === 1 ? r - n >= 0 : i === 2 ? c + n <= 7 : c - n >= 0;
  }
  // all moves of `side` into list from index 0; returns how many (the opening removals while plies < 2)
  function genMoves(side, list) {
    let n = 0;
    if (plies === 0) { for (const s of OPEN_BLACK) list[n++] = s | (s << 6); return n; }
    if (plies === 1) {
      const hole = lastRemoved;
      for (let i = 0; i < 4; i++) {
        if (!stepOk(hole, i)) continue;
        const s = hole + DIRS[i];
        if (board[s] === WHITE) list[n++] = s | (s << 6);
      }
      return n;
    }
    const opp = 3 - side;
    for (let s = 0; s < 64; s++) {
      if (board[s] !== side) continue;
      for (let i = 0; i < 4; i++) {
        const d = DIRS[i];
        for (let k = 1; room(s, i, k); k++) {
          if (board[s + d * (2 * k - 1)] !== opp || board[s + d * 2 * k]) break;
          list[n++] = s | ((s + d * 2 * k) << 6);
        }
      }
    }
    return n;
  }
  function stepOk(s, i) { // one step from s in direction i stays on the board
    const r = rowOf(s), c = colOf(s);
    return i === 0 ? r < 7 : i === 1 ? r > 0 : i === 2 ? c < 7 : c > 0;
  }
  let lastRemoved = -1;
  const lastStack = [];
  // direction (index into DIRS) and number of jumps of a move
  function dirOf(from, to) {
    const dr = rowOf(to) - rowOf(from), dc = colOf(to) - colOf(from);
    return dr > 0 ? 0 : dr < 0 ? 1 : dc > 0 ? 2 : 3;
  }
  function make(m) {
    const from = m & 63, to = (m >> 6) & 63, side = stm;
    if (from === to) { // an opening removal
      board[from] = 0; h1 ^= Z1[side * 64 + from]; h2 ^= Z2[side * 64 + from];
      lastStack.push(lastRemoved); lastRemoved = from;
    } else {
      const d = DIRS[dirOf(from, to)], opp = 3 - side;
      board[from] = 0; h1 ^= Z1[side * 64 + from]; h2 ^= Z2[side * 64 + from];
      for (let q = from + d; q !== to + d; q += 2 * d) { board[q] = 0; h1 ^= Z1[opp * 64 + q]; h2 ^= Z2[opp * 64 + q]; }
      board[to] = side; h1 ^= Z1[side * 64 + to]; h2 ^= Z2[side * 64 + to];
    }
    stm = 3 - side; plies++; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmake(m) {
    const from = m & 63, to = (m >> 6) & 63;
    stm = 3 - stm; plies--; h1 ^= ZS1; h2 ^= ZS2;
    const side = stm;
    if (from === to) {
      board[from] = side; h1 ^= Z1[side * 64 + from]; h2 ^= Z2[side * 64 + from];
      lastRemoved = lastStack.pop();
    } else {
      const d = DIRS[dirOf(from, to)], opp = 3 - side;
      board[to] = 0; h1 ^= Z1[side * 64 + to]; h2 ^= Z2[side * 64 + to];
      board[from] = side; h1 ^= Z1[side * 64 + from]; h2 ^= Z2[side * 64 + from];
      for (let q = from + d; q !== to + d; q += 2 * d) { board[q] = opp; h1 ^= Z1[opp * 64 + q]; h2 ^= Z2[opp * 64 + q]; }
    }
  }
  const SCRATCH = new Int32Array(128);
  const hasMove = (side) => { const n = genMoves(side, SCRATCH); return n > 0; };
  // 'over' once the side to move has nothing to play (after the opening)
  function status() { return plies >= 2 && !hasMove(stm) ? 'over' : 'play'; }
  const loser = () => (status() === 'over' ? stm : 0);

  // ---------- evaluation ----------
  // second count: jumps of both sides (the side to move has the move); in this game the one who runs out first loses
  function evaluate() {
    if (plies < 2) return 0;
    const me = stm;
    return 12 * (countJumps(me) - countJumps(3 - me)) + 3;
  }
  function countJumps(side) { // the other side's jumps, as if it were its move (not valid during the opening plies)
    let n = 0;
    const opp = 3 - side;
    for (let s = 0; s < 64; s++) {
      if (board[s] !== side) continue;
      for (let i = 0; i < 4; i++) {
        const d = DIRS[i];
        for (let k = 1; room(s, i, k); k++) {
          if (board[s + d * (2 * k - 1)] !== opp || board[s + d * 2 * k]) break;
          n++;
        }
      }
    }
    return n;
  }

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE); // flag 1 exact, 2 lower bound, 3 upper bound
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  let ply = 0;
  const toTT = (s) => (s >= WIN_BOUND ? s + ply : s <= -WIN_BOUND ? s - ply : s);
  const fromTT = (s) => (s >= WIN_BOUND ? s - ply : s <= -WIN_BOUND ? s + ply : s);

  // ---------- search ----------
  const MV = [];
  for (let i = 0; i < MAXPLY + 4; i++) MV.push(new Int32Array(128));
  const KIL = new Int32Array((MAXPLY + 4) * 2), HIST = new Int32Array(4096);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function search(depth, alpha, beta, p, root) {
    nodes++;
    if (timeUp()) return 0;
    const list = MV[p], n = genMoves(stm, list);
    if (n === 0) return plies >= 2 ? -(WIN - ply) : 0;
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
    // order: table move, killers, history
    let scores = SCORE[p];
    for (let i = 0; i < n; i++) {
      const m = list[i];
      scores[i] = m === ttMove ? 1 << 30 : m === KIL[p * 2] ? 1 << 20 : m === KIL[p * 2 + 1] ? (1 << 20) - 1 : HIST[(m & 63) * 64 + ((m >> 6) & 63)];
    }
    let best = -INF, bestMove = list[0];
    for (let i = 0; i < n; i++) {
      let b = i;
      for (let j = i + 1; j < n; j++) if (scores[j] > scores[b]) b = j;
      if (b !== i) { let t = list[i]; list[i] = list[b]; list[b] = t; t = scores[i]; scores[i] = scores[b]; scores[b] = t; }
      const m = list[i];
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
        HIST[(m & 63) * 64 + ((m >> 6) & 63)] += depth * depth;
        break;
      }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  const SCORE = [];
  for (let i = 0; i < MAXPLY + 4; i++) SCORE.push(new Int32Array(128));

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
    const root = new Int32Array(128), n = genMoves(stm, root);
    if (!n) { info.score = -WIN; info.ms = Date.now() - t0; return info; }
    let best = root[0];
    info.move = best;
    if (n === 1 && cfg.time) deadline = t0 + Math.min(cfg.time, 250); // only one move: just enough search for a score
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
    const list = new Int32Array(128), n = genMoves(stm, list);
    return Array.from(list.subarray(0, n));
  }
  function perft(d) {
    if (d === 0) return 1;
    const list = new Int32Array(128), n = genMoves(stm, list);
    if (d === 1) return n;
    let total = 0;
    for (let i = 0; i < n; i++) { make(list[i]); total += perft(d - 1); unmake(list[i]); }
    return total;
  }
  const sqName = (s) => 'abcdefgh'[colOf(s)] + (rowOf(s) + 1);
  const moveStr = (m) => ((m & 63) === ((m >> 6) & 63) ? 'x' + sqName(m & 63) : sqName(m & 63) + 'x' + sqName((m >> 6) & 63));
  // jumped squares of a move, in order
  function jumped(m) {
    const from = m & 63, to = (m >> 6) & 63, out = [];
    if (from === to) return out;
    const d = DIRS[dirOf(from, to)];
    for (let q = from + d; q !== to + d; q += 2 * d) out.push(q);
    return out;
  }

  setPosition(startArray(), BLACK, 0);
  return {
    BLACK, WHITE, WIN, WIN_BOUND, startArray, setPosition,
    setStart() { setPosition(startArray(), BLACK, 0); lastRemoved = -1; lastStack.length = 0; },
    legalMoves, play: make, undo: unmake, status, loser, think, evaluate, perft, sqName, moveStr, jumped, ttClear,
    get stm() { return stm; }, get board() { return board; }, get plies() { return plies; }, get hash() { return [h1, h2]; },
  };
}
if (typeof module !== 'undefined') module.exports = { KonaneEngine };

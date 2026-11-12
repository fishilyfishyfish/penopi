// Breakthrough engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules: legal moves, results) and by node (tools/test-breakthrough.mjs).
//
// Rules: 8×8, each side 16 pieces on its two home rows, White moves first. A piece steps one square
// straight forward onto an empty square, or diagonally forward onto an empty square or an enemy piece
// (capturing it). Reaching the far row wins; so does capturing every enemy piece. A side with no legal
// move loses (very rare).
//
// Board: Int8Array(64), sq = row*8 + col, row 0 = rank 1 (White's home row), col 0 = file a.
// 0 empty, 1 white (moves up, +8), 2 black (moves down, −8).
// Move: from | to << 6 | (capture ? 4096 : 0).
//
// Search: negamax alpha-beta (PVS) with iterative deepening, transposition table (two 32-bit Zobrist keys),
// killer moves and history ordering, capture-only quiescence, and the game's two forcing facts at every node:
// a side to move with a piece one step from the far row wins at once (such a piece always has a move there),
// and a side facing such an enemy piece must capture it now or lose.
'use strict';

function BreakthroughEngine(opts) {
  opts = opts || {};
  const WHITE = 1, BLACK = 2;
  const WIN = 100000, MATE_BOUND = WIN - 1000, INF = WIN + 1;
  const MAXPLY = 96;

  // ---------- board state ----------
  const board = new Int8Array(64);
  const count = [0, 0, 0];
  let stm = WHITE, ply = 0;
  // Zobrist keys (fixed seed, so every instance hashes alike)
  let seed = 0x9e3779b9 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(3 * 64), Z2 = new Int32Array(3 * 64);
  for (let i = 0; i < 3 * 64; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;

  const rowOf = (s) => s >> 3, colOf = (s) => s & 7;
  const fwd = (side) => (side === WHITE ? 8 : -8);
  const goalRow = (side) => (side === WHITE ? 7 : 0);
  const preGoal = (side) => (side === WHITE ? 6 : 1);
  const advance = (side, s) => (side === WHITE ? rowOf(s) : 7 - rowOf(s)); // 0 at home row .. 7 at goal

  function startArray() {
    const b = new Int8Array(64);
    for (let s = 0; s < 16; s++) b[s] = WHITE;
    for (let s = 48; s < 64; s++) b[s] = BLACK;
    return b;
  }
  function setPosition(arr, side) {
    board.set(arr); stm = side; ply = 0;
    count[1] = count[2] = 0; h1 = 0; h2 = 0;
    for (let s = 0; s < 64; s++) if (board[s]) { count[board[s]]++; h1 ^= Z1[board[s] * 64 + s]; h2 ^= Z2[board[s] * 64 + s]; }
    if (stm === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
  }

  // ---------- moves ----------
  // all moves of `side` into list (Int32Array) from index 0; returns how many
  function genMoves(side, list) {
    let n = 0;
    const f = fwd(side), opp = 3 - side;
    for (let s = 0; s < 64; s++) {
      if (board[s] !== side) continue;
      const t = s + f;
      if (t < 0 || t > 63) continue; // (can't happen: the game ends on the far row)
      const c = colOf(s);
      if (!board[t]) list[n++] = s | (t << 6);
      if (c > 0) { const d = board[t - 1]; if (!d) list[n++] = s | ((t - 1) << 6); else if (d === opp) list[n++] = s | ((t - 1) << 6) | 4096; }
      if (c < 7) { const d = board[t + 1]; if (!d) list[n++] = s | ((t + 1) << 6); else if (d === opp) list[n++] = s | ((t + 1) << 6) | 4096; }
    }
    return n;
  }
  function genCaptures(side, list) {
    let n = 0;
    const f = fwd(side), opp = 3 - side;
    for (let s = 0; s < 64; s++) {
      if (board[s] !== side) continue;
      const t = s + f, c = colOf(s);
      if (c > 0 && board[t - 1] === opp) list[n++] = s | ((t - 1) << 6) | 4096;
      if (c < 7 && board[t + 1] === opp) list[n++] = s | ((t + 1) << 6) | 4096;
    }
    return n;
  }
  function make(m) {
    const from = m & 63, to = (m >> 6) & 63, side = board[from];
    if (m & 4096) { const o = board[to]; count[o]--; h1 ^= Z1[o * 64 + to]; h2 ^= Z2[o * 64 + to]; }
    board[to] = side; board[from] = 0;
    h1 ^= Z1[side * 64 + from] ^ Z1[side * 64 + to]; h2 ^= Z2[side * 64 + from] ^ Z2[side * 64 + to];
    stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2; ply++;
  }
  function unmake(m) {
    const from = m & 63, to = (m >> 6) & 63, side = board[to];
    stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2; ply--;
    board[from] = side;
    h1 ^= Z1[side * 64 + from] ^ Z1[side * 64 + to]; h2 ^= Z2[side * 64 + from] ^ Z2[side * 64 + to];
    if (m & 4096) { const o = 3 - side; board[to] = o; count[o]++; h1 ^= Z1[o * 64 + to]; h2 ^= Z2[o * 64 + to]; }
    else board[to] = 0;
  }
  // after `mover` played m: 1 mover won, 0 game goes on
  function resultAfter(mover, m) {
    const to = (m >> 6) & 63;
    if (rowOf(to) === goalRow(mover)) return 1;
    if (count[3 - mover] === 0) return 1;
    if (genMoves(3 - mover, SCRATCH) === 0) return 1;
    return 0;
  }
  const SCRATCH = new Int32Array(64);
  // pieces of `side` one step from the far row (each of them wins next move)
  function runners(side, out) {
    let n = 0;
    const r = preGoal(side);
    for (let c = 0; c < 8; c++) if (board[r * 8 + c] === side) { if (out) out[n] = r * 8 + c; n++; }
    return n;
  }

  // ---------- evaluation (side to move's point of view) ----------
  // weights: piece, advancement by rows from home, back-row guard, defended/attacked pieces
  const W = Object.assign({
    piece: 100,
    adv: [0, 2, 5, 10, 18, 32, 55, 0],
    guard: 12,         // a piece still on its home row, files b, c, f, g (the usual defenders)
    guardEdge: 4,      // ... other home-row files
    defended: 0,       // per piece behind it diagonally, scaled by its advancement (4 lost every game to 0: off)
    hanging: 22,       // attacked and not defended, scaled by advancement (only the side not to move)
    column: 3,         // a file without any own piece
    tempo: 8,
  }, opts.weights || {});
  function sideScore(side, toMove) {
    const opp = 3 - side, back = -fwd(side), f = fwd(side);
    let sc = 0;
    const files = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 64; s++) {
      if (board[s] !== side) continue;
      const a = advance(side, s), c = colOf(s);
      files[c] = 1;
      sc += W.piece + W.adv[a];
      if (a === 0) sc += c === 1 || c === 2 || c === 5 || c === 6 ? W.guard : W.guardEdge;
      // defenders: own pieces diagonally behind; attackers: enemy pieces diagonally ahead
      let def = 0, att = 0;
      const bs = s + back, fs = s + f;
      if (bs >= 0 && bs < 64) { if (c > 0 && board[bs - 1] === side) def++; if (c < 7 && board[bs + 1] === side) def++; }
      if (fs >= 0 && fs < 64) { if (c > 0 && board[fs - 1] === opp) att++; if (c < 7 && board[fs + 1] === opp) att++; }
      sc += def * W.defended * (1 + (a >> 1));
      if (att && !toMove) sc -= att > def ? W.hanging * (1 + a) : (W.hanging >> 2) * (1 + a);
    }
    for (let c = 0; c < 8; c++) if (!files[c]) sc -= W.column;
    return sc;
  }
  function evaluate() {
    return sideScore(stm, true) - sideScore(3 - stm, false) + W.tempo;
  }

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE); // flag: 0 empty, 1 exact, 2 lower, 3 upper
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  const toTT = (sc) => (sc >= MATE_BOUND ? sc + ply : sc <= -MATE_BOUND ? sc - ply : sc);
  const fromTT = (sc) => (sc >= MATE_BOUND ? sc - ply : sc <= -MATE_BOUND ? sc + ply : sc);

  // ---------- search ----------
  const MV = [], SC = [];
  for (let i = 0; i < MAXPLY + 2; i++) { MV.push(new Int32Array(64)); SC.push(new Int32Array(64)); }
  const KIL = new Int32Array((MAXPLY + 2) * 2), HIST = new Int32Array(2 * 64 * 64);
  const RUN = new Int32Array(8);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0;

  function order(n, p, ttMove) {
    const ms = MV[p], sc = SC[p];
    for (let i = 0; i < n; i++) {
      const m = ms[i], to = (m >> 6) & 63;
      let v;
      if (m === ttMove) v = 1 << 30;
      else if (m & 4096) v = (1 << 28) + advance(stm, to) * 16;   // captures, the deeper the better
      else if (m === KIL[p * 2]) v = 1 << 27;
      else if (m === KIL[p * 2 + 1]) v = (1 << 27) - 1;
      else v = HIST[(stm - 1) * 4096 + (m & 4095)];
      sc[i] = v;
    }
  }
  function pickNext(n, p, i) { // selection sort step: best remaining to position i
    const ms = MV[p], sc = SC[p];
    let b = i;
    for (let j = i + 1; j < n; j++) if (sc[j] > sc[b]) b = j;
    if (b !== i) { let t = ms[i]; ms[i] = ms[b]; ms[b] = t; t = sc[i]; sc[i] = sc[b]; sc[b] = t; }
    return ms[i];
  }
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  // The forcing facts. Returns a score if the node is decided, null otherwise; when the side to move
  // must capture an enemy runner, *only* those captures are left in MV[p] (count returned via forced.n).
  const forced = { n: 0 };
  function forcing(p) {
    if (runners(stm, null)) return WIN - p - 1; // a piece one step from the far row: wins next move
    const k = runners(3 - stm, RUN);
    if (!k) return null;
    // the enemy wins next move unless every runner of theirs is captured now; one capture removes one runner
    if (k > 1) return -(WIN - p - 2);
    const n = genCaptures(stm, MV[p]);
    let j = 0;
    for (let i = 0; i < n; i++) if (((MV[p][i] >> 6) & 63) === RUN[0]) MV[p][j++] = MV[p][i];
    if (!j) return -(WIN - p - 2);
    forced.n = j;
    return undefined;
  }

  function qsearch(alpha, beta, p) {
    nodes++;
    if (timeUp()) return 0;
    const f = forcing(p);
    if (f !== null && f !== undefined) return f;
    let n;
    if (f === undefined) n = forced.n; // must capture the runner: no stand-pat
    else {
      const stand = evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (p >= MAXPLY) return stand;
      n = genCaptures(stm, MV[p]);
    }
    order(n, p, 0);
    let best = f === undefined ? -INF : alpha;
    for (let i = 0; i < n; i++) {
      const m = pickNext(n, p, i);
      make(m);
      const sc = count[stm] === 0 ? WIN - p - 1 : -qsearch(-beta, -alpha, p + 1);
      unmake(m);
      if (stopped) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  }

  function search(depth, alpha, beta, p, pvNode) {
    if (depth <= 0) return qsearch(alpha, beta, p);
    nodes++;
    if (timeUp()) return 0;
    const f = forcing(p);
    if (f !== null && f !== undefined) return f;
    // transposition table
    const idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pvNode && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    let n = f === undefined ? forced.n : genMoves(stm, MV[p]);
    if (n === 0) return -(WIN - p); // no legal move: lost
    order(n, p, ttMove);
    const a0 = alpha;
    let best = -INF, bestMove = 0;
    for (let i = 0; i < n; i++) {
      const m = pickNext(n, p, i);
      make(m);
      let sc;
      if (count[stm] === 0 || rowOf((m >> 6) & 63) === goalRow(3 - stm)) sc = WIN - p - 1;
      else {
        // late move reduction for quiet moves late in the list
        let d = depth - 1;
        if (i === 0) sc = -search(d, -beta, -alpha, p + 1, pvNode);
        else {
          let r = 0;
          if (depth >= 3 && i >= 4 && !(m & 4096) && f !== undefined) r = i >= 10 ? 2 : 1;
          if (f === undefined) r = 0;
          sc = -search(d - r, -alpha - 1, -alpha, p + 1, false);
          if (sc > alpha && r) sc = -search(d, -alpha - 1, -alpha, p + 1, false);
          if (sc > alpha && sc < beta) sc = -search(d, -beta, -alpha, p + 1, true);
        }
      }
      unmake(m);
      if (stopped) return 0;
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!(m & 4096)) {
          if (KIL[p * 2] !== m) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = m; }
          HIST[(stm - 1) * 4096 + (m & 4095)] += depth * depth;
        }
        break;
      }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }

  // Iterative deepening from the current position.
  // cfg: {time: ms, depth, nodes, soft: fraction of time after which no new iteration starts (0.5)}
  // returns {move, score, depth, nodes, ms, pv}; score is from the side to move, WIN − n = wins in n plies
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
    const root = new Int32Array(64);
    const n = genMoves(stm, root);
    if (!n) { info.score = -WIN; info.ms = Date.now() - t0; return info; }
    // a move that wins on the spot
    const side = stm;
    for (let i = 0; i < n; i++) {
      make(root[i]); const r = resultAfter(side, root[i]); unmake(root[i]);
      if (r) { Object.assign(info, { move: root[i], score: WIN - 1, depth: 1, pv: [root[i]], ms: Date.now() - t0 }); return info; }
    }
    let best = root[0];
    for (let d = 1; d <= maxDepth; d++) {
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) break;
      const idx = h1 & TT_MASK;
      if (tKey[idx] === h2 && tMove[idx]) best = tMove[idx];
      info.depth = d; info.score = sc; info.move = best;
      if (Math.abs(sc) >= MATE_BOUND) break;           // decided
      if (soft && Date.now() - t0 >= soft) break;
      if (maxNodes && nodes >= maxNodes * 0.5) break;
    }
    if (!info.move) info.move = best;
    info.nodes = nodes; info.ms = Date.now() - t0;
    info.pv = pv(8);
    return info;
  }
  // principal variation from the table
  function pv(k) {
    const line = [], done = [];
    for (let i = 0; i < k; i++) {
      const idx = h1 & TT_MASK;
      if (!(tFlag[idx] && tKey[idx] === h2)) break;
      const m = tMove[idx];
      const n = genMoves(stm, SCRATCH);
      let ok = false;
      for (let j = 0; j < n; j++) if (SCRATCH[j] === m) ok = true;
      if (!ok) break;
      line.push(m); make(m); done.push(m);
    }
    while (done.length) unmake(done.pop());
    return line;
  }

  // ---------- helpers for the page ----------
  function legalMoves() {
    const list = new Int32Array(64), n = genMoves(stm, list);
    return Array.from(list.subarray(0, n));
  }
  function play(m) { make(m); }
  const sqName = (s) => 'abcdefgh'[colOf(s)] + (rowOf(s) + 1);
  const moveStr = (m) => sqName(m & 63) + (m & 4096 ? 'x' : '-') + sqName((m >> 6) & 63);
  function perft(d) {
    if (d === 0) return 1;
    const list = new Int32Array(64), n = genMoves(stm, list);
    if (d === 1) return n;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const m = list[i], mover = stm;
      make(m);
      if (!(rowOf((m >> 6) & 63) === goalRow(mover) || count[stm] === 0)) total += perft(d - 1);
      unmake(m);
    }
    return total;
  }

  setPosition(startArray(), WHITE);
  return {
    WHITE, BLACK, WIN, MATE_BOUND,
    startArray, setPosition,
    setStart() { setPosition(startArray(), WHITE); },
    legalMoves, play, resultAfter, think, evaluate, perft, moveStr, sqName, ttClear, runners: (side) => runners(side, null),
    get stm() { return stm; }, get board() { return board; }, get hash() { return [h1, h2]; },
    pieceCount: (side) => count[side],
  };
}
if (typeof module !== 'undefined') module.exports = { BreakthroughEngine };

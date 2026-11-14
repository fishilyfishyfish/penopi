// Reversi engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts), by the page
// (rules) and by node (tools/test-reversi.mjs).
//
// Rules: 8×8, black moves first from the four centre discs (d5 e4 black, d4 e5 white). A move puts a disc on an
// empty square so that it closes one or more straight lines of the opponent's discs, which all turn over. A side
// with no such move passes; when neither side can move the game ends and more discs wins (equal is a draw).
//
// Squares: 0..63 = row*8 + col, row 0 = rank 8 (the top as drawn), col 0 = file a. Inside, a 10×10 board with a
// border: p = (row+1)*10 + col+1. Move: the square 0..63, or PASS (−1) when the side to move has no move but
// the game goes on.
//
// Search: negamax alpha-beta (PVS), iterative deepening, transposition table, history ordering (corners first,
// then by what the move leaves the opponent). A pass costs no depth, so once the depth reaches the number of
// empty squares the search sees every game to its end: the result is exact (`exact` in think()'s answer).
// Evaluation (side to move): mobility, potential mobility (frontier), corners and the squares next to empty
// corners, a square table, and the disc count late in the game.
'use strict';

function ReversiEngine(opts) {
  opts = opts || {};
  const BLACK = 1, WHITE = 2, PASS = -1;
  const WIN = 100000, WIN_BOUND = WIN - 200, INF = WIN + 1000;
  const DIRS = [-11, -10, -9, -1, 1, 9, 10, 11];
  const TO10 = new Int8Array(64), TO64 = new Int8Array(100).fill(-1);
  for (let s = 0; s < 64; s++) { const p = ((s >> 3) + 1) * 10 + (s & 7) + 1; TO10[s] = p; TO64[p] = s; }
  const board = new Int8Array(100).fill(3); // 3 = border
  let stm = BLACK, empties = 60, discs = [0, 0, 0];
  let seed = 0x2545f491 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(300), Z2 = new Int32Array(300);
  for (let i = 0; i < 300; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  // undo: a stack of flipped squares per move
  const flipStack = new Int8Array(4096), moveStack = new Int16Array(256), flipCount = new Int16Array(256);
  let fsp = 0, msp = 0;

  function setStart() {
    board.fill(3);
    for (let s = 0; s < 64; s++) board[TO10[s]] = 0;
    // rows from the top: row 3 = rank 5, row 4 = rank 4. d5 = (3,3) black, e5 = (3,4) white, d4 = (4,3) white, e4 = (4,4) black
    board[TO10[27]] = BLACK; board[TO10[28]] = WHITE; board[TO10[35]] = WHITE; board[TO10[36]] = BLACK;
    stm = BLACK; fsp = 0; msp = 0;
    recount();
  }
  function recount() {
    discs = [0, 0, 0]; empties = 0; h1 = 0; h2 = 0;
    for (let s = 0; s < 64; s++) {
      const c = board[TO10[s]];
      if (c) { discs[c]++; h1 ^= Z1[c * 100 + s]; h2 ^= Z2[c * 100 + s]; } else empties++;
    }
    if (stm === WHITE) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  // flips of a move at p (10×10) for colour c, without playing it; 0 if not legal
  function flipsAt(p, c) {
    if (board[p]) return 0;
    const o = 3 - c;
    let n = 0;
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d];
      let q = p + dir, k = 0;
      while (board[q] === o) { q += dir; k++; }
      if (k && board[q] === c) n += k;
    }
    return n;
  }
  function gen(c, out) { // squares 10×10
    out.length = 0;
    for (let s = 0; s < 64; s++) { const p = TO10[s]; if (!board[p] && flipsAt(p, c)) out.push(p); }
    return out;
  }
  function mobility(c) {
    let n = 0;
    for (let s = 0; s < 64; s++) { const p = TO10[s]; if (!board[p] && flipsAt(p, c)) n++; }
    return n;
  }
  function make(p) { // p 10×10, or PASS
    moveStack[msp] = p;
    if (p === PASS) { flipCount[msp++] = 0; stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2; return; }
    const c = stm, o = 3 - c, s0 = TO64[p];
    let n = 0;
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d];
      let q = p + dir, k = 0;
      while (board[q] === o) { q += dir; k++; }
      if (k && board[q] === c) {
        for (let r = p + dir; r !== q; r += dir) {
          board[r] = c; flipStack[fsp++] = r; n++;
          const sr = TO64[r];
          h1 ^= Z1[o * 100 + sr] ^ Z1[c * 100 + sr]; h2 ^= Z2[o * 100 + sr] ^ Z2[c * 100 + sr];
        }
      }
    }
    board[p] = c; h1 ^= Z1[c * 100 + s0]; h2 ^= Z2[c * 100 + s0];
    discs[c] += n + 1; discs[o] -= n; empties--;
    flipCount[msp++] = n;
    stm = o; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmake() {
    const p = moveStack[--msp], n = flipCount[msp];
    stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2;
    if (p === PASS) return;
    const c = stm, o = 3 - c, s0 = TO64[p];
    for (let i = 0; i < n; i++) {
      const r = flipStack[--fsp], sr = TO64[r];
      board[r] = o;
      h1 ^= Z1[o * 100 + sr] ^ Z1[c * 100 + sr]; h2 ^= Z2[o * 100 + sr] ^ Z2[c * 100 + sr];
    }
    board[p] = 0; h1 ^= Z1[c * 100 + s0]; h2 ^= Z2[c * 100 + s0];
    discs[c] -= n + 1; discs[o] += n; empties++;
  }

  // ---------- evaluation (side to move) ----------
  const W = Object.assign({ mob: 15, frontier: 8, corner: 90, xsq: 20, csq: 18, table: 1, disc: 3, parity: 12 }, opts.weights || {});
  const TABLE = [
    0, 0, 6, 3, 3, 6, 0, 0,
    0, 0, -1, -1, -1, -1, 0, 0,
    6, -1, 1, 0, 0, 1, -1, 6,
    3, -1, 0, 0, 0, 0, -1, 3,
    3, -1, 0, 0, 0, 0, -1, 3,
    6, -1, 1, 0, 0, 1, -1, 6,
    0, 0, -1, -1, -1, -1, 0, 0,
    0, 0, 6, 3, 3, 6, 0, 0,
  ];
  // corners and the squares next to them (X diagonal, C on the edge), as 10×10
  const CORNERS = [[0, 9, 1, 8], [7, 14, 6, 15], [56, 49, 57, 48], [63, 54, 62, 55]].map((a) => a.map((s) => TO10[s]));
  function frontier(c) { // discs of c next to an empty square
    let n = 0;
    for (let s = 0; s < 64; s++) {
      const p = TO10[s];
      if (board[p] !== c) continue;
      for (let d = 0; d < 8; d++) if (board[p + DIRS[d]] === 0) { n++; break; }
    }
    return n;
  }
  function evaluate() {
    const me = stm, op = 3 - stm;
    let sc = 0;
    const mm = mobility(me), om = mobility(op);
    sc += W.mob * 10 * (mm - om) / (mm + om + 2);
    const fm = frontier(me), fo = frontier(op);
    sc -= W.frontier * 10 * (fm - fo) / (fm + fo + 2);
    for (const [cn, x, c1, c2] of CORNERS) {
      const v = board[cn];
      if (v) { sc += v === me ? W.corner : -W.corner; continue; }
      const xv = board[x];
      if (xv) sc += xv === me ? -W.xsq : W.xsq;
      for (const c of [c1, c2]) { const cv = board[c]; if (cv) sc += cv === me ? -W.csq : W.csq; }
    }
    if (W.table) for (let s = 0; s < 64; s++) { const v = board[TO10[s]]; if (v) sc += (v === me ? 1 : -1) * TABLE[s] * W.table; }
    // late: discs start to count; and the last move in an even region
    if (empties < 20) sc += W.disc * (discs[me] - discs[op]) * (20 - empties) / 10;
    if (empties < 18) sc += (empties & 1 ? 1 : -1) * W.parity;
    return Math.round(sc);
  }
  const final = () => discs[stm] - discs[3 - stm];
  const terminal = () => { const d = final(); return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0; }; // exact: WIN ± the disc difference

  // ---------- search ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int8Array(TT_SIZE), tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const MV = [];
  for (let i = 0; i < 80; i++) MV.push([]);
  const HIST = new Int32Array(100);
  const PRIO = new Int32Array(100);
  for (let s = 0; s < 64; s++) PRIO[TO10[s]] = TABLE[s] * 10;
  for (const [cn, x] of CORNERS) { PRIO[cn] = 1000; PRIO[x] = -500; }
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  const SC = [];
  for (let i = 0; i < 80; i++) SC.push(new Int32Array(40));
  function search(depth, alpha, beta, ply, pv, passed) {
    nodes++;
    if (timeUp()) return 0;
    const moves = gen(stm, MV[ply]);
    if (!moves.length) {
      if (passed) return terminal(); // neither side can move
      make(PASS);
      const v = -search(depth, -beta, -alpha, ply + 1, pv, true); // a pass costs no depth
      unmake();
      return v;
    }
    if (depth <= 0) return evaluate();
    const idx = h1 & TT_MASK;
    let ttMove = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pv && tDepth[idx] >= depth) {
        const s = tScore[idx], fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    // ordering: table move, corners, history, then (near the leaves cheaply) the square's value
    const sc = SC[ply];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      sc[i] = m === ttMove ? 1e9 : PRIO[m] * 100 + HIST[m];
    }
    if (depth >= 4) for (let i = 0; i < moves.length; i++) { // fewest replies for the opponent first
      if (moves[i] === ttMove) continue;
      make(moves[i]); sc[i] -= mobility(stm) * 3000; unmake();
    }
    const a0 = alpha;
    let best = -INF, bestMove = 0;
    for (let i = 0; i < moves.length; i++) {
      let b = i;
      for (let j = i + 1; j < moves.length; j++) if (sc[j] > sc[b]) b = j;
      if (b !== i) { let t = moves[i]; moves[i] = moves[b]; moves[b] = t; t = sc[i]; sc[i] = sc[b]; sc[b] = t; }
      const m = moves[i];
      make(m);
      let v;
      if (i === 0) v = -search(depth - 1, -beta, -alpha, ply + 1, pv, false);
      else {
        v = -search(depth - 1, -alpha - 1, -alpha, ply + 1, false, false);
        if (v > alpha && v < beta) v = -search(depth - 1, -beta, -alpha, ply + 1, true, false);
      }
      unmake();
      if (stopped) return 0;
      if (v > best) { best = v; bestMove = m; if (ply === 0) rootBest = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) { HIST[m] += depth * depth; break; }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = best;
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes}. Returns {move (0..63 or PASS), score, depth, nodes, ms, exact, final}: score from the
  // side to move; exact = the search saw every game to its end (then final = the disc difference with best play)
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    nodes = 0; stopped = false;
    for (let i = 0; i < 100; i++) HIST[i] >>= 2;
    const legal = gen(stm, []);
    const info = { move: PASS, score: 0, depth: 0, nodes: 0, ms: 0, exact: false, final: 0 };
    if (!legal.length) return info;
    let best = legal[0];
    const maxD = Math.min(cfg.depth || 64, 64);
    for (let d = 1; d <= maxD; d++) {
      rootBest = 0;
      const sc = search(d, -INF, INF, 0, true, false);
      if (stopped) { if (rootBest && d > 1) best = rootBest; break; }
      if (rootBest) best = rootBest;
      info.depth = d; info.score = sc;
      if (d >= empties) { info.exact = true; info.final = Math.abs(sc) >= WIN_BOUND ? sc - Math.sign(sc) * WIN : 0; break; }
      if (cfg.time && Date.now() - t0 > cfg.time * 0.45) break;
      if (maxNodes && nodes > maxNodes * 0.5) break;
    }
    info.move = TO64[best]; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page and tests ----------
  const legalMoves = () => { const l = gen(stm, []).map((p) => TO64[p]); return l.length || !gen(3 - stm, []).length ? l : [PASS]; };
  function play(s) { make(s === PASS ? PASS : TO10[s]); }
  function undo() { unmake(); }
  // '' while playing, else 'over' (neither side can move)
  const status = () => (gen(stm, []).length || gen(3 - stm, []).length ? '' : 'over');
  const flipsOf = (s) => { // squares a move would turn over (0..63)
    const p = TO10[s], c = stm, o = 3 - c, out = [];
    if (board[p]) return out;
    for (const dir of DIRS) {
      let q = p + dir;
      const line = [];
      while (board[q] === o) { line.push(TO64[q]); q += dir; }
      if (line.length && board[q] === c) out.push(...line);
    }
    return out;
  };
  const cells = () => { const a = new Int8Array(64); for (let s = 0; s < 64; s++) a[s] = board[TO10[s]]; return a; };
  function setPosition(arr, side) { // arr: 64 values 0/1/2
    board.fill(3);
    for (let s = 0; s < 64; s++) board[TO10[s]] = arr[s];
    stm = side || BLACK; fsp = 0; msp = 0;
    recount();
  }
  function perft(d) {
    if (d === 0) return 1;
    const moves = gen(stm, []);
    if (!moves.length) {
      if (!gen(3 - stm, []).length) return 1; // the game is over: a leaf
      make(PASS); const n = perft(d - 1); unmake(); return n;
    }
    let n = 0;
    for (const m of moves) { make(m); n += perft(d - 1); unmake(); }
    return n;
  }
  const NAME = (s) => 'abcdefgh'[s & 7] + (8 - (s >> 3));

  setStart();
  return {
    BLACK, WHITE, PASS, WIN, WIN_BOUND, setStart, setPosition, legalMoves, play, undo, status, think, evaluate, perft, flipsOf, cells, NAME,
    count: (c) => discs[c], get stm() { return stm; }, get empties() { return empties; },
  };
}
if (typeof module !== 'undefined') module.exports = { ReversiEngine };

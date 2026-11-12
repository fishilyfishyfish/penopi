// Nine Men's Morris engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules) and by node (tools/test-morris.mjs).
//
// Rules: 24 points on three nested squares joined at the middles. Each side has nine pieces; White moves first.
// First the pieces are placed one per turn on empty points; then a piece moves along a line to an adjacent
// empty point. A side down to three pieces may fly: move a piece to any empty point. Three of one's own pieces
// on a line (a mill) formed by a move let the mover remove an opposing piece, but not one standing in a mill
// unless all of them do. A side reduced to two pieces, or with no legal move, loses. Draws: the same position
// with the same side to move three times, or fifty moves each without a removal once all pieces are placed.
//
// Points (row by row, a7 to g1):
//   0-----1-----2        a7 d7 g7
//   | 3---4---5 |        b6 d6 f6
//   | | 6-7-8 | |        c5 d5 e5
//   9-10-11 12-13-14     a4 b4 c4  e4 f4 g4
//   | | 15-16-17 |       c3 d3 e3
//   | 18--19--20 |       b2 d2 f2
//   21----22----23       a1 d1 g1
// Move (int): (from + 1) | to << 5 | (removed + 1) << 10; from = −1 for a placement, removed = −1 for none.
'use strict';

function MorrisEngine(opts) {
  opts = opts || {};
  const WHITE = 1, BLACK = 2;
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const ADJ = [[1, 9], [0, 2, 4], [1, 14], [4, 10], [1, 3, 5, 7], [4, 13], [7, 11], [4, 6, 8], [7, 12], [0, 10, 21], [3, 9, 11, 18],
    [6, 10, 15], [8, 13, 17], [5, 12, 14, 20], [2, 13, 23], [11, 16], [15, 17, 19], [12, 16], [10, 19], [16, 18, 20, 22], [13, 19],
    [9, 22], [19, 21, 23], [14, 22]];
  const MILLS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18, 19, 20], [21, 22, 23],
    [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7], [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23]];
  const MILLS_OF = Array.from({ length: 24 }, (_, p) => MILLS.filter((m) => m.includes(p)));
  const NAMES = ['a7', 'd7', 'g7', 'b6', 'd6', 'f6', 'c5', 'd5', 'e5', 'a4', 'b4', 'c4', 'e4', 'f4', 'g4', 'c3', 'd3', 'e3', 'b2', 'd2', 'f2', 'a1', 'd1', 'g1'];
  const flying = opts.flying !== false;
  const mFrom = (m) => (m & 31) - 1, mTo = (m) => (m >> 5) & 31, mRm = (m) => ((m >> 10) & 31) - 1;
  const enc = (from, to, rm) => (from + 1) | (to << 5) | ((rm + 1) << 10);

  // ---------- state ----------
  const board = new Int8Array(24);
  const hand = [0, 9, 9], onBoard = [0, 0, 0];
  let stm = WHITE, quiet = 0; // quiet: plies since the last removal, counted once all pieces are placed
  let seed = 0x7fb5d329 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(3 * 24), Z2 = new Int32Array(3 * 24), ZH1 = new Int32Array(3 * 10), ZH2 = new Int32Array(3 * 10);
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  for (let i = 0; i < ZH1.length; i++) { ZH1[i] = rnd(); ZH2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  const keys1 = [], keys2 = [], undo = [];
  function rehash() {
    h1 = 0; h2 = 0;
    for (let p = 0; p < 24; p++) if (board[p]) { h1 ^= Z1[board[p] * 24 + p]; h2 ^= Z2[board[p] * 24 + p]; }
    for (const c of [WHITE, BLACK]) { h1 ^= ZH1[c * 10 + hand[c]]; h2 ^= ZH2[c * 10 + hand[c]]; }
    if (stm === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  function setStart() {
    board.fill(0); hand[1] = hand[2] = 9; onBoard[1] = onBoard[2] = 0; stm = WHITE; quiet = 0;
    keys1.length = keys2.length = undo.length = 0;
    rehash();
  }
  const inMill = (p) => { const c = board[p]; return c !== 0 && MILLS_OF[p].some((m) => board[m[0]] === c && board[m[1]] === c && board[m[2]] === c); };
  const total = (c) => hand[c] + onBoard[c];
  const canFly = (c) => flying && hand[c] === 0 && onBoard[c] === 3;
  const phaseOf = (c) => (hand[c] > 0 ? 'place' : canFly(c) ? 'fly' : 'move');

  // ---------- moves ----------
  function gen(c, out) {
    out.length = 0;
    const opp = 3 - c;
    const base = [];
    if (hand[c] > 0) { for (let p = 0; p < 24; p++) if (!board[p]) base.push([-1, p]); }
    else if (canFly(c)) { for (let f = 0; f < 24; f++) if (board[f] === c) for (let t = 0; t < 24; t++) if (!board[t]) base.push([f, t]); }
    else for (let f = 0; f < 24; f++) if (board[f] === c) for (const t of ADJ[f]) if (!board[t]) base.push([f, t]);
    // removable opposing pieces: those not in a mill, or any if all are
    let removable = null;
    for (const [f, t] of base) {
      if (f >= 0) board[f] = 0;
      board[t] = c;
      const mill = MILLS_OF[t].some((m) => board[m[0]] === c && board[m[1]] === c && board[m[2]] === c);
      board[t] = 0;
      if (f >= 0) board[f] = c;
      if (!mill) { out.push(enc(f, t, -1)); continue; }
      if (!removable) {
        const free = [], all = [];
        for (let p = 0; p < 24; p++) if (board[p] === opp) { all.push(p); if (!inMill(p)) free.push(p); }
        removable = free.length ? free : all;
      }
      if (!removable.length) out.push(enc(f, t, -1)); // nothing to take (can't happen in practice)
      for (const r of removable) out.push(enc(f, t, r));
    }
    return out;
  }
  function make(m) {
    const f = mFrom(m), t = mTo(m), r = mRm(m), c = stm, opp = 3 - c;
    undo.push(quiet);
    keys1.push(h1); keys2.push(h2);
    if (f < 0) { h1 ^= ZH1[c * 10 + hand[c]]; h2 ^= ZH2[c * 10 + hand[c]]; hand[c]--; onBoard[c]++; h1 ^= ZH1[c * 10 + hand[c]]; h2 ^= ZH2[c * 10 + hand[c]]; }
    else { board[f] = 0; h1 ^= Z1[c * 24 + f]; h2 ^= Z2[c * 24 + f]; }
    board[t] = c; h1 ^= Z1[c * 24 + t]; h2 ^= Z2[c * 24 + t];
    if (r >= 0) { board[r] = 0; onBoard[opp]--; h1 ^= Z1[opp * 24 + r]; h2 ^= Z2[opp * 24 + r]; }
    quiet = r >= 0 || hand[1] + hand[2] > 0 ? 0 : quiet + 1;
    stm = opp; h1 ^= ZS1; h2 ^= ZS2;
  }
  function unmake(m) {
    const f = mFrom(m), t = mTo(m), r = mRm(m);
    stm = 3 - stm;
    const c = stm, opp = 3 - c;
    if (r >= 0) { board[r] = opp; onBoard[opp]++; }
    board[t] = 0;
    if (f < 0) { hand[c]++; onBoard[c]--; } else board[f] = c;
    quiet = undo.pop(); h1 = keys1.pop(); h2 = keys2.pop();
  }
  const SCR = [];
  function legalMoves() { return gen(stm, []).slice(); }
  // the side to move: 'lose' (two pieces left or no move), 'draw:repetition', 'draw:quiet', or ''
  function status() {
    if (total(stm) < 3) return 'lose';
    if (!gen(stm, SCR).length) return 'lose';
    if (quiet >= 100) return 'draw:quiet';
    let n = 0;
    for (let i = keys1.length - 2; i >= 0 && i >= keys1.length - 1 - quiet; i -= 2) if (keys1[i] === h1 && keys2[i] === h2) n++;
    if (n >= 2) return 'draw:repetition';
    return '';
  }

  // ---------- evaluation (side to move) ----------
  const W = Object.assign({ piece: 100, mobility: 4, two: 10, mill: 6, blocked: 8, tempo: 6 }, opts.weights || {});
  function sideScore(c) {
    const opp = 3 - c;
    let sc = total(c) * W.piece;
    if (total(c) < 3) return -WIN;
    if (!canFly(c) && hand[c] === 0) {
      let mob = 0, blocked = 0;
      for (let p = 0; p < 24; p++) if (board[p] === c) {
        let free = 0;
        for (const t of ADJ[p]) if (!board[t]) free++;
        mob += free; if (!free) blocked++;
      }
      sc += W.mobility * mob - W.blocked * blocked;
    }
    // two of mine and an empty third on a mill line (a mill next move); mills standing
    for (const m of MILLS) {
      let mine = 0, empty = 0, theirs = 0;
      for (const p of m) { if (board[p] === c) mine++; else if (!board[p]) empty++; else theirs++; }
      if (mine === 2 && empty === 1) sc += W.two;
      if (mine === 3) sc += W.mill;
      void theirs; void opp;
    }
    return sc;
  }
  const evaluate = () => sideScore(stm) - sideScore(3 - stm) + W.tempo;

  // ---------- search ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int32Array(TT_SIZE), tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const MV = [];
  for (let i = 0; i < 128; i++) MV.push([]);
  const HIST = new Int32Array(32 * 32);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = 0;
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function repeated() {
    for (let i = keys1.length - 2; i >= 0 && i >= keys1.length - 1 - quiet; i -= 2) if (keys1[i] === h1 && keys2[i] === h2) return true;
    return false;
  }
  function search(depth, alpha, beta, p, pv) {
    nodes++;
    if (timeUp()) return 0;
    if (total(stm) < 3) return -(WIN - p);
    if (p > 0 && (quiet >= 100 || repeated())) return 0;
    const moves = gen(stm, MV[p]);
    if (!moves.length) return -(WIN - p);
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
    const sc = moves.map((m) => (m === ttMove ? 1e9 : (mRm(m) >= 0 ? 1e6 : 0) + HIST[(mFrom(m) + 1) * 32 + mTo(m)]));
    const order = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
    const a0 = alpha;
    let best = -INF, bestMove = 0, n = 0;
    for (const i of order) {
      const m = moves[i];
      make(m);
      let v;
      if (n++ === 0) v = -search(depth - 1, -beta, -alpha, p + 1, pv);
      else {
        v = -search(depth - 1, -alpha - 1, -alpha, p + 1, false);
        if (v > alpha && v < beta) v = -search(depth - 1, -beta, -alpha, p + 1, true);
      }
      unmake(m);
      if (stopped) return 0;
      if (v > best) { best = v; bestMove = m; if (p === 0) rootBest = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) { if (mRm(m) < 0) HIST[(mFrom(m) + 1) * 32 + mTo(m)] += depth * depth; break; }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = depth; tScore[idx] = best;
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes}. Returns {move, score, depth, nodes, ms}; score from the side to move.
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    nodes = 0; stopped = false;
    for (let i = 0; i < HIST.length; i++) HIST[i] >>= 2;
    const legal = legalMoves();
    const info = { move: 0, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!legal.length) { info.score = -WIN; return info; }
    if (legal.length === 1) { info.move = legal[0]; info.ms = Date.now() - t0; return info; }
    let best = legal[0];
    for (let d = 1; d <= (cfg.depth || 60); d++) {
      rootBest = 0;
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) { if (rootBest && d > 1) best = rootBest; break; }
      if (rootBest) best = rootBest;
      info.depth = d; info.score = sc;
      if (Math.abs(sc) >= WIN_BOUND) break;
      if (cfg.time && Date.now() - t0 > cfg.time * 0.5) break;
      if (maxNodes && nodes > maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }
  const notation = (m) => (mFrom(m) < 0 ? NAMES[mTo(m)] : `${NAMES[mFrom(m)]}-${NAMES[mTo(m)]}`) + (mRm(m) >= 0 ? `x${NAMES[mRm(m)]}` : '');
  function perft(d) {
    if (total(stm) < 3) return 0;
    const moves = gen(stm, []);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) { make(m); n += perft(d - 1); unmake(m); }
    return n;
  }
  function setPosition(white, black, hw, hb, side) { // for tests: points of each colour, pieces in hand, who moves
    setStart();
    for (const p of white) board[p] = WHITE;
    for (const p of black) board[p] = BLACK;
    hand[1] = hw; hand[2] = hb; onBoard[1] = white.length; onBoard[2] = black.length;
    stm = side || WHITE;
    rehash();
  }

  setStart();
  return {
    WHITE, BLACK, WIN, WIN_BOUND, ADJ, MILLS, NAMES, mFrom, mTo, mRm,
    setStart, setPosition, legalMoves, play: make, undo: unmake, status, think, evaluate, perft, notation, inMill, phaseOf,
    hand: (c) => hand[c], onBoard: (c) => onBoard[c],
    get stm() { return stm; }, get board() { return board; },
  };
}
if (typeof module !== 'undefined') module.exports = { MorrisEngine };

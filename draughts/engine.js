// International draughts engine (written for Penopi). Plain script, no build: loaded by worker.js
// (importScripts), by the page (rules) and by node (tools/test-draughts.mjs).
//
// Rules (FMJD): 10×10, the 50 dark squares, 20 men each, White moves first. Men step diagonally forward,
// capture diagonally forward and backward. Kings fly: any distance diagonally, and capture a piece at any
// distance, landing on any empty square beyond it. Capturing is compulsory and you must take the sequence
// that captures the most pieces (men and kings count the same). Captured pieces come off only after the
// whole sequence and may not be jumped twice (they block the way meanwhile). A man becomes a king only if
// its move ends on the far row. Side to move with no legal move loses. Draws: the same position with the
// same side to move three times; 25 moves each of only king moves without capture; and the endgame counts
// (16 moves each for three pieces with a king against a lone king, 5 moves each for two or fewer).
//
// Squares: index r*10+c on the full 10×10 (row 0 at the top, Black's side; dark squares have (r+c) odd),
// shown in standard numbering 1–50 (square 1 at the top left dark square, row by row).
// Pieces: 0 empty, 1 white man, 2 white king, 3 black man, 4 black king. White moves up (row decreasing).
// A move: {from, to, path: [landing squares...], caps: [captured squares...], promote}.
'use strict';

function DraughtsEngine(opts) {
  opts = opts || {};
  const WHITE = 1, BLACK = 2;
  const WM = 1, WK = 2, BM = 3, BK = 4;
  const WIN = 100000, MATE_BOUND = WIN - 1000, INF = WIN + 1;
  const MAXPLY = 100;
  const DIRS = [-11, -9, 9, 11];
  const sideOf = (p) => (p === 0 ? 0 : p <= 2 ? WHITE : BLACK);
  const isKing = (p) => p === WK || p === BK;
  const onBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;
  // neighbour of sq in direction d, or -1 off the board
  const NB = new Int16Array(100 * 4);
  for (let s = 0; s < 100; s++) for (let k = 0; k < 4; k++) {
    const r = Math.floor(s / 10) + (k < 2 ? -1 : 1), c = (s % 10) + (k % 2 === 0 ? -1 : 1);
    NB[s * 4 + k] = onBoard(r, c) ? r * 10 + c : -1;
  }
  const DARK = [];
  for (let s = 0; s < 100; s++) if ((Math.floor(s / 10) + (s % 10)) % 2 === 1) DARK.push(s);
  const NUM = new Int8Array(100).fill(0), SQ = new Int8Array(51);
  DARK.forEach((s, i) => { NUM[s] = i + 1; SQ[i + 1] = s; });

  // ---------- state ----------
  const board = new Int8Array(100);
  const count = new Int16Array(5); // pieces by kind
  let stm = WHITE;
  let seed = 0x2545f491 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(5 * 100), Z2 = new Int32Array(5 * 100);
  for (let i = 0; i < 500; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  // history for draws, one entry per ply played: keys and counters
  let hist1 = [], hist2 = [], kingMoves = 0, endCount = 0;
  const hashHist = { k1: new Int32Array(1024), k2: new Int32Array(1024), n: 0 };

  function startArray() {
    const b = new Int8Array(100);
    for (const s of DARK) { const r = Math.floor(s / 10); if (r < 4) b[s] = BM; else if (r > 5) b[s] = WM; }
    return b;
  }
  function setPosition(arr, side) {
    board.set(arr); stm = side; count.fill(0); h1 = 0; h2 = 0;
    for (let s = 0; s < 100; s++) if (board[s]) { count[board[s]]++; h1 ^= Z1[board[s] * 100 + s]; h2 ^= Z2[board[s] * 100 + s]; }
    if (stm === BLACK) { h1 ^= ZS1; h2 ^= ZS2; }
    hashHist.n = 0; kingMoves = 0; endCount = 0;
  }
  const put = (s, p) => { board[s] = p; count[p]++; h1 ^= Z1[p * 100 + s]; h2 ^= Z2[p * 100 + s]; };
  const take = (s) => { const p = board[s]; board[s] = 0; count[p]--; h1 ^= Z1[p * 100 + s]; h2 ^= Z2[p * 100 + s]; return p; };

  // ---------- move generation ----------
  // Captures: depth-first over every sequence; only the longest survive. Same from/to/captured set = one move.
  function genCaptures(side, out) {
    let best = 0;
    const capt = new Int8Array(100); // squares captured so far in this sequence
    const caps = [], path = [];
    for (const s of DARK) {
      const p = board[s];
      if (sideOf(p) !== side) continue;
      board[s] = 0; // the moving piece has left its square
      if (isKing(p)) kingCaps(s, s, p, side);
      else manCaps(s, s, p, side);
      board[s] = p;
    }
    return best;

    function record(from, at, p) {
      const n = caps.length;
      if (n < best) return;
      if (n > best) { best = n; out.length = 0; }
      const set = caps.slice().sort((a, b) => a - b);
      for (const m of out) if (m.from === from && m.to === at && m.caps.length === n && m.caps.every((x, i) => x === set[i])) return;
      const promote = !isKing(p) && Math.floor(at / 10) === (side === WHITE ? 0 : 9);
      out.push({ from, to: at, path: path.slice(), caps: set, promote, piece: p });
    }
    function manCaps(from, at, p, side) {
      let any = false;
      for (let k = 0; k < 4; k++) {
        const v = NB[at * 4 + k];
        if (v < 0 || capt[v] || sideOf(board[v]) !== 3 - side) continue;
        const l = NB[v * 4 + k];
        if (l < 0 || board[l] !== 0) continue;
        any = true;
        capt[v] = 1; caps.push(v); path.push(l);
        manCaps(from, l, p, side);
        capt[v] = 0; caps.pop(); path.pop();
      }
      if (!any && caps.length) record(from, at, p);
    }
    function kingCaps(from, at, p, side) {
      let any = false;
      for (let k = 0; k < 4; k++) {
        let v = NB[at * 4 + k];
        while (v >= 0 && board[v] === 0) v = NB[v * 4 + k];
        if (v < 0 || capt[v] || sideOf(board[v]) !== 3 - side) continue;
        let l = NB[v * 4 + k];
        while (l >= 0 && board[l] === 0) {
          any = true;
          capt[v] = 1; caps.push(v); path.push(l);
          kingCaps(from, l, p, side);
          capt[v] = 0; caps.pop(); path.pop();
          l = NB[l * 4 + k];
        }
      }
      if (!any && caps.length) record(from, at, p);
    }
  }
  function genMoves(side) {
    const out = [];
    if (genCaptures(side, out) > 0) return out;
    const fwd = side === WHITE ? [0, 1] : [2, 3];
    for (const s of DARK) {
      const p = board[s];
      if (sideOf(p) !== side) continue;
      if (isKing(p)) {
        for (let k = 0; k < 4; k++) for (let v = NB[s * 4 + k]; v >= 0 && board[v] === 0; v = NB[v * 4 + k])
          out.push({ from: s, to: v, path: [v], caps: [], promote: false, piece: p });
      } else {
        for (const k of fwd) {
          const v = NB[s * 4 + k];
          if (v >= 0 && board[v] === 0) out.push({ from: s, to: v, path: [v], caps: [], promote: Math.floor(v / 10) === (side === WHITE ? 0 : 9), piece: p });
        }
      }
    }
    return out;
  }

  // ---------- make / unmake ----------
  // returns an undo record
  function make(m) {
    const u = { m, taken: [], kingMoves, endCount, key: [h1, h2] };
    hashHist.k1[hashHist.n] = h1; hashHist.k2[hashHist.n] = h2; hashHist.n++;
    const p = take(m.from);
    for (const c of m.caps) u.taken.push(take(c));
    put(m.to, m.promote ? (p === WM ? WK : BK) : p);
    // draw counters
    kingMoves = isKing(p) && !m.caps.length ? kingMoves + 1 : 0;
    endCount = endgameClass() ? (m.caps.length || m.promote ? 0 : endCount + 1) : 0;
    stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2;
    return u;
  }
  function unmake(u) {
    const m = u.m;
    stm = 3 - stm; h1 ^= ZS1; h2 ^= ZS2;
    const q = take(m.to);
    put(m.from, m.promote ? (q === WK ? WM : BM) : q);
    m.caps.forEach((c, i) => put(c, u.taken[i]));
    kingMoves = u.kingMoves; endCount = u.endCount;
    hashHist.n--;
  }
  // endgame draw class: 16 (three pieces incl. a king vs a lone king), 5 (two or fewer vs a lone king), 0 none
  function endgameClass() {
    const w = count[WM] + count[WK], b = count[BM] + count[BK];
    const lone = (k, total) => total === 1 && k === 1;
    if (lone(count[BK], b) && count[WK] >= 1) return w === 3 ? 16 : w <= 2 ? 5 : 0;
    if (lone(count[WK], w) && count[BK] >= 1) return b === 3 ? 16 : b <= 2 ? 5 : 0;
    return 0;
  }
  // draw by the rules in the current position (after the move that led here)
  function drawn() {
    if (kingMoves >= 50) return 'kings';           // 25 moves each, only kings, no capture
    const cls = endgameClass();
    if (cls && endCount >= cls * 2) return 'endgame';
    let reps = 0;                                   // positions with the same side to move, back to the last capture/man move
    for (let i = hashHist.n - 2, back = 2; i >= 0 && back <= Math.max(kingMoves, 0) + 1; i -= 2, back += 2)
      if (hashHist.k1[i] === h1 && hashHist.k2[i] === h2 && ++reps >= 2) return 'repetition';
    return '';
  }

  // ---------- evaluation (side to move's point of view) ----------
  const W = Object.assign({ man: 100, king: 320, adv: 3, center: 4, back: 6, tempo: 6, lone: 0 }, opts.weights || {});
  const CENTER = new Int8Array(100);
  for (const s of DARK) { const r = Math.floor(s / 10), c = s % 10; CENTER[s] = (r >= 3 && r <= 6 && c >= 2 && c <= 7) ? 1 : 0; }
  function sideScore(side) {
    let sc = 0;
    for (const s of DARK) {
      const p = board[s];
      if (sideOf(p) !== side) continue;
      if (isKing(p)) { sc += W.king; continue; }
      const r = Math.floor(s / 10), adv = side === WHITE ? 9 - r : r; // 0..9 rows advanced (start 0..3)
      sc += W.man + W.adv * adv + W.center * CENTER[s];
      if (adv === 0) sc += W.back;
    }
    return sc;
  }
  function evaluate() {
    const cls = endgameClass();
    if (cls) return 0; // a lone king against three or fewer: drawn by the counting rule, nearly always
    return sideScore(stm) - sideScore(3 - stm) + W.tempo;
  }

  // ---------- transposition table ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const tBest = new Int32Array(TT_SIZE); // from | to << 8 of the best move
  const ttClear = () => { tFlag.fill(0); tKey.fill(0); };
  let ply = 0;
  const toTT = (sc) => (sc >= MATE_BOUND ? sc + ply : sc <= -MATE_BOUND ? sc - ply : sc);
  const fromTT = (sc) => (sc >= MATE_BOUND ? sc - ply : sc <= -MATE_BOUND ? sc + ply : sc);
  const code = (m) => m.from | (m.to << 8) | ((m.caps.length ? m.caps[0] : 0) << 16);

  // ---------- search ----------
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0;
  const KIL = new Int32Array(MAXPLY * 2), HIST = new Int32Array(100 * 100);
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function ordered(moves, p, ttc) {
    const sc = moves.map((m) => {
      const c = code(m);
      if (c === ttc) return 1e9;
      let v = m.caps.length * 1e6 + (m.promote ? 5e5 : 0);
      if (c === KIL[p * 2]) v += 4e5; else if (c === KIL[p * 2 + 1]) v += 3e5;
      return v + HIST[m.from * 100 + m.to];
    });
    const idx = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
    return idx.map((i) => moves[i]);
  }
  function qsearch(alpha, beta, p) {
    nodes++;
    if (timeUp()) return 0;
    const moves = genMoves(stm);
    if (!moves.length) return -(WIN - p);
    const captures = moves[0].caps.length > 0;
    if (!captures) { // quiet: stand pat
      const stand = evaluate();
      if (stand >= beta || p >= MAXPLY - 2) return stand;
      if (stand > alpha) alpha = stand;
      return alpha;
    }
    let best = -INF;
    for (const m of ordered(moves, p, 0)) {
      const u = make(m); ply++;
      const sc = -qsearch(-beta, -alpha, p + 1);
      ply--; unmake(u);
      if (stopped) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  }
  function search(depth, alpha, beta, p, pv) {
    if (p > 0 && drawn()) return 0;
    const moves = genMoves(stm);
    if (!moves.length) return -(WIN - p);
    const forcedCapture = moves[0].caps.length > 0;
    if (depth <= 0 && !forcedCapture) return qsearch(alpha, beta, p);
    if (depth <= 0) depth = 1; // never stop the search in the middle of a capture exchange
    nodes++;
    if (timeUp()) return 0;
    const idx = h1 & TT_MASK;
    let ttc = 0;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttc = tBest[idx];
      if (!pv && tDepth[idx] >= depth) {
        const s = fromTT(tScore[idx]), fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    const a0 = alpha;
    let best = -INF, bestCode = 0, i = 0;
    for (const m of ordered(moves, p, ttc)) {
      const u = make(m); ply++;
      // a single legal move (often a forced capture) costs no depth
      const ext = moves.length === 1 ? 1 : 0;
      let sc;
      if (i === 0) sc = -search(depth - 1 + ext, -beta, -alpha, p + 1, pv);
      else {
        const r = depth >= 3 && i >= 4 && !m.caps.length && !m.promote ? 1 : 0;
        sc = -search(depth - 1 - r + ext, -alpha - 1, -alpha, p + 1, false);
        if (sc > alpha && r) sc = -search(depth - 1 + ext, -alpha - 1, -alpha, p + 1, false);
        if (sc > alpha && sc < beta) sc = -search(depth - 1 + ext, -beta, -alpha, p + 1, true);
      }
      ply--; unmake(u);
      if (stopped) return 0;
      i++;
      if (sc > best) { best = sc; bestCode = code(m); }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!m.caps.length) {
          const c = code(m);
          if (KIL[p * 2] !== c) { KIL[p * 2 + 1] = KIL[p * 2]; KIL[p * 2] = c; }
          HIST[m.from * 100 + m.to] += depth * depth;
        }
        break;
      }
    }
    tKey[idx] = h2; tBest[idx] = bestCode; tDepth[idx] = Math.min(depth, 127); tScore[idx] = toTT(best);
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes, soft}. Returns {move, score, depth, nodes, ms}; score from the side to move.
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    const soft = cfg.time ? cfg.time * (cfg.soft || 0.5) : 0, maxDepth = Math.min(cfg.depth || 60, MAXPLY - 10);
    nodes = 0; stopped = false; ply = 0;
    KIL.fill(0);
    for (let i = 0; i < HIST.length; i++) HIST[i] >>= 3;
    if (cfg.clearTT) ttClear();
    const moves = genMoves(stm);
    const info = { move: null, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!moves.length) { info.score = -WIN; return info; }
    if (moves.length === 1) { info.move = moves[0]; info.score = evaluate(); info.ms = Date.now() - t0; return info; }
    let best = moves[0];
    for (let d = 1; d <= maxDepth; d++) {
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) break;
      const idx = h1 & TT_MASK, c = tKey[idx] === h2 ? tBest[idx] : 0;
      const found = moves.find((m) => code(m) === c);
      if (found) best = found;
      info.depth = d; info.score = sc; info.move = best;
      if (Math.abs(sc) >= MATE_BOUND) break;
      if (soft && Date.now() - t0 >= soft) break;
      if (maxNodes && nodes >= maxNodes * 0.5) break;
    }
    if (!info.move) info.move = best;
    info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page ----------
  // the game so far: play moves given as {from, to, caps} (matched against the legal moves)
  function find(m) {
    return genMoves(stm).find((x) => x.from === m.from && x.to === m.to && x.caps.length === m.caps.length && x.caps.every((c, i) => c === m.caps[i]));
  }
  function play(m) { const x = find(m); if (!x) return false; make(x); return true; }
  // after a move: 'win' (the side that just moved won: the other has no move), 'draw:<why>', or ''
  function status() {
    if (!genMoves(stm).length) return 'win';
    const d = drawn();
    return d ? 'draw:' + d : '';
  }
  const notation = (m) => NUM[m.from] + (m.caps.length ? 'x' : '-') + NUM[m.to];
  function perft(d) {
    const moves = genMoves(stm);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) { const u = make(m); n += perft(d - 1); unmake(u); }
    return n;
  }

  setPosition(startArray(), WHITE);
  return {
    WHITE, BLACK, WIN, MATE_BOUND, WM, WK, BM, BK, DARK, NUM, SQ,
    startArray, setPosition, setStart() { setPosition(startArray(), WHITE); },
    legalMoves: () => genMoves(stm), play, status, think, evaluate, perft, notation, ttClear,
    get stm() { return stm; }, get board() { return board; },
    pieces: (side) => (side === WHITE ? count[WM] + count[WK] : count[BM] + count[BK]),
    kings: (side) => (side === WHITE ? count[WK] : count[BK]),
  };
}
if (typeof module !== 'undefined') module.exports = { DraughtsEngine };

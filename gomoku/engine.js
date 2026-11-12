// Gomoku engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts), by the page
// (rules) and by node (tools/test-gomoku.mjs).
//
// 15×15, Black moves first, five in a row wins. Three rule sets:
//   'free'   five or more in a row wins, for both sides
//   'ban33'  as free, but Black may not make two open threes at once (double three)
//   'renju'  Black may not make a double three, a double four or an overline (six or more), and Black wins only
//            with exactly five; White wins with five or more. A move that makes Black's five is never forbidden.
// A full board is a draw.
//
// Board: Int8Array(225), sq = row*15 + col; 0 empty, 1 black, 2 white.
// Evaluation: every 5-square window on the board (572 of them) counts the stones of each colour in it; a window
// holding only one colour is worth T[count] to that colour. The counts and both totals are kept up to date
// on every move, so evaluation is O(1). Move ordering uses the same windows (what a stone there would add for
// me plus what it would take away from the opponent).
// Search: alpha-beta (PVS) with iterative deepening, a transposition table, only the best-looking candidates
// near the stones, and the forcing facts at every node: a five now wins, an opponent's five threat must be
// blocked (two threats lose), and a search of continuous fours (VCF) for a forced win.
'use strict';

function GomokuEngine(opts) {
  opts = opts || {};
  const N = 15, NN = N * N, BLACK = 1, WHITE = 2;
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const T = [0, 2, 24, 240, 2400, 0]; // a window's worth by stones of one colour in it (five ends the game)
  let rule = opts.rule || 'free';

  const board = new Int8Array(NN);
  let stm = BLACK, count = 0;
  const history = [];
  // ---------- windows ----------
  const WIN_CELLS = [];                 // window → its 5 squares
  const OF = Array.from({ length: NN }, () => []); // square → windows containing it
  for (const [dr, dc] of DIRS) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const er = r + 4 * dr, ec = c + 4 * dc;
    if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
    const w = WIN_CELLS.length, cells = [];
    for (let k = 0; k < 5; k++) cells.push((r + k * dr) * N + (c + k * dc));
    WIN_CELLS.push(cells);
    for (const s of cells) OF[s].push(w);
  }
  const NW = WIN_CELLS.length;
  const cnt = [null, new Int8Array(NW), new Int8Array(NW)];
  const total = [0, 0, 0];
  const worth = (w, color) => (cnt[3 - color][w] ? 0 : T[cnt[color][w]]);
  // squares within two of a stone (candidate moves)
  const near = new Int16Array(NN);
  const NEAR = Array.from({ length: NN }, (_, s) => {
    const r = Math.floor(s / N), c = s % N, out = [];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
    }
    return out;
  });
  // Zobrist keys
  let seed = 0x1b873593 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(3 * NN), Z2 = new Int32Array(3 * NN);
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  let h1 = 0, h2 = 0;

  function place(s, color) {
    for (const w of OF[s]) { total[1] -= worth(w, 1); total[2] -= worth(w, 2); cnt[color][w]++; total[1] += worth(w, 1); total[2] += worth(w, 2); }
    board[s] = color; count++;
    for (const t of NEAR[s]) near[t]++;
    h1 ^= Z1[color * NN + s]; h2 ^= Z2[color * NN + s];
  }
  function lift(s) {
    const color = board[s];
    for (const w of OF[s]) { total[1] -= worth(w, 1); total[2] -= worth(w, 2); cnt[color][w]--; total[1] += worth(w, 1); total[2] += worth(w, 2); }
    board[s] = 0; count--;
    for (const t of NEAR[s]) near[t]--;
    h1 ^= Z1[color * NN + s]; h2 ^= Z2[color * NN + s];
  }
  function make(s) { place(s, stm); history.push(s); stm = 3 - stm; }
  function unmake() { const s = history.pop(); lift(s); stm = 3 - stm; }

  // ---------- lines (exact rule checks) ----------
  const at = (r, c) => (r < 0 || r >= N || c < 0 || c >= N ? -1 : board[r * N + c]);
  // stones of `color` in a row through s along d, counting s as `color`
  function run(s, color, dr, dc) {
    const r = Math.floor(s / N), c = s % N;
    let n = 1;
    for (let k = 1; at(r + k * dr, c + k * dc) === color; k++) n++;
    for (let k = 1; at(r - k * dr, c - k * dc) === color; k++) n++;
    return n;
  }
  const exactFive = (color) => rule === 'renju' && color === BLACK;
  // would a stone of `color` on empty s make a winning five?
  function makesFive(s, color) {
    for (const [dr, dc] of DIRS) {
      const n = run(s, color, dr, dc);
      if (exactFive(color) ? n === 5 : n >= 5) return true;
    }
    return false;
  }
  function overline(s, color) { for (const [dr, dc] of DIRS) if (run(s, color, dr, dc) >= 6) return true; return false; }
  // The line through s along d as 13 cells (s in the middle, index 6): 1 = color, 0 = empty, 2 = blocked.
  function line(s, color, dr, dc, out) {
    const r = Math.floor(s / N), c = s % N;
    for (let k = -6; k <= 6; k++) { const v = at(r + k * dr, c + k * dc); out[k + 6] = v === color ? 1 : v === 0 ? 0 : 2; }
    return out;
  }
  const L = new Int8Array(13);
  // fives a stone on line index e would complete together with the centre (s already placed): count the
  // distinct sets of four existing stones that make a five with e — so a straight four counts once and
  // two fours on one line count twice
  function foursOnLine(ln, exact) {
    const keys = new Set();
    for (let e = 2; e <= 10; e++) {
      if (ln[e] !== 0) continue;
      ln[e] = 1;
      let a = 6, b = 6;
      while (ln[a - 1] === 1) a--;
      while (ln[b + 1] === 1) b++;
      const len = b - a + 1;
      if (a <= e && e <= b && (exact ? len === 5 : len >= 5)) {
        // the four stones besides e (for length 5); an overline-capable run under 'free' is still one five
        const k = [];
        for (let i = a; i <= b; i++) if (i !== e) k.push(i);
        keys.add(k.join(','));
      }
      ln[e] = 0;
    }
    return keys.size;
  }
  // does placing on line index e make a straight four (_XXXX_ that becomes five at either end) with the centre?
  function straightFourAt(ln, e, exact) {
    if (ln[e] !== 0) return false;
    ln[e] = 1;
    let a = 6, b = 6;
    while (ln[a - 1] === 1) a--;
    while (ln[b + 1] === 1) b++;
    let ok = a <= e && e <= b && b - a + 1 === 4 && ln[a - 1] === 0 && ln[b + 1] === 0;
    if (ok && exact) ok = ln[a - 2] !== 1 && ln[b + 2] !== 1; // filling an end must not make six
    ln[e] = 0;
    return ok;
  }
  // Is a black stone on empty s forbidden under the current rule? (white is never restricted)
  function forbidden(s, depth = 0) {
    if (rule === 'free' || board[s] !== 0) return false;
    if (makesFive(s, BLACK)) return false; // a five takes precedence
    const exact = rule === 'renju';
    place(s, BLACK);
    let bad = false;
    if (exact && overline(s, BLACK)) bad = true;
    let fours = 0, threes = 0;
    if (!bad) for (const [dr, dc] of DIRS) {
      line(s, BLACK, dr, dc, L);
      if (exact) fours += foursOnLine(L, true);
      // an open three: some empty point on this line makes a straight four (and isn't itself forbidden, for renju)
      const r = Math.floor(s / N), c = s % N;
      for (let e = 2; e <= 10; e++) {
        if (e === 6 || !straightFourAt(L, e, exact)) continue;
        if (exact && depth < 2) {
          const k = e - 6, es = (r + k * dr) * N + (c + k * dc);
          if (forbidden(es, depth + 1)) continue;
          line(s, BLACK, dr, dc, L); // restore the buffer after the nested check
        }
        threes++; break;
      }
    }
    if (exact && fours >= 2) bad = true;
    if (threes >= 2) bad = true;
    lift(s);
    return bad;
  }

  // for the page's remarks: what the stone on s (already placed) makes — fours (five threats through it) and
  // open threes (lines through it that one more stone turns into a straight four)
  function shape(s) {
    const color = board[s], exact = exactFive(color);
    let fours = 0, threes = 0;
    if (!color) return { fours, threes };
    for (const [dr, dc] of DIRS) {
      line(s, color, dr, dc, L);
      const f = foursOnLine(L, exact);
      fours += f;
      if (!f) for (let e = 2; e <= 10; e++) if (e !== 6 && straightFourAt(L, e, exact)) { threes++; break; }
    }
    return { fours, threes };
  }
  // the five in a row through s, if any (for drawing the winning line)
  function fiveLine(s) {
    const color = board[s], r = Math.floor(s / N), c = s % N;
    for (const [dr, dc] of DIRS) {
      let a = 0, b = 0;
      while (at(r + (a - 1) * dr, c + (a - 1) * dc) === color) a--;
      while (at(r + (b + 1) * dr, c + (b + 1) * dc) === color) b++;
      if (b - a + 1 >= 5) return [(r + a * dr) * N + (c + a * dc), (r + b * dr) * N + (c + b * dc)];
    }
    return null;
  }
  // squares that complete a winning five for `color` right now
  function fivePoints(color, out) {
    out.length = 0;
    const opp = 3 - color;
    for (let w = 0; w < NW; w++) {
      if (cnt[color][w] !== 4 || cnt[opp][w]) continue;
      for (const s of WIN_CELLS[w]) if (!board[s] && !out.includes(s) && makesFive(s, color)) out.push(s);
    }
    return out;
  }

  // ---------- evaluation and ordering ----------
  const evaluate = () => total[stm] - total[3 - stm] + 30;
  function gain(s, color) { // what a stone here adds for color, plus what it takes from the other side
    let g = 0;
    const opp = 3 - color;
    for (const w of OF[s]) {
      const me = cnt[color][w], them = cnt[opp][w];
      if (!them) g += T[me + 1 > 4 ? 4 : me + 1] * (me + 1 >= 5 ? 50 : 1) - T[me];
      if (!me) g += (T[them + 1 > 4 ? 4 : them + 1] * (them + 1 >= 5 ? 40 : 1) - T[them]) * 0.8;
    }
    return g;
  }
  function candidates(limit) {
    const out = [];
    if (!count) { out.push(7 * N + 7); return out; }
    for (let s = 0; s < NN; s++) if (!board[s] && near[s]) out.push(s);
    const sc = new Float64Array(NN);
    for (const s of out) sc[s] = gain(s, stm);
    out.sort((a, b) => sc[b] - sc[a]);
    return limit ? out.slice(0, limit * 2) : out; // twice the limit: forbidden ones are dropped later
  }

  // ---------- VCF: a win by continuous fours ----------
  const FP = [[], [], []];
  for (let i = 0; i < 64; i++) FP.push([]);
  function vcf(depth, p) {
    const me = stm, opp = 3 - me;
    const mine = fivePoints(me, FP[p % FP.length]);
    if (mine.length) return true;
    if (depth <= 0) return false;
    const theirs = fivePoints(opp, []);
    if (theirs.length) return false; // they threaten five: a four of ours doesn't answer that (unless it's five)
    // moves of mine that make a four (a new five threat)
    const tried = new Set();
    for (let w = 0; w < NW; w++) {
      if (cnt[me][w] !== 3 || cnt[opp][w]) continue;
      for (const s of WIN_CELLS[w]) {
        if (board[s] || tried.has(s)) continue;
        tried.add(s);
        if (me === BLACK && forbidden(s)) continue;
        make(s);
        const threats = fivePoints(me, []);
        let win = false;
        if (threats.length >= 2) win = !fivePoints(opp, []).length; // two threats, and they have no five of their own
        else if (threats.length === 1) {
          const b = threats[0];
          if (!fivePoints(opp, []).length || fivePoints(opp, []).includes(b)) {
            const blockedByForbidden = opp === BLACK && forbidden(b);
            if (blockedByForbidden) win = true;
            else { make(b); if (!makesFiveAfter(b, opp)) win = vcf(depth - 1, p + 2); unmake(); }
          }
        }
        unmake();
        if (win) return true;
      }
    }
    return false;
  }
  const makesFiveAfter = (s, color) => { // the stone just placed on s made a five?
    for (const [dr, dc] of DIRS) { const n = run(s, color, dr, dc); if (exactFive(color) ? n === 5 : n >= 5) return true; }
    return false;
  };

  // ---------- search ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int16Array(TT_SIZE).fill(-1);
  const tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = -1;
  const BEAM = opts.beam || 10;
  function timeUp() {
    if ((nodes & 255) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  const legalFor = (s) => !board[s] && !(stm === BLACK && forbidden(s));
  function search(depth, alpha, beta, p, pv) {
    nodes++;
    if (timeUp()) return 0;
    if (count === NN) return 0;
    const me = stm, opp = 3 - me;
    if (fivePoints(me, FP[p % FP.length]).length) return WIN - p - 1;
    const theirs = fivePoints(opp, []);
    let moves;
    if (theirs.length >= 2) return -(WIN - p - 2);
    if (theirs.length === 1) {
      if (!legalFor(theirs[0])) return -(WIN - p - 2);
      moves = [theirs[0]];
    }
    if (depth <= 0 && !moves) {
      if (vcf(6, p)) return WIN - p - 20;
      return evaluate();
    }
    const idx = h1 & TT_MASK;
    let ttMove = -1;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pv && tDepth[idx] >= depth) {
        const s = tScore[idx], fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    if (!moves) {
      moves = candidates(BEAM);
      if (ttMove >= 0 && !board[ttMove]) { moves = moves.filter((m) => m !== ttMove); moves.unshift(ttMove); }
    }
    const a0 = alpha;
    let best = -INF, bestMove = -1, n = 0;
    for (const m of moves) {
      if (n >= BEAM && moves.length > 1) break;
      if (me === BLACK && forbidden(m)) continue;
      n++;
      make(m);
      let sc;
      const ext = moves.length === 1 ? 1 : 0; // a forced block costs no depth
      if (n === 1) sc = -search(depth - 1 + ext, -beta, -alpha, p + 1, pv);
      else {
        sc = -search(depth - 1 + ext, -alpha - 1, -alpha, p + 1, false);
        if (sc > alpha && sc < beta) sc = -search(depth - 1 + ext, -beta, -alpha, p + 1, true);
      }
      unmake();
      if (stopped) return 0;
      if (sc > best) { best = sc; bestMove = m; if (p === 0) rootBest = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    if (bestMove < 0) return -(WIN - p - 2); // nothing legal near: treat as lost (only with forbidden moves everywhere)
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
    const info = { move: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!count) { info.move = 7 * N + 7; return info; }
    const legal = legalMoves();
    if (!legal.length) return info;
    // a five now; a block of their five; a forced win by fours
    const mine = fivePoints(stm, []);
    if (mine.length) { info.move = mine[0]; info.score = WIN - 1; info.ms = Date.now() - t0; return info; }
    let best = candidates(0).find((s) => legalFor(s)) ?? legal[0];
    const maxDepth = cfg.depth || 30;
    for (let d = 1; d <= maxDepth; d++) {
      rootBest = -1;
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) { if (rootBest >= 0 && d > 1) best = rootBest; break; }
      if (rootBest >= 0) best = rootBest;
      info.depth = d; info.score = sc;
      if (Math.abs(sc) >= WIN_BOUND) break;
      if (cfg.time && Date.now() - t0 > cfg.time * 0.45) break;
      if (maxNodes && nodes > maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page ----------
  function legalMoves() { const out = []; for (let s = 0; s < NN; s++) if (legalFor(s)) out.push(s); return out; }
  function setStart() { history.length = 0; for (let q = 0; q < NN; q++) if (board[q]) lift(q); stm = BLACK; }
  // an arbitrary position (for tests): stones of each colour, and who moves
  function setPosition(blacks, whites, side) {
    setStart();
    for (const sq of blacks) place(sq, BLACK);
    for (const sq of whites) place(sq, WHITE);
    stm = side || BLACK;
  }
  // after the last move: 'win' (the side that just moved made five), 'draw' (full board), ''
  function status() {
    if (!history.length) return '';
    const s = history[history.length - 1], color = board[s];
    if (makesFiveAfter(s, color)) return 'win';
    if (count === NN) return 'draw';
    return '';
  }
  const sqName = (s) => 'ABCDEFGHJKLMNOP'[s % N] + (N - Math.floor(s / N));

  return {
    N, BLACK, WHITE, WIN, WIN_BOUND,
    setRule(r) { rule = r; }, get rule() { return rule; },
    setStart, setPosition, play: make, undo: unmake, legalMoves, forbidden: (s) => stm === BLACK && forbidden(s), status, think, evaluate, sqName,
    fivePoints: (color) => fivePoints(color, []), vcf: (d) => vcf(d || 10, 0), shape, fiveLine,
    get stm() { return stm; }, get board() { return board; }, get count() { return count; }, get last() { return history[history.length - 1]; },
  };
}
if (typeof module !== 'undefined') module.exports = { GomokuEngine };

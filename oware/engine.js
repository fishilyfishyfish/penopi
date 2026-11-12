// Oware engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts),
// by the page (rules) and by node (tools/test-oware.mjs).
//
// Rules (abapa, the usual tournament rules): two rows of six pits, four seeds in each. Player 0 owns pits
// 0–5, player 1 pits 6–11; player 0 moves first. A move takes every seed from one of one's own pits and sows
// them one by one into the following pits, counterclockwise (index + 1, after 11 comes 0), skipping the
// starting pit when there are twelve or more. If the last seed lands in an opposing pit that then holds two
// or three seeds, those are captured, and so are the pits just before it while they are opposing pits with
// two or three. A capture that would take every opposing seed is forfeited (the move stands, nothing is
// taken). If the opponent has no seeds, a move must give them some; if none can, the game ends and the
// mover takes the seeds on their side. More than 24 captured wins; 24 each is a draw. A game going round in
// circles (the same position with the same side to move three times, or 100 moves each without a capture)
// ends with each side taking the seeds on their own side.
//
// Board: Int8Array(14), pits 0–11, captured seeds of player 0 at 12 and of player 1 at 13. Move: the pit.
'use strict';

function OwareEngine(opts) {
  opts = opts || {};
  const WIN = 100000, WIN_BOUND = WIN - 1000, INF = WIN + 1;
  const QUIET_LIMIT = 200;
  const b = new Int8Array(14);
  let stm = 0, quiet = 0;
  let seed = 0x5b1d3a77 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(13 * 49), Z2 = new Int32Array(13 * 49); // pits 0–11 and store 0 (store 1 follows)
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();
  let h1 = 0, h2 = 0;
  function rehash() {
    h1 = 0; h2 = 0;
    for (let i = 0; i < 13; i++) { h1 ^= Z1[i * 49 + b[i]]; h2 ^= Z2[i * 49 + b[i]]; }
    if (stm) { h1 ^= ZS1; h2 ^= ZS2; }
  }
  const MAXP = 512;
  const snap = new Int8Array(MAXP * 14), sQuiet = new Int32Array(MAXP), keys1 = new Int32Array(MAXP), keys2 = new Int32Array(MAXP);
  let sp = 0;
  function setStart() {
    for (let i = 0; i < 12; i++) b[i] = 4;
    b[12] = b[13] = 0; stm = 0; quiet = 0; sp = 0;
    rehash();
  }
  const sideSeeds = (p) => { let n = 0; for (let i = p * 6; i < p * 6 + 6; i++) n += b[i]; return n; };
  const own = (p, i) => i >= p * 6 && i < p * 6 + 6;

  // sow pit m of side p on board a (in place); returns {last, captured: [pits]} with the capture already taken
  function sow(a, m, p, out) {
    let n = a[m], i = m;
    a[m] = 0;
    while (n > 0) { i = i === 11 ? 0 : i + 1; if (i === m) continue; a[i]++; n--; }
    let cap = 0, j = i;
    const opp = 1 - p;
    if (own(opp, i)) {
      while (own(opp, j) && (a[j] === 2 || a[j] === 3)) { cap += a[j]; j--; }
      if (cap) {
        // grand slam: would every opposing pit be empty after the capture?
        let left = 0;
        for (let k = opp * 6; k < opp * 6 + 6; k++) if (k > i || k <= j) left += a[k];
        if (!left) cap = 0;
        else {
          for (let k = i; k > j; k--) { if (out) out.push(k); a[k] = 0; }
          a[12 + p] += cap;
        }
      }
    }
    return cap;
  }
  // legal moves of the side to move (must feed an empty opponent)
  function gen(out) {
    out.length = 0;
    const base = stm * 6, starving = sideSeeds(1 - stm) === 0;
    for (let m = base; m < base + 6; m++) {
      if (!b[m]) continue;
      if (starving && b[m] < base + 6 - m) continue; // doesn't reach the opposing row
      out.push(m);
    }
    return out;
  }
  function make(m) {
    snap.set(b, sp * 14); sQuiet[sp] = quiet; keys1[sp] = h1; keys2[sp] = h2; sp++;
    const cap = sow(b, m, stm, null);
    quiet = cap ? 0 : quiet + 1;
    stm = 1 - stm;
    rehash();
    return cap;
  }
  function unmake() {
    sp--;
    for (let i = 0; i < 14; i++) b[i] = snap[sp * 14 + i];
    quiet = sQuiet[sp]; h1 = keys1[sp]; h2 = keys2[sp];
    stm = 1 - stm;
  }
  function repeats() {
    let n = 0;
    for (let i = sp - 2; i >= 0 && i >= sp - quiet; i -= 2) if (keys1[i] === h1 && keys2[i] === h2) n++;
    return n;
  }
  // final captured counts if the game ended now with each side taking its own seeds
  const finalSplit = () => [b[12] + sideSeeds(0), b[13] + sideSeeds(1)];
  const SCR = [];
  // '' while playing, else 'score' (more than 24 captured, or 24 each), 'nofeed' (the side to move can't
  // give the starving opponent seeds), 'repetition' or 'quiet'. finalScores() then has both totals.
  function status() {
    if (b[12] > 24 || b[13] > 24 || (b[12] === 24 && b[13] === 24)) return 'score';
    if (!gen(SCR).length) return 'nofeed';
    if (quiet >= QUIET_LIMIT) return 'quiet';
    if (repeats() >= 2) return 'repetition';
    return '';
  }
  function finalScores() {
    const s = status();
    if (s === 'score' || s === '') return [b[12], b[13]];
    return finalSplit();
  }
  function legalMoves() { return gen([]).slice(); }

  // ---------- evaluation (side to move) ----------
  const W = Object.assign({ store: 100, seeds: 2, weak: 5, big: 6, tempo: 4 }, opts.weights || {});
  function sideTerms(p) {
    let s = 0, weak = 0, big = 0;
    for (let i = p * 6; i < p * 6 + 6; i++) {
      const n = b[i];
      s += n;
      if (n === 1 || n === 2) weak++; // one or two seeds: a last seed makes it two or three
      if (n >= 12) big++;             // a heap that goes all the way round
    }
    return W.seeds * s - W.weak * weak + W.big * big;
  }
  const evaluate = () => W.store * (b[12 + stm] - b[13 - stm]) + sideTerms(stm) - sideTerms(1 - stm) + W.tempo;
  function terminalValue(p, split) { // from the side to move
    const f = split ? finalSplit() : [b[12], b[13]];
    const d = f[stm] - f[1 - stm];
    return d > 0 ? WIN - p : d < 0 ? -(WIN - p) : 0;
  }

  // ---------- search ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tKey = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int8Array(TT_SIZE), tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const MV = [];
  for (let i = 0; i < MAXP; i++) MV.push([]);
  const HIST = new Int32Array(12);
  const tmp = new Int8Array(14);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = -1;
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  function search(depth, alpha, beta, p, pv) {
    nodes++;
    if (timeUp()) return 0;
    if (b[12 + stm] > 24) return WIN - p;
    if (b[13 - stm] > 24) return -(WIN - p);
    if (b[12] === 24 && b[13] === 24) return 0;
    const moves = gen(MV[p]);
    if (!moves.length) return terminalValue(p, true);
    if (p > 0 && (quiet >= QUIET_LIMIT || repeats() >= 1)) return terminalValue(p, true);
    if (p >= MAXP - 2) return evaluate();
    if (depth <= 0) return evaluate();
    const idx = h1 & TT_MASK;
    let ttMove = -1;
    if (tFlag[idx] && tKey[idx] === h2) {
      ttMove = tMove[idx];
      if (!pv && tDepth[idx] >= depth) {
        const s = tScore[idx], fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && s >= beta) || (fl === 3 && s <= alpha)) return s;
      }
    }
    // order: table move, then by seeds captured, then history
    const sc = [];
    for (let k = 0; k < moves.length; k++) {
      const m = moves[k];
      if (m === ttMove) { sc.push(1e9); continue; }
      tmp.set(b);
      sc.push(sow(tmp, m, stm, null) * 1e6 + HIST[m]);
    }
    const order = moves.map((_, i) => i).sort((x, y) => sc[y] - sc[x]);
    const a0 = alpha;
    let best = -INF, bestMove = -1, n = 0;
    for (const i of order) {
      const m = moves[i];
      make(m);
      let v;
      if (n++ === 0) v = -search(depth - 1, -beta, -alpha, p + 1, pv);
      else {
        v = -search(depth - 1, -alpha - 1, -alpha, p + 1, false);
        if (v > alpha && v < beta) v = -search(depth - 1, -beta, -alpha, p + 1, true);
      }
      unmake();
      if (stopped) return 0;
      if (v > best) { best = v; bestMove = m; if (p === 0) rootBest = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) { HIST[m] += depth * depth; break; }
    }
    tKey[idx] = h2; tMove[idx] = bestMove; tDepth[idx] = Math.min(depth, 127); tScore[idx] = best;
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
    for (let i = 0; i < 12; i++) HIST[i] >>= 2;
    const legal = legalMoves();
    const info = { move: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
    if (!legal.length) return info;
    // a forced move is still searched (briefly) so the score is there for Penopi's lines
    if (legal.length === 1 && cfg.time) deadline = t0 + Math.min(cfg.time, 250);
    let best = legal[0];
    for (let d = 1; d <= (cfg.depth || 120); d++) {
      rootBest = -1;
      const sc = search(d, -INF, INF, 0, true);
      if (stopped) { if (rootBest >= 0 && d > 1) best = rootBest; break; }
      if (rootBest >= 0) best = rootBest;
      info.depth = d; info.score = sc;
      if (Math.abs(sc) >= WIN_BOUND) break;
      if (cfg.time && Date.now() - t0 > cfg.time * 0.5) break;
      if (maxNodes && nodes > maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }
  // what a move does, without playing it: the pits it sows in order and the pits it captures
  function preview(m) {
    const a = Int8Array.from(b), path = [];
    let n = a[m], i = m;
    while (n > 0) { i = i === 11 ? 0 : i + 1; if (i === m) continue; path.push(i); n--; }
    const captured = [];
    const cap = sow(a, m, stm, captured);
    // a forfeited grand slam: the last seed made two or three but nothing was taken
    const last = path[path.length - 1];
    const slam = !cap && own(1 - stm, last) && (a[last] === 2 || a[last] === 3);
    return { path, captured, seeds: cap, slam };
  }
  const NAMES = 'ABCDEFabcdef';
  const notation = (m) => NAMES[m];
  function setPosition(pits, stores, side) { // for tests
    for (let i = 0; i < 12; i++) b[i] = pits[i];
    b[12] = stores ? stores[0] : 0; b[13] = stores ? stores[1] : 0;
    stm = side || 0; quiet = 0; sp = 0;
    rehash();
  }

  setStart();
  return {
    WIN, WIN_BOUND, setStart, setPosition, legalMoves, play: make, undo: unmake, status, finalScores, think, evaluate,
    preview, notation, sideSeeds,
    get stm() { return stm; }, get board() { return b; }, get quiet() { return quiet; },
  };
}
if (typeof module !== 'undefined') module.exports = { OwareEngine };

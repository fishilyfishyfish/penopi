// Dots and Boxes engine (written for Penopi). Plain script, no build: loaded by worker.js (importScripts), by the
// page (rules) and by node (tools/test-dots.mjs).
//
// Rules: a grid of dots, R × C boxes. Players take turns drawing one line between two neighbouring dots. Drawing the
// fourth side of a box claims it and the same player must draw again (also after claiming two at once). When every
// line is drawn the player with more boxes wins (equal is a draw).
//
// Lines: horizontal ones first, row by row ((R+1) rows of C), then vertical ones ((R) rows of C+1).
//   h(r, c) = r*C + c                      between dots (r, c) and (r, c+1), r = 0..R
//   v(r, c) = (R+1)*C + r*(C+1) + c        between dots (r, c) and (r+1, c), r = 0..R-1
// Box (r, c) has top h(r,c), bottom h(r+1,c), left v(r,c), right v(r,c+1).
//
// Search: negamax alpha-beta over the boxes still to be won (values in boxes × 100 from the side to move's view;
// claiming a box keeps the turn), iterative deepening, transposition table on the drawn lines. Two standard
// reductions keep it small and exact: when a box can be claimed, only claiming moves are tried, plus the
// "double-dealing" move that hands over the last two boxes of a chain to keep control; claiming costs no depth.
// Evaluation at the horizon: boxes plus the long chain rule (who will have to open the first long chain, guessed
// from the parity of the safe moves left).
'use strict';

function DotsEngine(opts) {
  opts = opts || {};
  const R = opts.rows || 4, C = opts.cols || R;
  const NH = (R + 1) * C, E = NH + R * (C + 1), NB = R * C;
  const hIdx = (r, c) => r * C + c, vIdx = (r, c) => NH + r * (C + 1) + c;
  // per line: the boxes on its two sides (−1 at the border); per box: its four lines
  const SIDE1 = new Int16Array(E).fill(-1), SIDE2 = new Int16Array(E).fill(-1), BOXL = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const b = r * C + c, ls = [hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)];
    BOXL.push(ls);
    for (const l of ls) { if (SIDE1[l] < 0) SIDE1[l] = b; else SIDE2[l] = b; }
  }
  const drawn = new Uint8Array(E), sides = new Uint8Array(NB), owner = new Int8Array(NB); // owner 0 none, 1 / 2
  let stm = 1, left = E;
  const score = [0, 0, 0];
  let seed = 0x1b873593 | 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const Z1 = new Int32Array(E), Z2 = new Int32Array(E);
  for (let i = 0; i < E; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  let h1 = 0, h2 = 0;
  const stackL = new Int16Array(E + 4), stackG = new Int8Array(E + 4), stackS = new Int8Array(E + 4);
  let sp = 0;

  function setStart() {
    drawn.fill(0); sides.fill(0); owner.fill(0);
    stm = 1; left = E; score[1] = score[2] = 0; h1 = h2 = 0; sp = 0;
  }
  // draw line l for the side to move; returns boxes claimed (0, 1 or 2). The turn passes only if 0.
  function make(l) {
    drawn[l] = 1; left--; h1 ^= Z1[l]; h2 ^= Z2[l];
    let g = 0;
    const a = SIDE1[l], b = SIDE2[l];
    if (a >= 0 && ++sides[a] === 4) { owner[a] = stm; g++; }
    if (b >= 0 && ++sides[b] === 4) { owner[b] = stm; g++; }
    stackL[sp] = l; stackG[sp] = g; stackS[sp] = stm; sp++;
    score[stm] += g;
    if (!g) stm = 3 - stm;
    return g;
  }
  function unmake() {
    sp--;
    const l = stackL[sp], g = stackG[sp];
    stm = stackS[sp];
    score[stm] -= g;
    const a = SIDE1[l], b = SIDE2[l];
    if (a >= 0) { if (sides[a] === 4) owner[a] = 0; sides[a]--; }
    if (b >= 0) { if (sides[b] === 4) owner[b] = 0; sides[b]--; }
    drawn[l] = 0; left++; h1 ^= Z1[l]; h2 ^= Z2[l];
  }
  // would line l claim a box?   is it "safe" (claims nothing and makes no box three-sided)?
  const claims = (l) => (SIDE1[l] >= 0 && sides[SIDE1[l]] === 3) || (SIDE2[l] >= 0 && sides[SIDE2[l]] === 3);
  const safe = (l) => !((SIDE1[l] >= 0 && sides[SIDE1[l]] >= 2) || (SIDE2[l] >= 0 && sides[SIDE2[l]] >= 2));
  function safeCount() { let n = 0; for (let l = 0; l < E; l++) if (!drawn[l] && safe(l)) n++; return n; }

  const SEEN = new Uint8Array(E);
  // moves worth trying (see the header): claiming moves and double-deals if any box can be claimed, else all
  function gen(out) {
    out.length = 0;
    let any = false;
    for (let b = 0; b < NB; b++) if (sides[b] === 3) { any = true; break; }
    if (!any) { for (let l = 0; l < E; l++) if (!drawn[l]) out.push(l); return out; }
    const seen = SEEN; seen.fill(0);
    for (let b = 0; b < NB; b++) {
      if (sides[b] !== 3) continue;
      const ls = BOXL[b];
      let e = -1;
      for (const l of ls) if (!drawn[l]) e = l;
      if (!seen[e]) { seen[e] = 1; out.push(e); }
      // double-deal: the box beyond e has exactly two sides; drawing its other free line (not e) hands both over
      const n = SIDE1[e] === b ? SIDE2[e] : SIDE1[e];
      if (n >= 0 && sides[n] === 2) {
        for (const f of BOXL[n]) {
          if (drawn[f] || f === e || seen[f]) continue;
          const o = SIDE1[f] === n ? SIDE2[f] : SIDE1[f];
          if (o >= 0 && sides[o] === 3) continue; // that would claim a box: not a hand-over
          seen[f] = 1; out.push(f);
        }
      }
    }
    return out;
  }

  // ---------- evaluation (boxes × 100, side to move, future boxes only) ----------
  const W = Object.assign({ chain: 0.5 }, opts.weights || {});
  // the boxes still free, split into chains and loops along boxes with two sides drawn (for the long chain guess)
  // how many more safe lines there are if both sides just keep drawing safe ones: greedily, on a copy of the side counts
  const tmpSides = new Uint8Array(NB);
  function safeRun() {
    tmpSides.set(sides);
    let n = 0;
    for (let l = 0; l < E; l++) {
      if (drawn[l]) continue;
      const a = SIDE1[l], b = SIDE2[l];
      if ((a >= 0 && tmpSides[a] >= 2) || (b >= 0 && tmpSides[b] >= 2)) continue;
      if (a >= 0) tmpSides[a]++;
      if (b >= 0) tmpSides[b]++;
      n++;
    }
    return n;
  }
  function evaluate() {
    if (!W.chain) return 0;
    // long chain rule, roughly: if the safe lines left run out on the side to move, it has to open the first long
    // chain and the other side takes most of what is left
    const s = safeRun();
    if (s > 10) return 0;
    const freeBoxes = NB - score[1] - score[2];
    const stake = Math.min(freeBoxes, 2 + freeBoxes / 3) * 100 * (10 - s) / 10 * W.chain;
    return Math.round(s % 2 === 0 ? -stake : stake);
  }

  // ---------- search ----------
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const tExact = new Uint8Array(TT_SIZE), tKey = new Int32Array(TT_SIZE), tKey1 = new Int32Array(TT_SIZE), tScore = new Int32Array(TT_SIZE), tMove = new Int16Array(TT_SIZE), tDepth = new Int8Array(TT_SIZE), tFlag = new Int8Array(TT_SIZE);
  const MV = [];
  for (let i = 0; i < E + 8; i++) MV.push([]);
  const HIST = new Int32Array(E);
  let nodes = 0, deadline = 0, stopped = false, maxNodes = 0, rootBest = -1, horizon = 0; // horizon: leaves cut by depth
  function timeUp() {
    if ((nodes & 1023) === 0 && ((deadline && Date.now() >= deadline) || (maxNodes && nodes >= maxNodes))) stopped = true;
    return stopped;
  }
  const SC = [];
  for (let i = 0; i < E + 8; i++) SC.push(new Int32Array(E));
  // the side to move's best margin in the boxes still free (× 100)
  function search(depth, alpha, beta, ply) {
    nodes++;
    if (timeUp()) return 0;
    if (!left) return 0;
    const moves = gen(MV[ply]);
    let forcing = false;
    for (let b = 0; b < NB; b++) if (sides[b] === 3) { forcing = true; break; }
    if (depth <= 0 && !forcing) { horizon++; return evaluate(); }
    const idx = h1 & TT_MASK, stmKey = h2 ^ (stm === 2 ? 0x5bd1e995 : 0);
    let ttMove = -1;
    if (tFlag[idx] && tKey[idx] === stmKey && tKey1[idx] === h1) {
      ttMove = tMove[idx];
      if (ply > 0 && tDepth[idx] >= depth) { // never at the root: the root has to name its move
        const sv = tScore[idx], fl = tFlag[idx];
        if (fl === 1 || (fl === 2 && sv >= beta) || (fl === 3 && sv <= alpha)) { if (!tExact[idx]) horizon++; return sv; }
      }
    }
    const sc = SC[ply], h0 = horizon;
    for (let i = 0; i < moves.length; i++) {
      const l = moves[i];
      sc[i] = l === ttMove ? 1e9 : (claims(l) ? 1e8 : 0) + (safe(l) ? 1e6 : 0) + HIST[l];
    }
    const a0 = alpha;
    let best = -1e9, bestMove = -1;
    for (let i = 0; i < moves.length; i++) {
      let bi = i;
      for (let j = i + 1; j < moves.length; j++) if (sc[j] > sc[bi]) bi = j;
      if (bi !== i) { let t = moves[i]; moves[i] = moves[bi]; moves[bi] = t; t = sc[i]; sc[i] = sc[bi]; sc[bi] = t; }
      const l = moves[i];
      const g = make(l);
      let v;
      if (g) v = g * 100 + search(depth, alpha - g * 100, beta - g * 100, ply + 1); // claiming keeps the turn and costs no depth
      else v = -search(depth - 1, -beta, -alpha, ply + 1);
      unmake();
      if (stopped) return 0;
      if (v > best) { best = v; bestMove = l; if (ply === 0) rootBest = l; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) { HIST[l] += depth * depth + 1; break; }
    }
    tExact[idx] = horizon === h0 ? 1 : 0;
    tKey[idx] = stmKey; tKey1[idx] = h1; tMove[idx] = bestMove; tDepth[idx] = Math.min(depth, 127); tScore[idx] = best;
    tFlag[idx] = best <= a0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  // cfg: {time, depth, nodes}. Returns {move, score, depth, nodes, ms, exact, final}: score = the side to move's
  // expected margin in the boxes still free (× 100); exact = searched to the end (final = that margin in boxes)
  function think(cfg) {
    cfg = cfg || {};
    const t0 = Date.now();
    deadline = cfg.time ? t0 + cfg.time : 0;
    maxNodes = cfg.nodes || 0;
    nodes = 0; stopped = false;
    for (let i = 0; i < E; i++) HIST[i] >>= 2;
    const info = { move: -1, score: 0, depth: 0, nodes: 0, ms: 0, exact: false, final: 0 };
    const legal = gen([]);
    if (!legal.length) return info;
    let best = legal[0];
    for (let d = 1; d <= (cfg.depth || 100); d++) {
      rootBest = -1;
      const h0 = horizon, sc = search(d, -1e9, 1e9, 0);
      if (stopped) { if (rootBest >= 0 && d > 1) best = rootBest; break; }
      if (rootBest >= 0) best = rootBest;
      info.depth = d; info.score = sc;
      if (horizon === h0) { info.exact = true; info.final = Math.round(sc / 100); break; }
      if (cfg.time && Date.now() - t0 > cfg.time * 0.45) break;
      if (maxNodes && nodes > maxNodes * 0.5) break;
    }
    info.move = best; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }

  // ---------- for the page and tests ----------
  const legalMoves = () => { const o = []; for (let l = 0; l < E; l++) if (!drawn[l]) o.push(l); return o; };
  const status = () => (left ? '' : 'over');
  function lineEnds(l) { // the two dots [r, c] of a line
    if (l < NH) { const r = Math.floor(l / C), c = l % C; return [[r, c], [r, c + 1]]; }
    const k = l - NH, r = Math.floor(k / (C + 1)), c = k % (C + 1);
    return [[r, c], [r + 1, c]];
  }

  setStart();
  return {
    R, C, E, NB, NH, setStart, legalMoves, play: make, undo: unmake, status, think, evaluate, lineEnds, claims, safe, safeCount,
    boxesOf: (l) => [SIDE1[l], SIDE2[l]].filter((b) => b >= 0), boxLines: (b) => BOXL[b].slice(),
    score: (p) => score[p], owner: (b) => owner[b], isDrawn: (l) => !!drawn[l],
    get stm() { return stm; }, get left() { return left; },
  };
}
if (typeof module !== 'undefined') module.exports = { DotsEngine };

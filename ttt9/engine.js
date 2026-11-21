// Tic-tac-toe inside tic-tac-toe (틱택토 속 틱택토) engine, written for Penopi. Plain script, no build: loaded by
// worker.js (importScripts), by the page (rules) and by node (tools/test-ttt9.mjs).
//
// Rules: nine small tic-tac-toe boards in a 3×3. The first player starts anywhere. After that, the cell you
// play in (its place inside its small board) says which small board the opponent must play in next. If that
// board is already decided (won, or full) the opponent may play in any open board. Three in a row wins a
// small board; three won small boards in a row win the game. If every small board is decided and nobody has
// a line, the player who won more small boards wins (equal: a draw).
//
// Cells: 0..80 = row*9 + col as drawn (row 0 at the top). Small board b = (row/3)*3 + col/3, the cell's place in
// it s = (row%3)*3 + col%3. A move is the cell number. Player 1 (first) / 2.

function Ttt9Engine(opts = {}) {
  const WIN = 30000, WIN_BOUND = 29000;
  const CELL_B = new Uint8Array(81), CELL_S = new Uint8Array(81), CELL_OF = new Uint8Array(81); // CELL_OF[b*9+s] = cell
  for (let m = 0; m < 81; m++) {
    const r = (m / 9) | 0, c = m % 9, b = ((r / 3) | 0) * 3 + ((c / 3) | 0), s = (r % 3) * 3 + (c % 3);
    CELL_B[m] = b; CELL_S[m] = s; CELL_OF[b * 9 + s] = m;
  }
  const LINES = [7, 56, 448, 73, 146, 292, 273, 84];
  const WINM = new Uint8Array(512), POP = new Uint8Array(512), WINCELLS = new Uint16Array(512);
  for (let x = 0; x < 512; x++) {
    WINM[x] = LINES.some((l) => (x & l) === l) ? 1 : 0;
    let n = 0; for (let i = 0; i < 9; i++) if (x >> i & 1) n++;
    POP[x] = n;
  }
  for (let x = 0; x < 512; x++) { let w = 0; for (let c = 0; c < 9; c++) if (!(x >> c & 1) && WINM[x | (1 << c)]) w |= 1 << c; WINCELLS[x] = w; }

  // Zobrist keys (two 32-bit halves), a fixed seed so the page, the worker and node agree
  let zs = 0x2545f491;
  const zr = () => { zs ^= zs << 13; zs ^= zs >>> 17; zs ^= zs << 5; return zs | 0; };
  const ZA = new Int32Array(162), ZB = new Int32Array(162), ZNA = new Int32Array(10), ZNB = new Int32Array(10);
  for (let i = 0; i < 162; i++) { ZA[i] = zr(); ZB[i] = zr(); }
  for (let i = 0; i < 10; i++) { ZNA[i] = zr(); ZNB[i] = zr(); }
  const ZSA = zr(), ZSB = zr();

  // ----- position -----
  const P = [new Uint16Array(9), new Uint16Array(9)]; // P[player-1][board] = mask of that player's cells
  const owner = new Uint8Array(9); // 0 open, 1/2 won by, 3 full without a winner
  const bigM = [0, 0]; // boards won by each player
  let decided = 0, stm = 1, next = -1, result = 0, plies = 0, h1 = 0, h2 = 0;
  const stCell = new Uint8Array(128), stNext = new Int8Array(128);

  function setStart() {
    P[0].fill(0); P[1].fill(0); owner.fill(0); bigM[0] = bigM[1] = 0;
    decided = 0; stm = 1; next = -1; result = 0; plies = 0; h1 = ZNA[0]; h2 = ZNB[0];
  }
  const empties = (b) => ~(P[0][b] | P[1][b]) & 511;
  function legalMoves() {
    const out = [];
    if (result) return out;
    const from = next >= 0 ? next : 0, to = next >= 0 ? next : 8;
    for (let b = from; b <= to; b++) {
      if (decided >> b & 1) continue;
      const e = empties(b);
      for (let s = 0; s < 9; s++) if (e >> s & 1) out.push(CELL_OF[b * 9 + s]);
    }
    return out;
  }
  function play(m) {
    const p = stm - 1, b = CELL_B[m], s = CELL_S[m];
    stCell[plies] = m; stNext[plies] = next;
    P[p][b] |= 1 << s;
    h1 ^= ZA[p * 81 + m]; h2 ^= ZB[p * 81 + m];
    if (WINM[P[p][b]]) { owner[b] = stm; bigM[p] |= 1 << b; decided |= 1 << b; }
    else if ((P[0][b] | P[1][b]) === 511) { owner[b] = 3; decided |= 1 << b; }
    if (WINM[bigM[p]]) result = stm;
    else if (decided === 511) { const a = POP[bigM[0]], c = POP[bigM[1]]; result = a > c ? 1 : c > a ? 2 : 3; }
    const nn = decided >> s & 1 ? -1 : s;
    h1 ^= ZNA[next + 1] ^ ZNA[nn + 1] ^ ZSA; h2 ^= ZNB[next + 1] ^ ZNB[nn + 1] ^ ZSB;
    next = nn; stm = 3 - stm; plies++;
  }
  function undo() {
    plies--;
    const m = stCell[plies], b = CELL_B[m], s = CELL_S[m];
    stm = 3 - stm; const p = stm - 1;
    P[p][b] &= ~(1 << s);
    h1 ^= ZA[p * 81 + m]; h2 ^= ZB[p * 81 + m];
    if (owner[b]) { owner[b] = 0; bigM[p] &= ~(1 << b); decided &= ~(1 << b); }
    result = 0;
    const pn = stNext[plies];
    h1 ^= ZNA[next + 1] ^ ZNA[pn + 1] ^ ZSA; h2 ^= ZNB[next + 1] ^ ZNB[pn + 1] ^ ZSB;
    next = pn;
  }
  const status = () => (result ? 'over' : 'play');
  function cells() {
    const out = new Int8Array(81);
    for (let m = 0; m < 81; m++) { const b = CELL_B[m], s = CELL_S[m]; out[m] = P[0][b] >> s & 1 ? 1 : P[1][b] >> s & 1 ? 2 : 0; }
    return out;
  }
  const NAME = (m) => `${((m / 9) | 0) + 1}행 ${(m % 9) + 1}열`;

  // ----- evaluation (side to move's view) -----
  const SMALL = new Int16Array(512 * 512).fill(-32768); // a small open board's worth for player 1, lazily
  const CELLW = [3, 2, 3, 2, 5, 2, 3, 2, 3], LINE3 = [0, 3, 9, 0];
  function smallVal(x, o) {
    const k = x * 512 + o;
    let v = SMALL[k];
    if (v !== -32768) return v;
    v = 0;
    for (let i = 0; i < 9; i++) { if (x >> i & 1) v += CELLW[i]; else if (o >> i & 1) v -= CELLW[i]; }
    for (const l of LINES) {
      const xc = POP[x & l], oc = POP[o & l];
      if (!oc && xc) v += LINE3[xc] * 2; else if (!xc && oc) v -= LINE3[oc] * 2;
    }
    SMALL[k] = v;
    return v;
  }
  const BW = [11, 9, 11, 9, 15, 9, 11, 9, 11]; // a small board's weight, tenths (the centre one matters most)
  function evaluate() {
    let sc = 0;
    for (let b = 0; b < 9; b++) {
      const bit = 1 << b;
      if (owner[b] === 1) sc += BW[b] * 10;
      else if (owner[b] === 2) sc -= BW[b] * 10;
      else if (!(decided & bit)) sc += (smallVal(P[0][b], P[1][b]) * BW[b]) / 10 | 0;
    }
    for (const l of LINES) {
      const a = bigM[0] & l, c = bigM[1] & l, free = l & ~decided;
      if (!c && a) { const n = POP[a]; if (n === 2 && free) sc += 90; else if (n === 1 && POP[free] === 2) sc += 14; }
      else if (!a && c) { const n = POP[c]; if (n === 2 && free) sc -= 90; else if (n === 1 && POP[free] === 2) sc -= 14; }
    }
    if (next < 0) sc += stm === 1 ? 12 : -12; // a free choice of board is worth a little
    return stm === 1 ? sc : -sc;
  }

  // ----- search -----
  const TT_BITS = opts.ttBits || 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttK = new Int32Array(TT_SIZE), ttV = new Int16Array(TT_SIZE * 2), ttM = new Uint8Array(TT_SIZE), ttD = new Int8Array(TT_SIZE), ttF = new Uint8Array(TT_SIZE);
  // ttV: [score lo, ...]; scores up to ±30000 fit in Int16 (32767), so one slot is enough per entry
  const hist = [new Int32Array(81), new Int32Array(81)];
  const killer = new Uint8Array(256).fill(255);
  let nodes = 0, stop = false, t0 = 0, limitMs = 0, nodeCap = 0;
  const ttClear = () => { ttK.fill(0); ttF.fill(0); };
  function orderMoves(moves, ttMove, ply) {
    const p = stm - 1, q = 1 - p, sc = new Int32Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i], b = CELL_B[m], s = CELL_S[m];
      let v = hist[p][m];
      if (m === ttMove) v += 1e7;
      else {
        if (WINM[P[p][b] | (1 << s)]) v += 1e6 + (WINM[bigM[p] | (1 << b)] ? 1e6 : 0); // wins the small board (the game, if it also completes a big line)
        else if (WINM[P[q][b] | (1 << s)]) v += 5e5; // takes the cell the opponent would win the board with
        if (killer[ply * 2] === m || killer[ply * 2 + 1] === m) v += 4e5;
        // where this sends the opponent
        if (decided >> s & 1 && !WINM[P[p][b] | (1 << s)]) v -= 3e5; // a free choice for them
        else if (WINCELLS[P[q][s]] & empties(s) && !(decided >> s & 1)) v -= 4e5; // they win a board at once
      }
      sc[i] = v;
    }
    const idx = Array.from(moves.keys()).sort((a, c) => sc[c] - sc[a]);
    return idx.map((i) => moves[i]);
  }
  function negamax(depth, alpha, beta, ply) {
    // the game is over: a line is won by the previous mover, but the count (every board decided) can be won by either side
    if (result) return result === 3 ? 0 : result === stm ? WIN - ply : -(WIN - ply);
    if ((++nodes & 1023) === 0 && (stop || (limitMs && Date.now() - t0 > limitMs) || (nodeCap && nodes > nodeCap))) stop = true;
    if (stop) return 0;
    if (depth <= 0) return evaluate();
    const alpha0 = alpha, k = h1 & TT_MASK;
    let ttMove = -1;
    if (ttF[k] && ttK[k] === h2) {
      ttMove = ttM[k];
      if (ttD[k] >= depth) {
        let s = ttV[k * 2];
        if (s > WIN_BOUND) s -= ply; else if (s < -WIN_BOUND) s += ply;
        const f = ttF[k];
        if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
      }
    }
    const moves = orderMoves(legalMoves(), ttMove, ply);
    let best = -WIN - 1, bestM = moves[0];
    const p = stm - 1;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      play(m);
      let s;
      if (i === 0) s = -negamax(depth - 1, -beta, -alpha, ply + 1);
      else {
        // no late-move reductions: the tree is small, and without them a result found within the depth is proven
        s = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (s > alpha && !stop) s = -negamax(depth - 1, -beta, -alpha, ply + 1);
      }
      undo();
      if (stop) return 0;
      if (s > best) { best = s; bestM = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        hist[p][m] += depth * depth;
        if (killer[ply * 2] !== m) { killer[ply * 2 + 1] = killer[ply * 2]; killer[ply * 2] = m; }
        break;
      }
    }
    let store = best;
    if (store > WIN_BOUND) store += ply; else if (store < -WIN_BOUND) store -= ply;
    ttK[k] = h2; ttV[k * 2] = store; ttM[k] = bestM; ttD[k] = depth; ttF[k] = best <= alpha0 ? 3 : best >= beta ? 2 : 1;
    return best;
  }
  function think(cfg = {}) {
    const info = { move: -1, score: 0, depth: 0, nodes: 0, ms: 0, exact: false };
    const moves0 = legalMoves();
    if (!moves0.length) return info;
    t0 = Date.now(); nodes = 0; stop = false;
    const time = moves0.length === 1 ? Math.min(cfg.time || 250, 250) : cfg.time || 0;
    limitMs = time; nodeCap = cfg.nodes || 0;
    const soft = time ? time * (cfg.soft || 0.5) : 0, maxDepth = Math.min(cfg.depth || 60, 80);
    hist[0].fill(0); hist[1].fill(0); killer.fill(255);
    let rootMoves = orderMoves(moves0, -1, 0), best = rootMoves[0], bestScore = 0;
    for (let d = 1; d <= maxDepth; d++) {
      let alpha = -WIN - 1, iterBest = -1, iterScore = -WIN - 1;
      const order = d === 1 ? rootMoves : [best].concat(rootMoves.filter((m) => m !== best));
      for (let i = 0; i < order.length; i++) {
        const m = order[i];
        play(m);
        let s;
        if (i === 0) s = -negamax(d - 1, -WIN - 1, WIN + 1, 1);
        else { s = -negamax(d - 1, -alpha - 1, -alpha, 1); if (s > alpha && !stop) s = -negamax(d - 1, -WIN - 1, -alpha, 1); }
        undo();
        if (stop) break;
        if (s > iterScore) { iterScore = s; iterBest = m; }
        if (s > alpha) alpha = s;
      }
      if (stop && iterBest < 0) break;
      if (iterBest >= 0 && (!stop || iterScore >= bestScore || d === 1)) { best = iterBest; bestScore = iterScore; info.depth = d; }
      if (stop) break;
      // a proven result (win or loss within the search): nothing more to learn
      if (Math.abs(bestScore) > WIN_BOUND) { info.exact = true; break; }
      if (soft && Date.now() - t0 > soft) break;
    }
    info.move = best; info.score = bestScore; info.nodes = nodes; info.ms = Date.now() - t0;
    return info;
  }
  function perft(d) {
    if (d === 0 || result) return 1;
    let n = 0;
    for (const m of legalMoves()) { play(m); n += perft(d - 1); undo(); }
    return n;
  }
  const countWon = (c) => POP[bigM[c - 1]];
  // the big line that won the game (a mask over the nine boards), or 0
  const bigLine = () => { const p = result - 1; if (p < 0 || p > 1) return 0; for (const l of LINES) if ((bigM[p] & l) === l) return l; return 0; };

  setStart();
  return {
    WIN, WIN_BOUND, setStart, legalMoves, play, undo, status, think, evaluate, perft, cells, NAME, ttClear, countWon, bigLine,
    owners: () => Int8Array.from(owner),
    boardCells: (b) => [P[0][b], P[1][b]],
    get stm() { return stm; }, get next() { return next; }, get result() { return result; }, get plies() { return plies; }, get hash() { return h1; },
  };
}
if (typeof module !== 'undefined') module.exports = { Ttt9Engine };

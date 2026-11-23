// 봐주기의 "그럴듯한 실수" (classic script: importScripts('../shared/slip.js') in a worker, require() in node tools).
// Instead of a random move, rate every legal move with a shallow search and play the 2nd-4th best one, never a move more than
// `margin` worse than the best. So the eased Penopi misses the best move the way a person does, but never throws a piece away.
//   E: an engine (breakthrough/engine.js style: legalMoves, play, think, stm|side), replay(): puts E back on the current position,
//   cfg: the usual think config ({time, depth}), slip: {margin, pick: [weights of the 2nd, 3rd, 4th best]}.
function slipThink(E, replay, cfg, slip) {
  const t0 = Date.now(), who = () => (E.stm !== undefined ? E.stm : E.side);
  replay();
  const legal = E.legalMoves().filter((m) => m !== E.DECLARE);
  if (legal.length < 2) return E.think(cfg);
  const mover = who(), cd = Math.max(1, (cfg.depth || 2) - 1), rows = [];
  for (const m of legal) {
    replay(); E.play(m);
    const child = E.think({ depth: cd, time: 60 });
    let s = typeof child.score === 'number' ? child.score : 0;
    if (who() !== mover) s = -s;
    rows.push({ move: m, score: s });
  }
  replay();
  rows.sort((a, b) => b.score - a.score);
  const best = rows[0], bound = E.WIN_BOUND || E.MATE_BOUND || 1e9;
  const cand = rows.slice(1).filter((r) => r.move !== E.PASS && r.score >= best.score - slip.margin).slice(0, 3);
  let pick = best;
  if (best.score < bound && cand.length) {
    const w = slip.pick || [0.5, 0.3, 0.2];
    let tot = 0; for (let i = 0; i < cand.length; i++) tot += w[i];
    let x = Math.random() * tot;
    for (let i = 0; i < cand.length; i++) { x -= w[i]; if (x <= 0) { pick = cand[i]; break; } }
  }
  return { move: pick.move, score: pick.score, depth: cd + 1, nodes: 0, ms: Date.now() - t0, slip: pick !== best };
}
if (typeof module !== 'undefined') module.exports = { slipThink };

// The little diagrams in the morris rules sheets (morris/game.js, all three boards): a step, a mill, flying.
// The board is drawn from the engine's own lines (ADJ), so the six, nine and twelve men's boards each get theirs.
import { diagram, figs } from '../shared/diagram.js';

const disc = (white, r, c) => ({
  t: 'piece', r, c, k: 2.3,
  g: white ? '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>' : '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>',
});

export function morrisFigs({ XY, ADJ, MILLS, NP, grid }) {
  const rc = (p) => [XY[p][1], XY[p][0]]; // XY is [column, row]
  const at = (white, p) => disc(white, ...rc(p));
  const segs = [];
  for (let p = 0; p < NP; p++) for (const q of ADJ[p]) if (q > p) segs.push([...rc(p), ...rc(q)]);
  const board = (items, caption) => diagram({ rows: grid, cols: grid, pts: true, segs, items, caption, label: caption, max: 146 });
  const dot = (p) => ({ t: 'dot', r: rc(p)[0], c: rc(p)[1] });
  const cap = (p) => ({ t: 'cap', r: rc(p)[0], c: rc(p)[1] });
  const arrow = (a, b, trim = 22) => ({ t: 'arrow', from: rc(a), to: rc(b), trim });
  const taken = new Set();
  const mill = MILLS[0].slice();
  mill.forEach((p) => taken.add(p));
  const free = [...Array(NP).keys()].filter((p) => !taken.has(p));
  const victim = free[free.length - 1], other = free[Math.floor(free.length / 2)];
  const step = 1; // the top middle point of the outer square, which has neighbours along the edge and inwards
  const fly = [0, NP - 1, NP >> 1], target = [...Array(NP).keys()].find((p) => !fly.includes(p) && p > 3 && p < NP - 4);
  return figs(
    board([at(true, step), ...ADJ[step].map(dot)], '옮길 땐 줄을 따라 이웃한 점으로 한 칸'),
    board([...mill.map((p) => at(true, p)), at(false, victim), at(false, other), cap(victim)], '내 말 셋이 한 줄이면(밀) 상대 말 하나를 뺀다'),
    board([...fly.map((p) => at(true, p)), arrow(fly[2], target), dot(target)], '말이 셋 남으면 아무 빈 점으로 날아갈 수 있어'),
  );
}

// The little diagrams in the dots-and-boxes rules sheet (dots/game.js): the fourth side takes the box.
import { diagram, figs } from '../shared/diagram.js';

// one box: its top, left and bottom sides are drawn, the right side is the missing one
const SIDES = [[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[1, 0], [1, 1]]];
const base = [
  ...SIDES.map(([from, to]) => ({ t: 'seg', from, to, w: 10 })),
  ...[[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => ({ t: 'pt', r, c, rad: 13 })),
];
const fig = (items, caption) => diagram({ rows: 2, cols: 2, pts: true, segs: [], items, caption, label: caption, max: 120 });

export const BOX_FIGS = figs(
  fig([...base, { t: 'seg', from: [0, 1], to: [1, 1], col: 'var(--pen)', w: 9, dash: true }], '세 변이 그어진 상자는 상대에게 주는 선물'),
  fig([{ t: 'box', r: 0, c: 0 }, ...base, { t: 'seg', from: [0, 1], to: [1, 1], col: 'var(--pen)', w: 12 }], '네 번째 변을 그으면 상자는 내 거, 한 번 더!'),
);

// The little diagrams in the oware rules sheet (oware/game.js): sowing and capturing. The bottom row is mine (sowing runs right),
// the top row is Penopi's (it runs left); the numbers are the seeds in each pit.
import { diagram, figs } from '../shared/diagram.js';

const pits = (top, bottom) => [
  ...top.map((n, c) => ({ t: 'text', r: 0, c, s: n, size: 58 })),
  ...bottom.map((n, c) => ({ t: 'text', r: 1, c, s: n, size: 58 })),
];
const fig = (items, caption) => diagram({ rows: 2, cols: 6, wide: true, max: 230, items, caption, label: caption });
const arrow = (from, to) => ({ t: 'arrow', from, to, trim: 30 });

export const SOW_FIG = figs(fig(
  [...pits([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]), { t: 'ring', r: 1, c: 1 }, arrow([1, 1], [1, 5])],
  '내 칸(아래 줄) 하나를 집으면 다음 칸부터 하나씩, 오른쪽으로 뿌려',
));
export const CAPTURE_FIG = figs(fig(
  [...pits([4, 4, 4, 4, 1, 1], [4, 4, 4, 4, 3, 4]), { t: 'ring', r: 1, c: 4 }, arrow([1, 4], [1, 5]), arrow([1, 5], [0, 5]), arrow([0, 5], [0, 4]), { t: 'cap', r: 0, c: 5 }, { t: 'cap', r: 0, c: 4 }],
  '마지막 씨앗이 상대 칸에서 2~3개가 되면 가져가고, 바로 앞 칸도 줄줄이 가져가',
));

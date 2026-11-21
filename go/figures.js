// The little diagrams in the go rules sheet (go/game.js): liberties, a group, capture. Stones stand on the crossings.
import { diagram, figs } from '../shared/diagram.js';

const stone = (black, r, c) => ({
  t: 'piece', r, c, k: 2.5,
  g: black ? '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>' : '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>',
});
const dots = (list) => list.map(([r, c]) => ({ t: 'dot', r, c }));
const board = (items, caption) => diagram({ rows: 5, cols: 5, pts: true, items, caption, label: caption, max: 146 });

export const BREATH_FIGS = figs(
  board([stone(true, 2, 2), ...dots([[1, 2], [3, 2], [2, 1], [2, 3]])], '숨: 돌 바로 옆 빈 점(가로·세로)'),
  board([stone(true, 2, 1), stone(true, 2, 2), ...dots([[1, 1], [3, 1], [2, 0], [1, 2], [3, 2], [2, 3]])], '붙은 돌은 한 덩어리, 숨도 같이 써'),
  board([stone(true, 2, 2), stone(false, 1, 2), stone(false, 2, 1), stone(false, 2, 3), stone(false, 3, 2), { t: 'ring', r: 3, c: 2 }, { t: 'cap', r: 2, c: 2 }], '숨을 다 막으면 그 돌은 들어내'),
);
